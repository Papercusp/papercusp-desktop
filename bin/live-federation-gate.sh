#!/usr/bin/env bash
# live-federation-gate.sh — periodic LIVE 2-peer shared-hive federation gate (WI-261).
#
# WHY: the green-rig/red-binary class. Federation bugs (A-003, WI-259) pass the hermetic
# suite (1085+ backbone green) but FAIL the real packaged binary, because the integration
# tests mock/inject the substrate federation. The two-instance live smokes catch this class
# but only run manually → regressions reach the shipped binary undetected. This gate runs
# them on a load-gated quiet box on a schedule + files an EI on any RED, so the class is
# caught within ~a day instead of by chance. (Distinct from the per-bug hermetic guards the
# team adds — those catch the specific regression; this catches the CLASS.)
#
# Usage:  bin/live-federation-gate.sh
# Env:
#   PRESSURE_GATE     (default 30) — THE ADMISSION SIGNAL (WI-6151). SKIP (not fail) if
#                                     cgroup-v2 CPU PSI `some avg60` exceeds this, i.e. real
#                                     CPU STALL, not mere busyness. Unlike loadavg this is
#                                     nice-AWARE, so deferential fleet work that yields to the
#                                     gate does not lock it out. See §1 for the whole story.
#   PRESSURE_FIELD    (default avg60) — which PSI window admission reads (avg10|avg60|avg300).
#   CPU_PRESSURE_FILE (default /sys/fs/cgroup/cpu.pressure) — test seam.
#   LOADAVG_FILE      (default /proc/loadavg) — test seam.
#   LOAD_GATE         (default max(15, 85% of nproc)) — NO LONGER THE ADMISSION SIGNAL. Kept
#                                     as the fallback used only when the kernel exposes no PSI,
#                                     and still logged alongside every admission decision.
#   STORM_GATE        (default nproc*0.6) — a FAIL with end-of-run load above this is
#                                     downgraded to SKIPPED-STORM (starvation, not signal).
#   GATE_SUCCESS_TTL_H(default 22)  — a GREEN younger than this ⇒ instant FRESH exit
#                                     (pairs with the hourly timer: ~daily actual run).
#   GATE_RED_TTL_H    (default 6)   — a TRACKED RED younger than this ⇒ instant FRESH exit.
#                                     Without it a red gate had NO suppression at all and ran
#                                     the FULL heavy gate every hour, forever (WI-37464).
#   GATE_STALE_DAYS   (default 3)   — no GREEN for this long ⇒ file a LOUD staleness EI
#                                     (silence must never look like green).
#   GATE_FORCE        (default 0)   — set 1 to ignore the freshness TTL and run now.
#   REBUILD           (default 1)   — rebuild the sidecar from HEAD first (test current code).
#   GATE_DEB          (unset)       — use this prebuilt .deb instead of rebuild+repack.
#   SKIP_MATRIX       (default 0)   — skip the content-matrix leg (reliable, needs a .deb).
#   SKIP_FROMREPO     (default 0)   — run the from-repo leg. DEFAULT FLIPPED 1→0 2026-07-27
#                                     by the p2p-release leader (su-e3b21) — this is the
#                                     decision the previous version of this comment explicitly
#                                     deferred to that leader. Recorded as D-016 on plan
#                                     p2p-public-release-remaining-lanes-2026-07-16.
#                                     Both reasons for the standing skip are now closed:
#                                     (a) WI-971 (outbox drain never wired for joined/created
#                                     hive harnesses; WI-259 closed as its duplicate) is
#                                     RESOLVED + live-verified twice on the packaged binary
#                                     (WI-5775: standalone AND gate-flag runs both PASS,
#                                     bidirectional + continuous post-join federation green);
#                                     (b) the leg's WITNESS sub-probe (AK-ban write-plane drop)
#                                     was failing for an unrelated reason, WI-5783 — that is
#                                     now RESOLVED too (root cause: two concurrent boot/merge
#                                     passes on the owner's instance, pot/home slug vs the
#                                     owner's own member sub-harness slug).
#                                     WHY THIS MATTERS: with the skip in place the gate could
#                                     report GREEN while never running this leg — its first
#                                     green (2026-07-27T02:00:39Z) reads "from-repo=SKIPPED
#                                     from-repo-witness=SKIPPED". A skipped leg is NOT a green
#                                     leg (D-015). Set SKIP_FROMREPO=1 to opt out for a one-off
#                                     ad-hoc run; do not restore 1 as the standing default to
#                                     quiet a red without recording why on the plan.
#   RUN_LOCAL_MATRIX  (default 1)   — run the full local matrix leg on a weekly cadence,
#                                     once P-002's bin/local-matrix.sh exists (no-op until then).
#   MATRIX_TTL_H      (default 144) — spacing between local-matrix runs (6 days).
#   MATRIX_STALE_H    (default MATRIX_TTL_H+48) — the local-matrix LEG has produced no verdict
#                                     (PASS/FAIL) for this long ⇒ file a LOUD leg-staleness EI.
#                                     EI-18657324526667507: the leg has THREE independent,
#                                     individually-correct suppression paths — the LOAD_GATE
#                                     defer, this MATRIX_TTL_H window, and the §0z rig-busy skip
#                                     — and every one of them exits 0. None was distinguishable
#                                     from "ran and was fine" at any surface, so the leg could
#                                     (and did) sit dark for days while the gate read healthy.
#                                     check_staleness() above did NOT cover it: it only watches
#                                     the GATE-WIDE last-green, which the cheap content-matrix
#                                     leg keeps fresh on its own — so a green gate actively HID
#                                     a never-running local-matrix leg. DERIVED from MATRIX_TTL_H
#                                     on purpose (not a second independent constant): raising the
#                                     TTL can never silently disarm its own detector.
#   GATE_SINGLETON    (default 1)   — only one gate run in flight at a time (held for the whole
#                                     run). 0 disables — for a WEDGED holder only; two concurrent
#                                     runs share the content-matrix lane dir and kill each
#                                     other's instances. See §0y.
#   RIG_WAIT          (default 0)   — 1 = a DELIBERATE run: when the shared rig lock is already
#                                     held, QUEUE behind the holder (via local-matrix.sh's own
#                                     blocking flock) instead of exiting SKIPPED-RIG-BUSY. Pay
#                                     one possibly-idle rebuild to actually reach a verdict.
#                                     Leave 0 for the unattended hourly timer. See §0z.
#   GATE_DISPLAY      (default 250) — Xvfb display base (matrix uses N, from-repo N+2).
#   OPERATOR_MCP_URL  (default http://127.0.0.1:3070/api/mcp) — curl-MCP endpoint for EI filing.
#   GATE_NO_FILE      (default 0)   — set 1 to skip EI filing (just log the verdict).
#   RED_REFILE_H      (default 24)  — RED-EI dedup window (EI-8385-class fix, 2026-07-09):
#                                     this gate runs hourly and every prior version filed a
#                                     BRAND NEW work_items:create bug on every single RED run —
#                                     30+ duplicate "live-federation-gate RED: content-matrix
#                                     failed…" bugs piled up over 3 days for the SAME unresolved
#                                     regression (WI-3358..WI-3477+), because the title embeds a
#                                     run timestamp so no title-similarity guard ever caught them
#                                     as duplicates. Mirrors the STALE path's existing
#                                     stale-ei-filed marker: file once, then suppress re-filing
#                                     for this window (cleared immediately on the next GREEN, so
#                                     a genuine fix is never hidden behind a stale suppression).
# ── self-snapshot re-exec (EI-16828 root-cause fix) ─────────────────────────────
# This gate runs via a `Type=oneshot` systemd unit for up to 4h (TimeoutStartSec=14400)
# executing THIS file directly out of the shared tree, which many agents edit
# concurrently. bash does not slurp a plain script into memory up front — it re-reads
# it by byte offset as execution proceeds — so an in-place edit to this file mid-run
# (not an atomic rename-swap) shifts those offsets under the running interpreter and
# can crash it with a spurious syntax error partway through a run, even though the
# on-disk file is (and always was) syntactically valid. Observed live 2026-07-19
# (EI-16828): the gate died at "line 491: er: command not found" / "line 498: syntax
# error near unexpected token 'fi'" right as another agent's edit landed on that exact
# PASS-971 block; seconds later the current on-disk lines 491-498 were clean. Impact
# was minor (results were already logged; systemd auto-restarted within 2s) but the
# hazard applies to ANY long-running script over this tree, not just this one. Fix:
# snapshot ourselves into a private tmp copy ONCE, then re-exec from that immutable
# copy — the rest of this run is then immune to further edits to the live tree path.
# NOTE: DESKTOP_DIR must be captured from the ORIGINAL (pre-snapshot) path — once we
# re-exec below, BASH_SOURCE[0] points into the /tmp snapshot dir, and re-deriving
# DESKTOP_DIR from THAT would resolve to /tmp instead of papercusp-desktop. Compute it
# once here, export it, and the post-snapshot line below only falls back to recomputing
# it when GATE_SELF_SNAPSHOT is unset (i.e. this file was invoked directly, un-snapshotted).
if [ -z "${GATE_SELF_SNAPSHOT:-}" ]; then
  DESKTOP_DIR_FOR_SNAPSHOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  __snap_dir="$(mktemp -d /tmp/live-fed-gate-snapshot.XXXXXX)"
  cp -- "${BASH_SOURCE[0]}" "$__snap_dir/live-federation-gate.sh"
  chmod +x "$__snap_dir/live-federation-gate.sh"
  export GATE_SELF_SNAPSHOT=1 GATE_SELF_SNAPSHOT_DIR="$__snap_dir" DESKTOP_DIR="$DESKTOP_DIR_FOR_SNAPSHOT"
  exec bash "$__snap_dir/live-federation-gate.sh" "$@"
fi
set -uo pipefail
DESKTOP_DIR="${DESKTOP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# LOAD_GATE default is SATURATION-BASED (WI-5319 / plan D-003): max(15, 85% of nproc).
# History: the old absolute 15 never fired on the 128-core fleet box; nproc/4=32 and then
# 3*nproc/8=48 each still sat below the fleet-era operating floor — on 2026-07-17 the box ran
# 1-min load 40–120 ALL DAY and the 19:04 hourly window self-skipped at 48.78 vs gate 48, so
# the timer effectively never fired (the exact "gate never runs" class P-013 exists to kill).
# Owner directive (plan p2p-public-release-remaining-lanes-2026-07-16 D-003): load is not a
# reason to withhold verification — engineer isolation instead. That isolation now exists:
# local-matrix.sh pins each frame to a reserved cpuset (+ elevated cpu-shares), so host load
# no longer starves the frames' node main threads (run 174333 forensics: 18×30s substrate
# boot timeouts / 10 late-adopts / event-loop p99 1.48s on an UNPINNED rig-b). Admission now
# skips only near true saturation, where even reserved cores can't be kept clear.
NPROC="$(nproc 2>/dev/null || echo 8)"
LOAD_GATE="${LOAD_GATE:-$(( NPROC * 85 / 100 > 15 ? NPROC * 85 / 100 : 15 ))}"
# STORM downgrade moves with it (0.6n → 0.9n): with pinned frames, host loadavg is a weak
# starvation proxy — the honest starvation signal is event-loop-lag inside the frame
# serve.logs (grep '[event-loop-lag]'), which the verdict reader checks per WI-5319. Keep
# the downgrade only as a last-resort guard at genuine saturation.
STORM_GATE="${STORM_GATE:-$(( NPROC * 9 / 10 ))}"
# PRESSURE_GATE (WI-6151) is the ADMISSION threshold, and it is NOT a load number: it is
# cgroup-v2 CPU PSI `some avg60` — the percentage of the last 60s during which at least one
# task was STALLED waiting for CPU. It REPLACES loadavg at §1 (full rationale + calibration
# data there); LOAD_GATE above is untouched and survives only as the no-PSI fallback.
# Default 30 = genuine contention, ~12x this box's observed steady state (`some avg60`
# 2.18-2.41 while loadavg read 78-85, sampled 2026-07-26).
PRESSURE_GATE="${PRESSURE_GATE:-30}"
REBUILD="${REBUILD:-1}"
SKIP_MATRIX="${SKIP_MATRIX:-0}"; SKIP_FROMREPO="${SKIP_FROMREPO:-0}"  # from-repo default 1→0, 2026-07-27, D-016 (WI-971 + WI-5783 both resolved)
# ?superuser=1 REQUIRED (WI-1861 follow-up): a bare /api/mcp rejects projected tool calls with
# invalid_request_context (needs harness/workspace/role/run/spawn params or superuser) — the
# 13:00 red's EI filing died on exactly this and only the loud fallback saved the verdict.
GATE_DISPLAY="${GATE_DISPLAY:-250}"; OPERATOR_MCP_URL="${OPERATOR_MCP_URL:-http://127.0.0.1:3070/api/mcp?superuser=1}"
GATE_NO_FILE="${GATE_NO_FILE:-0}"
# SUPERUSER BEARER (P-013 follow-up, WI-1841): `?superuser=1` alone is NOT sufficient — the
# handler also requires `Authorization: Bearer <token>` matching ~/.papercusp/superuser-token
# (see packages/operator-core/lib/superuser-token.ts). Without it every EI filing 403s with
# superuser_invalid_bearer/invalid_request_context and silently falls back to log-only (verified
# live on 2026-07-03: both the 12:03 and a manual repro hit this). GATE_SUPERUSER_TOKEN_PATH lets
# a non-default install override the path; missing/short token → empty bearer → same graceful
# fallback as before (never fatal).
GATE_SUPERUSER_TOKEN_PATH="${GATE_SUPERUSER_TOKEN_PATH:-$HOME/.papercusp/superuser-token}"
GATE_SUPERUSER_BEARER="$(cat "$GATE_SUPERUSER_TOKEN_PATH" 2>/dev/null | tr -d '[:space:]' || true)"
STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo run)"
WORK="/tmp/live-fed-gate-$STAMP"; mkdir -p "$WORK"
# Run-dir retention (WI-3087, 2026-07-05): this gate leaked ~3.5GB per heavy run (the
# dpkg-deb -R unpacked pkg/ tree + the repacked gate .deb were never cleaned) — 67 dirs /
# 111GB of /tmp by the time it filled the root disk. Keep only the newest
# GATE_KEEP_RUNS run dirs (this one included; logs+deb of recent runs stay for EI
# debugging); pkg/ is additionally removed right after a successful repack below.
GATE_KEEP_RUNS="${GATE_KEEP_RUNS:-5}"
ls -dt /tmp/live-fed-gate-* 2>/dev/null | tail -n +$(( GATE_KEEP_RUNS + 1 )) | xargs -r rm -rf --
# log → STDERR. Load-bearing (P-013 validation run 2026-07-03): run_smoke's result is read
# via $(command substitution); with log on stdout the captured value became
# "log-line\nPASS|FAIL", so `[ "$RES" = FAIL ]` could NEVER match and a genuine
# content-matrix FAIL was silently MASKED out of the verdict. journald captures both streams.
log() { echo "[live-fed-gate $(date +%H:%M:%S 2>/dev/null || true)] $*" >&2; }

# ── state + staleness (P-013): a gate that silently skips forever LOOKS green. ──
# last-green/last-run live in a tiny ops state dir. Deliberately a FILE, not PG: the gate
# must keep working when the operator/PG is down (EI filing is already best-effort curl).
STATE_DIR="${GATE_STATE_DIR:-$HOME/.papercusp/live-fed-gate}"; mkdir -p "$STATE_DIR"

# ── verdict banking (WI-38285) ────────────────────────────────────────────────
# EVERY terminal path emits through verdict(), never a bare `echo "GATE: …"`. That echo used
# to BE the entire record of what a run decided, and it survives nowhere:
#   • a bare ./live-federation-gate.sh never touches journald — NO journal entry at all;
#     a manual `systemctl --user start` of the SERVICE leaves service entries and no timer
#     ones, so the journal answers about the TIMER and lies by omission about the GATE;
#   • $WORK=/tmp/live-fed-gate-$STAMP is pruned to GATE_KEEP_RUNS and reaped from /tmp;
#   • the markers here (last-run/last-green/last-red/last-downgrade) are bare epoch
#     INTEGERS — they record THAT a window happened, never WHAT it decided.
# Not hypothetical: the 2026-08-12T11:12:50Z GREEN on this release-BLOCKING gate exists only
# as the integer in last-green. Its leg breakdown is gone, so it cannot answer the question a
# green is actually asked — did the containerized local-matrix restart class run this window,
# or did the cheap content-matrix leg carry the green alone (the exact failure check_matrix_
# staleness exists for)? And since the timer was owner-stopped on 2026-08-07 (wall fact
# wall:live-federation-gate-timer-owner-stopped) EVERY run is a hand-run, so this bank is now
# the ONLY durable record of a verdict that exists.
#
# A FILE in $STATE_DIR for the same reason the markers are: the gate must keep recording when
# the operator/PG is down. Append-only JSONL, tail-bounded, and it can never fail the gate —
# a write error is logged and swallowed, and the verdict still goes to stdout regardless.
GATE_VERDICT_LOG="${GATE_VERDICT_LOG:-$STATE_DIR/verdicts.jsonl}"
GATE_VERDICT_KEEP="${GATE_VERDICT_KEEP:-500}"
__json_str() {  # stdin → a JSON string BODY (caller supplies the quotes)
  # Order matters: double the backslashes FIRST, so the ones introduced below stay escapes.
  # Every control character must then be accounted for or the line is not parseable JSON —
  # \011 (TAB) is the one that bites, because it is the only one that survives a naive
  # "strip the control chars" range and a leg SUMMARY can legitimately contain it. Caught by
  # the escaping test below: an un-escaped tab in SUMMARY invalidated EVERY banked line, not
  # just the one carrying it, since SUMMARY persists across the run.
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' \
    | tr -d '\000-\010\013\014\016-\037' | tr '\n' ' '
}
bank_verdict() {  # <the full "GATE: …" line>
  [ "${GATE_NO_VERDICT_LOG:-0}" = 1 ] && return 0
  local line="$1" token esc head invoker
  # The verdict TOKEN (GREEN / RED / FRESH-RED / SKIPPED-STARVATION / TERMINATED / …) is what a
  # reader greps on; the full line is kept beside it so nothing is lost to the extraction.
  token="$(printf '%s' "$line" | sed -n 's/^GATE: \([A-Za-z-]*\).*/\1/p')"
  [ -n "$token" ] || token=UNKNOWN
  esc="$(printf '%s' "$line" | __json_str)"
  # Resolved HERE rather than on the hot fresh-exit path: bank_verdict runs exactly once per
  # run, at the terminal exit, so this costs one rev-parse per run and never touches the
  # ~0-cost hourly FRESH window. GIT_HEAD (§2) is NOT usable — every fresh/skip path exits
  # long before the rebuild that sets it.
  head="$(cd "$DESKTOP_DIR/.." 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  # systemd exports INVOCATION_ID to a unit's processes and nothing else does — so this
  # records whether the run was journald-observable, which is the distinction that made the
  # 08-12 green unrecoverable in the first place.
  if [ -n "${INVOCATION_ID:-}" ]; then invoker=systemd; else invoker=hand; fi
  if ! printf '{"ts":"%s","epoch":%s,"verdict":"%s","legs":{"content_matrix":"%s","from_repo":"%s","from_repo_witness":"%s","local_matrix":"%s","build":"%s"},"summary":"%s","matrix_skip":"%s","head":"%s","invoker":"%s","pid":%s,"work":"%s","line":"%s"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" "$(now_s)" "$token" \
      "${MATRIX_RES:-?}" "${FROMREPO_RES:-?}" "${WITNESS_RES:-?}" "${MATRIXFULL_RES:-?}" \
      "$([ "${FAIL_BUILD:-0}" = 1 ] && echo FAIL || echo OK)" \
      "$(printf '%s' "${SUMMARY:-}" | __json_str)" \
      "$(printf '%s' "${MATRIX_SKIP_REASON:-}" | __json_str)" \
      "$head" "$invoker" "$$" "${WORK:-}" "$esc" >>"$GATE_VERDICT_LOG" 2>/dev/null; then
    log "bank_verdict: could not append to $GATE_VERDICT_LOG — verdict still emitted on stdout"
    return 0
  fi
  # Tail-bound so an append-only file cannot grow without limit. Trimmed to a temp file in the
  # SAME dir and moved into place, so a reader never observes a half-written bank.
  local n; n="$(wc -l <"$GATE_VERDICT_LOG" 2>/dev/null || echo 0)"
  if [ "${n:-0}" -gt "$GATE_VERDICT_KEEP" ] 2>/dev/null; then
    local tmp="$GATE_VERDICT_LOG.trim.$$"
    if tail -n "$GATE_VERDICT_KEEP" "$GATE_VERDICT_LOG" >"$tmp" 2>/dev/null; then
      mv -f "$tmp" "$GATE_VERDICT_LOG" 2>/dev/null || rm -f "$tmp" 2>/dev/null || true
    else
      rm -f "$tmp" 2>/dev/null || true
    fi
  fi
  return 0
}
# Bank FIRST, then emit: a caller that pipes/drops stdout, or a TERM arriving mid-emit, must
# not be able to cost us the durable record. The echoed string is byte-identical to what the
# bare echo produced, so every existing verdict-greping caller is unaffected.
verdict() { bank_verdict "$1"; echo "$1"; }

GATE_SUCCESS_TTL_H="${GATE_SUCCESS_TTL_H:-22}"
# A WI-5329 frame-starvation downgrade is NOT a genuine green (D-005: a starvation SKIP never
# satisfies first-green). Such a window must NOT refresh last-green — that is exactly how the
# 2026-07-19 15:38 downgrade suppressed real hourly runs for ~22h and hid the replication_soak
# DHT-recovery bug (WI-5481). A downgraded window records last-downgrade instead and re-tries
# after this SHORTER TTL: long enough to avoid a starvation→expensive-rerun→more-starvation
# loop, short enough that a real red surfaces same-day.
GATE_DOWNGRADE_TTL_H="${GATE_DOWNGRADE_TTL_H:-3}"
# WI-37464: a RED had NO backoff of any kind. last-green is written on the GREEN path ONLY
# (see the verdict block), and it is the sole input to the cheap hourly fresh-exit above — so
# the moment the gate went red, last-green stopped advancing and EVERY hourly fire ran the
# full heavy gate again, indefinitely. That is not a hypothetical: the five consecutive reds of
# 2026-08-06 were five consecutive full heavy runs, and the resulting churn on the owner's box
# is what got the timer stopped ("nvmd i know what it is, just stop it" — see the wall fact
# wall:live-federation-gate-timer-owner-stopped). So a red must back off like a downgrade does.
#
# LONGER than the downgrade TTL, deliberately, because the two states differ in kind: a
# starvation downgrade is ENVIRONMENTAL and may clear on its own, so retrying soon is
# informative; a RED is a STABLE code fact, and re-running unchanged code just reproduces the
# same red at full cost. The red has ALREADY been reported (verdict line + a tracked EI), so
# further runs add no signal until something changes. GATE_FORCE=1 bypasses this (as it does
# every fresh-exit), which is how you verify a fix without waiting.
GATE_RED_TTL_H="${GATE_RED_TTL_H:-6}"
GATE_STALE_DAYS="${GATE_STALE_DAYS:-3}"
RED_REFILE_H="${RED_REFILE_H:-24}"
# Local-matrix LEG staleness (EI-18657324526667507) — see the MATRIX_STALE_H header note.
# A verdict is expected about every MATRIX_TTL_H, so "stale" is that cadence plus a grace
# window; deriving it means a raised TTL moves the detector with it instead of muting it.
MATRIX_STALE_H="${MATRIX_STALE_H:-$(( ${MATRIX_TTL_H:-144} + 48 ))}"
# Set by check_matrix_staleness so the human-facing verdict line can carry the leg-dark marker
# too — an EI in a queue and a line in journald are both easy to miss; the GATE: line is not.
MATRIX_LEG_STALE=0
# EI-18715623477356990 — THE ONE "why did the matrix leg not decide this window?" reason string.
# MATRIX_LEG_STALE only fires after MATRIX_STALE_H (default 192h ≈ 8 days) of silence; a lane
# waiting on revocation_kcut / attestation_unattested_device (the two scenarios ONLY this leg
# runs) needs the answer THIS window, not eight days later. Every §3b path that declines to run
# the leg sets this, so the suppression is always attributable at the verdict line.
MATRIX_SKIP_REASON=""
now_s() { date +%s 2>/dev/null || echo 0; }
# Wall-clock start of THIS gate run — the default evidence window for frame_pressure_note()
# below, so a verdict reached BEFORE the local-matrix leg ran (MATRIX_LEG_START_TS unset)
# still scopes its frame evidence to this run instead of reading a stale bank file.
GATE_RUN_START_TS="$(now_s)"
age_h() { local f="$1"; [ -f "$f" ] || { echo 999999; return; }; echo $(( ( $(now_s) - $(cat "$f" 2>/dev/null || echo 0) ) / 3600 )); }
jstr() { printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$1"; }
file_ei() { # <title> <body> [conditionKey] — best-effort curl-MCP; the loud echo + $WORK logs are the fallback
  # $3 (WI-39604): optional work_items:create conditionKey. The server then routes the
  # filing through the WI-39594 condition upsert: an OPEN item already holding the key is
  # REFRESHED (newest legs+stamp win) and its id returned, instead of a sibling row being
  # minted — so dupes can no longer leak across marker-expiry days or leg-set changes while
  # ONE regression stands. The response carries the incumbent's "id":"WI-…" either way, so
  # the confirm-grep below is key-agnostic.
  [ "$GATE_NO_FILE" = 1 ] && return 0
  local resp cond_arg=""
  [ -n "${3:-}" ] && cond_arg=",\"conditionKey\":$(jstr "$3")"
  local -a auth_hdr=()
  if [ -n "$GATE_SUPERUSER_BEARER" ]; then
    auth_hdr=(-H "authorization: Bearer $GATE_SUPERUSER_BEARER")
  else
    log "WARN: no superuser bearer at $GATE_SUPERUSER_TOKEN_PATH — EI filing will 403 (superuser_invalid_bearer); falling back to log-only."
  fi
  resp="$(curl -s -m 30 -X POST "$OPERATOR_MCP_URL" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' "${auth_hdr[@]}" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"work_items:create\",\"arguments\":{\"kind\":\"bug\",\"title\":$(jstr "$1"),\"summary\":$(jstr "$2"),\"harness\":\"papercusp\",\"severity\":\"major\",\"topics\":[\"shared-hive\",\"federation\"]$cond_arg}}}" 2>/dev/null || true)"
  # Verify the filing actually landed (P-013: the 2026-07-03 red filed against harness
  # "papercup" + got an SSE ':stream-open' preamble back and NO work item was created —
  # a silent-miss on the gate's core contract). An SSE body carries the JSON in data: lines,
  # and the tool result is a JSON STRING nested inside that envelope, so its own quotes come
  # back backslash-escaped (`\"id\":\"WI-123\"`), not bare (`"id":"WI-123"`) — a bare-quote
  # grep NEVER matches an SSE response and every successful filing still logged as unconfirmed
  # (WI-1841 verification, 2026-07-03: manually confirmed the work item WAS created — WI-1897 —
  # while this check said DID NOT CONFIRM). The `\\?` makes each quote's backslash optional so
  # this matches both the SSE-escaped and a plain-JSON transport.
  local id_match
  id_match="$(printf '%s' "$resp" | grep -oaE '\\?"id\\?":\\?"WI-[0-9]+' | head -1)"
  if [ -n "$id_match" ]; then
    log "EI filed OK → $(printf '%s' "$id_match" | grep -oaE 'WI-[0-9]+')"
    return 0
  else
    log "EI filing DID NOT CONFIRM (no WI id in response) — resp head: ${resp:0:200}"
    log "EI filing FALLBACK: verdict + logs remain in $WORK and journald; file manually if this red is real."
    # 2026-08-01: this now RETURNS NON-ZERO so the caller can refuse to write the
    # "already tracked" markers. Previously every caller ignored the outcome and stamped
    # the markers unconditionally, which turned an unconfirmed filing into a SUPPRESSED
    # one: the 2026-07-31T23:00Z from-repo-witness RED stamped red-ei-filed at 23:00:55
    # with NO work-item ever created (verified against harness_shared.engineer_issues —
    # no row carries that leg-set, and no open duplicate existed to legitimately suppress
    # it), after which the per-leg marker suppressed re-filing for the whole RED_REFILE_H
    # window. A gate whose reds can vanish is worse than a gate that is merely red.
    return 1
  fi
}
find_open_duplicate() { # <title-prefix, no timestamp> [open|active] -> prints a matching WI id, or nothing
  # P-005 (2026-08-02): MOVED here from below the RED block. It was defined at ~L1272, but
  # check_staleness — which now uses it — is invoked from a dozen earlier exit paths (L316,
  # 326, 367, 421, 665, 714, 1196, 1207, 1231), ALL of which run before that point. Under
  # `set -uo pipefail` (no -e) a call to a not-yet-defined function is not fatal: it returns
  # 127 into a command substitution, yields the empty string, and reads as "no duplicate
  # exists" — i.e. it would have failed in the FILE-ANYWAY direction, silently, which is
  # exactly the dedup this closes. Pure relocation; the body is unchanged and the RED
  # caller below is unaffected. Its only deps (OPERATOR_MCP_URL L158,
  # GATE_SUPERUSER_BEARER L168) are set well above here.
  local prefix="$1" scope="${2:-open}" resp item_filter='"state":"open"'
  # An account-setting wall is intentionally parked as needs-human, not left open. The
  # attestation write preflight below must still recognize that as durable tracking, or every
  # hourly run mints a duplicate bug for the same owner action. Existing callers retain the
  # historical open-only query; `active` widens just this lookup to every non-terminal state.
  [ "$scope" = active ] && item_filter='"notTerminal":true'
  local -a auth_hdr=()
  [ -n "$GATE_SUPERUSER_BEARER" ] && auth_hdr=(-H "authorization: Bearer $GATE_SUPERUSER_BEARER")
  resp="$(curl -s -m 15 -X POST "$OPERATOR_MCP_URL" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' "${auth_hdr[@]}" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"work_items:list\",\"arguments\":{\"kind\":\"bug\",\"harness\":\"papercusp\",$item_filter,\"limit\":500}}}" 2>/dev/null || true)"
  GATE_DUP_PREFIX="$prefix" python3 -c '
import sys, json, os
prefix = os.environ.get("GATE_DUP_PREFIX", "")
raw = sys.stdin.read()
items = []
for line in raw.splitlines():
    line = line.strip()
    if line.startswith("data:"):
        payload = line[len("data:"):].strip()
        try:
            obj = json.loads(payload)
            text = obj["result"]["content"][0]["text"]
            items = json.loads(text)
        except Exception:
            continue
for it in items:
    t = it.get("title", "")
    if isinstance(t, str) and t.startswith(prefix):
        print(it.get("id", ""))
        break
' <<<"$resp" 2>/dev/null
}
check_matrix_staleness() { # EI-18657324526667507: "when did the local-matrix leg last DECIDE?"
  # The leg's suppression paths (LOAD_GATE defer, MATRIX_TTL_H window, §0z rig-busy skip) are
  # each individually correct, cheap, well-logged no-ops that exit 0 — and are therefore
  # indistinguishable from "ran and was fine" at every consuming surface. This joins the one
  # fact none of them reports: how long it has been since the leg produced an actual verdict,
  # regardless of WHY it has not. Deliberately reports on the GREEN path too — a green gate is
  # exactly the state that hides a dark leg, because the cheap content-matrix leg alone keeps
  # last-green fresh while local-matrix never runs.
  local verdict_age_h; verdict_age_h="$(age_h "$STATE_DIR/last-matrix-verdict")"
  [ "$verdict_age_h" -lt "$MATRIX_STALE_H" ] && return 0
  local filed_age_h; filed_age_h="$(age_h "$STATE_DIR/matrix-stale-ei-filed")"
  [ "$filed_age_h" -lt "$MATRIX_STALE_H" ] && return 0
  local since; if [ -f "$STATE_DIR/last-matrix-verdict" ]; then since="${verdict_age_h}h ago"; else since="NEVER (no verdict ever recorded)"; fi
  log "STALE-LEG: local-matrix has produced NO verdict — last decision: $since (threshold ${MATRIX_STALE_H}h). This leg is DARK; the gate's overall green does not cover it."
  # P-005: same two corrections as check_staleness below — dedup against a still-OPEN item
  # (the matrix-stale-ei-filed marker is local + ephemeral, so it cannot see one), and stamp
  # the marker ONLY on a CONFIRMED filing. This path has produced just one item so far, but
  # the structure is identical to the gate-wide one that re-filed four times; fixing only
  # the path that has already misfired leaves the same trap armed on its sibling.
  # MATRIX_LEG_STALE is set REGARDLESS of the filing outcome: it drives the human-facing
  # verdict suffix, and a dark leg must be announced on the verdict line even when the
  # filing could not be confirmed.
  local existing_leg_open; existing_leg_open="$(find_open_duplicate "live-federation-gate LEG STALE:")"
  if [ -n "$existing_leg_open" ]; then
    log "matrix-leg staleness already tracked as still-OPEN $existing_leg_open — skipping duplicate filing."
    echo "$(now_s)" >"$STATE_DIR/matrix-stale-ei-filed"
    MATRIX_LEG_STALE=1
    return 0
  fi
  if file_ei "live-federation-gate LEG STALE: local-matrix has produced no verdict ($since) — the matrix leg is dark behind an all-green gate" \
    "The local-matrix leg of the WI-261/P-013 live-federation gate has not produced a PASS/FAIL verdict — last decision: $since (threshold ${MATRIX_STALE_H}h = MATRIX_TTL_H + 48h grace). The leg has three independent suppression paths that each exit 0 and look identical to success: the LOAD_GATE defer (load-*.txt banks in \$STATE_DIR/triage/), the MATRIX_TTL_H (default 144h) cadence window, and the §0z rig-busy pre-check skip. The gate-wide staleness check does NOT cover this: the cheap content-matrix leg keeps last-green fresh on its own, so the gate can report GREEN indefinitely while the containerized 8-scenario matrix never runs — anything waiting on it for verification stalls silently. Check: ls -la \$STATE_DIR (last-matrix-verdict / last-matrix-green); ls \$STATE_DIR/triage/ | tail; journalctl --user -u papercup-live-federation-gate.service. To force a verdict now: GATE_FORCE=1 RIG_WAIT=1 papercusp-desktop/bin/live-federation-gate.sh (RIG_WAIT queues behind a rig holder instead of skipping). Per owner decision D-003 (2026-07-17) the durable fix for the load path is isolation, NOT raising LOAD_GATE. Owner: shared-hive release lane (plan shared-hive-p2p-release-readiness-2026-07-03 P-013)."; then
    echo "$(now_s)" >"$STATE_DIR/matrix-stale-ei-filed"
  else
    log "matrix-leg staleness EI filing NOT CONFIRMED — deliberately NOT stamping matrix-stale-ei-filed, so the next window re-attempts."
  fi
  MATRIX_LEG_STALE=1
}
# Marker appended to the echoed verdict line whenever the leg is dark, so "GATE: GREEN" can
# never again read as "everything ran and was fine" while local-matrix has decided nothing.
matrix_stale_suffix() { [ "$MATRIX_LEG_STALE" = 1 ] && printf ' [WARN: local-matrix leg STALE — no verdict in >%sh]' "$MATRIX_STALE_H"; return 0; }
# EI-18715623477356990: the same treatment for THIS window's suppression. Observed 2026-07-26:
# content-matrix was red on incr-B→A, so §3b silently skipped local-matrix every hourly window —
# and two agents each waited on a run for revocation/attestation evidence that structurally could
# not arrive, because the skip is not announced anywhere, it simply does not appear. Silence is
# the whole defect: a leg that did not decide must never be indistinguishable from one that did.
matrix_skip_suffix() { [ -n "${MATRIX_SKIP_REASON:-}" ] && printf ' [local-matrix DID NOT DECIDE: %s]' "$MATRIX_SKIP_REASON"; return 0; }
check_staleness() { # called on every non-GREEN exit path: silence must never look like green
  # Leg-level staleness is checked FIRST and unconditionally: the gate-wide green-age early-return
  # below must never suppress it (a fresh gate-wide green is precisely how a dark leg stays hidden).
  check_matrix_staleness
  local green_age_h; green_age_h="$(age_h "$STATE_DIR/last-green")"
  [ "$green_age_h" -lt $(( GATE_STALE_DAYS * 24 )) ] && return 0
  local filed_age_h; filed_age_h="$(age_h "$STATE_DIR/stale-ei-filed")"
  [ "$filed_age_h" -lt $(( GATE_STALE_DAYS * 24 )) ] && return 0
  # ── P-005 (a): SENTINEL LEAKAGE. age_h returns 999999 when the marker file does not
  # exist, which means NEVER — not "114 years". Every OTHER age_h consumer is guarded by an
  # `-lt` comparison that the sentinel deliberately fails, so it never reaches prose; here
  # the `-lt` IS the early return above, so this is the one path the sentinel falls THROUGH
  # into a human-facing message. It shipped as the literal "no green run for 999999h" on
  # four work-items (WI-3235, WI-3442, WI-5629, WI-5718 — the last two still open). The
  # distinction is diagnostic, not cosmetic: "went stale after a green" and "has never once
  # been green" are different failures with different first moves. Same shape as the
  # `since` idiom check_matrix_staleness above already uses for its own verdict.
  local stale_clause
  if [ -f "$STATE_DIR/last-green" ]; then
    stale_clause="no green run for ${green_age_h}h"
  else
    stale_clause="NO GREEN RUN EVER RECORDED (no last-green marker has ever been written)"
  fi
  log "STALE: ${stale_clause} (> ${GATE_STALE_DAYS}d) — filing staleness EI"
  # ── P-005 (b): the gate-wide STALE path never received the two corrections the RED path
  # below already carries, so it re-filed the same condition four times.
  #   (1) find_open_duplicate (bug-drain-200k, 2026-07-20): stale-ei-filed is LOCAL,
  #       EPHEMERAL state, so once it ages out a STILL-OPEN item does not stop a re-file.
  #       WI-5629 (07-20) and WI-5718 (07-23) are both open and identical RIGHT NOW — and
  #       both were filed AFTER the helper existed; it was simply never wired in here.
  #   (2) stamp the marker ONLY on a CONFIRMED filing (2026-08-01): stamping it
  #       unconditionally converts a transient curl/operator failure into a SUPPRESSED
  #       alarm for the whole window — a gate whose staleness can vanish is worse than one
  #       that is merely stale. The `if file_ei` form is the RED path's, verbatim.
  local existing_open; existing_open="$(find_open_duplicate "live-federation-gate STALE:")"
  if [ -n "$existing_open" ]; then
    log "gate staleness already tracked as still-OPEN $existing_open — skipping duplicate filing (the ${GATE_STALE_DAYS}d local marker had aged out)."
    echo "$(now_s)" >"$STATE_DIR/stale-ei-filed"
    return 0
  fi
  if file_ei "live-federation-gate STALE: ${stale_clause} — the shared-hive release signal is dark" \
    "The WI-261/P-013 standing live-federation gate reports: ${stale_clause} (threshold ${GATE_STALE_DAYS}d). Every window either load-skipped, storm-downgraded, all-legs-skipped, or failed — the shared-hive P2P green/red signal is DARK, which must never read as green. If this says NO GREEN RUN EVER RECORDED, the gate has never once completed green on this box (a fresh/never-working install), which is a different diagnosis from a gate that went stale. Check: systemctl --user list-timers papercup-live-federation-gate.timer; journalctl --user -u papercup-live-federation-gate.service; state in ~/.papercusp/live-fed-gate/. Owner: shared-hive release lane (plan shared-hive-p2p-release-readiness-2026-07-03 P-013)."; then
    echo "$(now_s)" >"$STATE_DIR/stale-ei-filed"
  else
    log "staleness EI filing NOT CONFIRMED — deliberately NOT stamping stale-ei-filed, so the next window re-attempts instead of suppressing this staleness as 'already tracked'."
  fi
}
skip_cleanup() { # SKIP/FRESH exits carry no diagnostic value — drop the near-empty run dir so
  # hourly SKIP windows don't rotate real RED/GREEN evidence dirs out of GATE_KEEP_RUNS
  # retention (observed 2026-07-16: five consecutive load-SKIP windows evicted BOTH diagnostic
  # run dirs of that day's RED within ~5h). The dir is kept if anything beyond selftest.log
  # landed in it (e.g. a prod-port-guard trip is evidence).
  find "$WORK" -mindepth 1 ! -name selftest.log 2>/dev/null | grep -q . || rm -rf "$WORK"
}

# ── fresh-exit: hourly timer + ~daily actual run. A GREEN younger than the TTL means this
# window has nothing to do — exit instantly (before the self-test) so hourly fires cost ~0.
if [ "${GATE_FORCE:-0}" != 1 ]; then
  GREEN_AGE_H="$(age_h "$STATE_DIR/last-green")"
  if [ "$GREEN_AGE_H" -lt "$GATE_SUCCESS_TTL_H" ]; then
    log "fresh: last GREEN ${GREEN_AGE_H}h ago (< ${GATE_SUCCESS_TTL_H}h TTL) — nothing to do this window."
    skip_cleanup
    # Cheap (a file mtime read) and deliberately kept on the hot FRESH path: this is the window
    # the hourly timer takes almost every fire, so it is the one that must not stay silent.
    check_matrix_staleness
    verdict "GATE: FRESH (green ${GREEN_AGE_H}h ago)$(matrix_stale_suffix)"; exit 0
  fi
  # A starvation-downgraded window is NOT a green (it never refreshes last-green, so it does not
  # satisfy the TTL above), but back off for a SHORTER window so a chronically starved box does
  # not full-run every hour — which would worsen the very starvation it is skipping.
  DOWNGRADE_AGE_H="$(age_h "$STATE_DIR/last-downgrade")"
  if [ "$DOWNGRADE_AGE_H" -lt "$GATE_DOWNGRADE_TTL_H" ]; then
    log "fresh: last window STARVATION-DOWNGRADED ${DOWNGRADE_AGE_H}h ago (< ${GATE_DOWNGRADE_TTL_H}h retry TTL) — NOT a green; retrying after the TTL, nothing to do this window."
    skip_cleanup
    check_matrix_staleness
    verdict "GATE: FRESH-DOWNGRADE (downgraded ${DOWNGRADE_AGE_H}h ago — not a green)$(matrix_stale_suffix)"; exit 0
  fi
  # WI-37464: a TRACKED red backs off too. Checked LAST of the three so it can never mask a
  # fresher green or downgrade. `last-red` is stamped ONLY where the red was confirmed tracked
  # (see the verdict block) — an untracked red deliberately re-runs next window rather than
  # going quiet, because a silently-dropped release-gate red is worse than the churn.
  # NOTE age_h() returns 999999 for a MISSING file, so a box that has never red'd is unaffected.
  RED_AGE_H="$(age_h "$STATE_DIR/last-red")"
  if [ "$RED_AGE_H" -lt "$GATE_RED_TTL_H" ]; then
    log "fresh: last window was a TRACKED RED ${RED_AGE_H}h ago (< ${GATE_RED_TTL_H}h retry TTL) — the red is already reported and re-running unchanged code reproduces it at full cost; nothing to do this window. GATE_FORCE=1 to run anyway."
    skip_cleanup
    check_matrix_staleness
    verdict "GATE: FRESH-RED (red ${RED_AGE_H}h ago — still red, already tracked; NOT a green)$(matrix_stale_suffix)"; exit 0
  fi
fi

# ── 0y. gate SINGLETON lock (WI-5137/P-402, 2026-07-25) ────────────────────────
# Only ONE gate run may be in flight at a time, for the WHOLE run — held here, released
# by process exit (flock fd semantics). §0z below probes the RIG lock, which structurally
# CANNOT cover this: a gate run does not take the rig until its local-matrix leg, so for
# the entire rebuild+content-matrix window (~10min) it is invisible to §0z's probe and a
# second gate run sees a free rig and commits to its own full rebuild.
#
# OBSERVED 2026-07-25 (this is not theoretical): a manual GATE_FORCE run started 18:38:31
# and did not take the rig until 18:44:59. The hourly timer fired at 18:43:40 — inside that
# window — passed §0z cleanly, burned a second 3.4GB rebuild, and then sat blocked on the
# rig for what would have been up to 7200s, monopolising the shared rig against every other
# agent's targeted verification for a verdict that duplicated the first.
#
# WASTE IS THE LESSER HALF. The content-matrix leg runs with a FIXED work dir
# (two-instance-content-matrix-smoke.sh: PAPERCUSP_MATRIX_WORK, default
# ~/.papercusp-lane-a-fed) and deliberately LEAVES ITS PAIR RUNNING on exit. Two concurrent
# gate runs therefore share one lane dir and kill each other's instances — the 18:38 run's
# content-matrix.out ends in two `Killed ... serve.mjs` lines from the 18:43 run's teardown.
# That landed after the verdict this time, so it was survivable; landing mid-scenario it
# would produce a CORRUPT verdict indistinguishable from a real federation failure. A gate
# that can silently corrupt its own verdict under a routine timer collision is worse than
# one that skips, so this guard is unconditional.
#
# GATE_FORCE does NOT bypass: a forced run colliding with an in-flight gate run is exactly
# the collision above, and the right move is to wait for (or stop) the in-flight run — not
# to start a second interfering one. GATE_SINGLETON=0 is the deliberate escape hatch for a
# WEDGED holder; prefer `systemctl --user stop papercup-live-federation-gate.service`, which
# stops a timer-launched run via the TERMINATED path (no false RED) and, being cgroup-scoped,
# provably cannot touch a manually-launched run in another scope.
if [ "${GATE_SINGLETON:-1}" = 1 ]; then
  GATE_LOCK="${PCUSP_GATE_LOCK:-/tmp/pcusp-live-fed-gate.lock}"
  if exec 7>>"$GATE_LOCK" 2>/dev/null; then
    if ! flock -n 7; then
      GATE_HOLDER="$(cat "$GATE_LOCK.holder" 2>/dev/null || echo 'unknown holder')"
      log "another gate run is already in flight (held by: $GATE_HOLDER) — skipping this window rather than starting a second run that would duplicate the verdict and clobber the shared content-matrix lane dir. GATE_SINGLETON=0 overrides (wedged holder only)."
      skip_cleanup
      check_staleness   # same reasoning as the other SKIPPED* exits: a recurring skip must not go unnoticed
      verdict "GATE: SKIPPED-GATE-IN-FLIGHT (held by: $GATE_HOLDER)"; exit 0
    fi
    # Held for the rest of this process. Record who, for the next run's message.
    printf '%s pid=%s %s\n' "$(date -Is)" "$$" "${USER:-?}:live-federation-gate${GATE_FORCE:+ (GATE_FORCE)}" >"$GATE_LOCK.holder" 2>/dev/null || true
  fi
fi

# ── 0z. rig-lock pre-check (WI-5726/WI-5773 residual gap, 2026-07-25) ──────────
# local-matrix.sh (the RUN_LOCAL_MATRIX leg further below) already serializes correctly
# against a colliding run via a blocking flock on the single-tenant rig lock
# (/tmp/pcusp-local-rig.lock, per-NET) — see local-matrix.sh's own "single-tenant lock"
# section. The remaining gap: that lock isn't reached until AFTER this script's own
# REBUILD (rebuild+repack of a ~3.4GB .deb, several minutes) has already run. A window
# that is going to attempt local-matrix and finds the rig already held by another gate
# run (e.g. the hourly timer colliding with a manual GATE_FORCE run) therefore wastes a
# full rebuild before it ever reaches local-matrix.sh's own queue-or-fail-fast logic.
# This is a NON-BLOCKING PROBE ONLY — it takes and immediately releases the same lock
# file, never holds it, and never replaces local-matrix.sh's own (correct) blocking
# lock: if the rig frees up between this probe and the real invocation, or a stale
# holder loses the race, local-matrix.sh still serializes exactly as before. It only
# fires when this WINDOW would actually attempt the local-matrix leg (weekly cadence,
# same TTL gate the real invocation uses below) — otherwise the rig is irrelevant to
# this run and skipping the probe avoids a false skip on a content-matrix-only window.
# GATE_FORCE does NOT bypass this: a forced run colliding with an in-progress local-
# matrix run is exactly the collision this exists to catch cheaply, before the rebuild.
#
# ── RIG_WAIT=1 opt-in (WI-5137/P-402, 2026-07-25): QUEUE instead of skipping ──
# The skip above is correct for the UNATTENDED hourly timer (cheap to try again next hour),
# but on a contended box it is a STARVATION path for a DELIBERATE run: this rig is shared
# with every agent's targeted `local-matrix.sh --only=…` verification, so "rig busy" can be
# true for most of the working day and the gate then never reaches its verdict — silently,
# because each individual skip looks like a correct cheap no-op. That is the same
# never-runs-and-nobody-notices class as the LOAD_GATE defer and the MATRIX_TTL_H window
# (EI-18657324526667507); this is its third member. RIG_WAIT=1 says "I am a deliberate run,
# the rebuild is worth paying to get in line": we fall through to the rebuild and let
# local-matrix.sh's OWN blocking flock (RIG_LOCK_WAIT_S, default 7200s — the gate passes no
# override, so it queues) serialize us behind the holder. Safe by construction: the probe
# below never HOLDS the lock, so waiting here would not help and would only starve the
# holder's successor; the real queueing lives in local-matrix.sh where the lock is actually
# taken. The cost is one rebuild that may sit idle while queued — that is the whole point of
# making it opt-in rather than the default.
if [ "${RUN_LOCAL_MATRIX:-1}" = 1 ] && [ -e "$DESKTOP_DIR/bin/local-matrix.sh" ] \
   && [ "$(age_h "$STATE_DIR/last-matrix-green")" -ge "${MATRIX_TTL_H:-144}" ]; then
  RIG_LOCK_PRECHECK="${PCUSP_LOCAL_RIG_LOCK:-/tmp/pcusp-local-rig.lock}"
  if exec 8>>"$RIG_LOCK_PRECHECK" 2>/dev/null; then
    if ! flock -n 8; then
      RIG_HOLDER="$(cat "$RIG_LOCK_PRECHECK.holder" 2>/dev/null || echo 'unknown holder')"
      exec 8<&- 2>/dev/null || true
      if [ "${RIG_WAIT:-0}" = 1 ]; then
        log "rig busy (held by: $RIG_HOLDER) but RIG_WAIT=1 — NOT skipping: proceeding to the rebuild and queueing behind the holder via local-matrix.sh's own blocking flock (RIG_LOCK_WAIT_S, default 7200s). This run may sit queued for a long time; that is the opt-in."
      else
        log "rig busy (held by: $RIG_HOLDER) and this window would reach the local-matrix leg — skipping now, before the rebuild, rather than wasting one (non-blocking probe only; local-matrix.sh's own flock still serializes correctly regardless of this check). Set RIG_WAIT=1 to queue instead of skipping."
        skip_cleanup
        check_staleness   # by this point freshness was already ruled out above — same as the other SKIPPED* exits (load/github-api), unlike the FRESH* exits, this skip must not go unnoticed if it recurs
        verdict "GATE: SKIPPED-RIG-BUSY (held by: $RIG_HOLDER)"; exit 0
      fi
    else
      exec 8<&- 2>/dev/null || true   # release the probe immediately — we only peeked
    fi
  fi
fi

# ── 0a. prod-port guard (EI-11342, 2026-07-13) ─────────────────────────────────
# A rig-owned process must NEVER hold a production operator port. Incident (14:48–14:55Z):
# a packaged sidecar spawned under this gate lost its per-instance port override, fell back
# to the baked default 3070, and won the bind race against a mid-restart papercup-dev-api —
# prod crash-looped on EADDRINUSE and every fleet MCP call died with superuser_invalid_bearer
# until the squatter was killed by hand. This guard kills any RIG-OWNED listener on a prod
# port within seconds. Ownership test = cgroup membership (this service) OR a cwd/cmdline
# under a rig dir — a non-rig holder is prod itself and is never touched. NOTE: this is the
# rig-level recurrence guard; the ROOT-CAUSE half of EI-11342 (the packaged sidecar must fail
# loudly instead of falling back to the prod default port) stays open for the desktop lane.
PROD_PORTS="${GATE_PROD_PORTS:-3070 3170 3270}"
GUARD_TRIP_FILE="$WORK/prod-port-guard.tripped"
guard_prod_ports() { # <when-label> — kill rig-owned listeners on prod ports; record any trip
  local when="$1" p pid pids owned info
  for p in $PROD_PORTS; do
    pids="$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
    for pid in $pids; do
      owned=0
      grep -qa 'live-federation-gate' "/proc/$pid/cgroup" 2>/dev/null && owned=1
      if [ "$owned" = 0 ]; then
        # Capture-then-grep, NOT `{ …; } | grep -q` — same pipefail+SIGPIPE false-negative
        # hazard as gate_owns_rig_pid above (a MISSED rig-owned prod-port squatter is the
        # EI-11342 box-hijack this guard exists to stop, so the ownership read must be robust).
        info="$(readlink -f "/proc/$pid/cwd" 2>/dev/null; tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)"
        grep -qaE "papercusp-lane-[a-z0-9-]*-fed|$WORK" <<<"$info" && owned=1
      fi
      if [ "$owned" = 1 ]; then
        log "PROD-PORT GUARD ($when): rig-owned pid=$pid is LISTENING on prod :$p (EI-11342 class) — killing it. cmd: $(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | head -c 200)"
        echo "$when :$p pid=$pid" >>"$GUARD_TRIP_FILE"
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
      fi
    done
  done
  return 0
}
# ── 0a′. leaked-sidecar reaper (EI-14500) ──────────────────────────────────────
# A leg's smoke boots the packaged "Papercusp Server" (node … serve.mjs --ensure,
# with its OWN isolated PAPERCUSP_HOME + embedded PG on a private port). If a leg
# tears down uncleanly — or on ANY early / non-zero gate exit — that setsid-detached
# sidecar and its embedded PG get reparented to systemd --user and keep running for
# HOURS as orphans (EI-14500: the child + its embedded PG survived ~10h holding an
# isolated per-workspace state dir; each internal --ensure retry was a standing hazard
# for the embedded-pg.json box-hijack class). Reap any sidecar + embedded PG this gate
# transitively spawned, on the EXIT path, using the SAME rig-ownership test as the
# prod-port guard so a real (prod/live) operator sidecar is NEVER touched: cgroup
# membership in THIS gate service (reliable in the timer run — a setsid child stays in
# the spawning service's cgroup, and at EXIT-trap time the gate is still alive so its
# whole subtree is intact) OR a cwd/cmdline under a rig sandbox (a manual `bash …`
# run). Complements guard_prod_ports (which only reaps prod-port squatters).
GATE_SIDECAR_REAP_GRACE_S="${GATE_SIDECAR_REAP_GRACE_S:-2}"
gate_owns_rig_pid() { # <pid> — true iff pid belongs to THIS gate's rig sandbox
  local pid="$1" info
  grep -qa 'live-federation-gate' "/proc/$pid/cgroup" 2>/dev/null && return 0
  # Capture cwd + cmdline into a var, then grep a here-string — NOT `{ …; } | grep -q`.
  # This file runs under `set -o pipefail` (top): with a pipeline, `grep -q` short-circuits
  # on the FIRST (cwd) line and closes the pipe, so `tr` gets SIGPIPE and the pipeline
  # reports non-zero — making `… && return 0` MISFIRE and this predicate return "not owned"
  # for a genuinely rig-owned pid (an owned orphan then slips past reap_gate_sidecars'
  # `|| continue` and is NEVER reaped — the exact EI-14500 leak this reaper exists to close).
  info="$(readlink -f "/proc/$pid/cwd" 2>/dev/null; tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)"
  grep -qaE "papercusp-lane-[a-z0-9-]*-fed|/tmp/hive-fromrepo-smoke\.|/tmp/hive-dir-smoke\.|/tmp/merge-smoke\.|/tmp/p3-smoke\.|$WORK" <<<"$info" && return 0
  return 1
}
reap_gate_sidecars() { # reap rig-owned leftover serve.mjs/serve.ts sidecars + embedded PG
  local pid pids sigged=() cmdline
  # serve.(mjs|ts) = the sidecar (incl. `--ensure`); embedded-pg-data = its `postgres -D …`
  # child (own leaked pid in the EI-14500 evidence) if it survives the sidecar's SIGTERM.
  # NOTE (WI-5701): this pgrep is DELIBERATELY broad and also matches the esbuild BUNDLE
  # step (build-desktop-sidecar.sh: `npx esbuild bin/serve.ts --outfile=.../serve.mjs`) —
  # its argv literally contains "serve.ts"/"serve.mjs" as build I/O paths, not as a running
  # server. Narrowing happens below via the `--ensure` runtime contract, never on this
  # pattern alone.
  pids="$(pgrep -f 'serve\.(mjs|ts)|embedded-pg-data' 2>/dev/null || true)"
  for pid in $pids; do
    # (the gate itself is a `bash` process — never matches the serve/PG pgrep pattern)
    gate_owns_rig_pid "$pid" || continue
    # WI-5701: a REAL running sidecar is ALWAYS launched with `--ensure` (deb-hetzner-rig.sh,
    # app_role.rs's "Papercusp Server owns serve.mjs --ensure") — the esbuild BUNDLE step that
    # merely PRODUCES serve.mjs/serve.ts never carries that flag. Without this check, a
    # concurrent/stray gate invocation's EXIT-trap reap (this same function, cgroup-scoped to
    # the WHOLE `live-federation-gate` service — not to any one run's $WORK) SIGTERMs the
    # in-flight esbuild bundle of a DIFFERENT, still-legitimately-running gate's build: the
    # observed symptom was a clean sidecar build externally SIGTERM'd ~2m15s in, twice in a
    # row, wedging the green-checkpoint gate for two already-landed fixes. `embedded-pg-data`
    # matches are exempt — postgres never runs a build step, so it never needs `--ensure`.
    cmdline="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)"
    if [[ "$cmdline" != *embedded-pg-data* ]] && [[ "$cmdline" != *--ensure* ]]; then
      log "SIDECAR REAP (EI-14500/WI-5701): pid=$pid matches serve.(mjs|ts) but has no --ensure — looks like a BUILD step (esbuild bundling), not a running sidecar; sparing it. cmd: $(echo "$cmdline" | head -c 160)"
      continue
    fi
    log "SIDECAR REAP (EI-14500): rig-owned leftover pid=$pid — SIGTERM. cmd: $(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | head -c 160)"
    kill "$pid" 2>/dev/null || true
    sigged+=("$pid")
  done
  [ ${#sigged[@]} -eq 0 ] && return 0
  sleep "$GATE_SIDECAR_REAP_GRACE_S"   # let serve.mjs drain its embedded PG cleanly
  for pid in "${sigged[@]}"; do
    kill -0 "$pid" 2>/dev/null && { log "SIDECAR REAP (EI-14500): pid=$pid survived SIGTERM — SIGKILL."; kill -9 "$pid" 2>/dev/null || true; }
  done
  return 0
}
guard_prod_ports preflight
# Continuous sweep: a squat mid-smoke must die within seconds, not at leg end — the
# incident's damage window was the smoke's own multi-minute runtime. Reaped on exit.
( while :; do sleep "${GATE_PORT_GUARD_INTERVAL_S:-15}"; guard_prod_ports sweep; done ) &
GUARD_SWEEP_PID=$!
trap 'guard_prod_ports exit-trap; reap_gate_sidecars; kill "$GUARD_SWEEP_PID" 2>/dev/null || true; rm -rf -- "${GATE_SELF_SNAPSHOT_DIR:-}" 2>/dev/null || true' EXIT
# An external kill (unit TimeoutStartSec, manual systemctl stop) must NEVER end a run
# silently: the 2026-07-17 00:30 run was systemd-killed mid-local-matrix with no GATE:
# line, so watchers greping verdicts waited forever and the red-EI/state machinery never
# ran. Emit a distinct TERMINATED verdict (not RED — an external kill is not federation
# signal) with whatever leg statuses exist; the EXIT trap still reaps the port guard.
on_external_term() {
  verdict "GATE: TERMINATED (external signal — unit timeout or manual stop; legs at kill: content-matrix=${MATRIX_RES:-?} from-repo=${FROMREPO_RES:-?} local-matrix=${MATRIXFULL_RES:-?} build=$([ "${FAIL_BUILD:-0}" = 1 ] && echo FAIL || echo OK)) ; logs in ${WORK:-?}"
  exit 143
}
trap on_external_term TERM INT

# ── 0. assert-core self-test (WI-754) ──────────────────────────────────────────
# Hermetic (~2s, synthetic listeners, no .deb): prove the rig's PORT SELF-DISCOVERY
# logic (fed_probe_sidecar / fed_discover_sidecar_os in federation-asserts.sh)
# BEFORE spending minutes on heavy smokes. A broken assert core makes every smoke a
# confusing RED — catch that class here with a clear message. It adds no real load,
# so it runs on EVERY invocation, ahead of the load gate. (selftest SKIPs cleanly
# when python3/curl are absent → never a false RED.)
if [ "${GATE_SKIP_SELFTEST:-0}" != 1 ]; then
  if bash "$DESKTOP_DIR/bin/lib/federation-asserts.selftest.sh" >"$WORK/selftest.log" 2>&1; then
    log "assert-core self-test PASS (port self-discovery)"
  else
    log "assert-core self-test FAILED — federation-asserts.sh port discovery is broken; see $WORK/selftest.log"
    sed 's/^/  /' "$WORK/selftest.log" >&2
    verdict "GATE: RED (assert-core self-test failed — fix federation-asserts.sh before trusting the smokes)"
    exit 1
  fi
fi

# ── 1. admission gate — CPU PRESSURE, not host loadavg (WI-6151) ──────────────
# WHAT CHANGED + WHY (2026-07-26): admission used to skip on the host 1-min loadavg, which
# made this gate UNRUNNABLE BY CONSTRUCTION on the shared fleet box — 14:42 "GATE: SKIPPED
# (load 165.71 > 108)", 15:42 "(load 149.81 > 108)", ~10 SKIPPED fires in 24h and no verdict
# all day, while P-402/WI-5137 (gate-first-green) waited on it. A SKIPPED gate exits 0, so
# the pipeline read "not failing" the whole time. Two independent reasons that signal is wrong:
#
#  (a) It is the SAME number this file's OWN verdict path already documents as
#      non-representative of the rig (see :128, :909, :929, EI-18716933933700596: "Host
#      loadavg is a SHARED-BOX aggregate and does not measure these frames"). That path was
#      hardened against it; this admission path kept reading it raw — one file, two code
#      paths, opposite conclusions about whether host loadavg means anything.
#  (b) loadavg is NICE-BLIND. It counts runnable tasks, not CPU contention, so a task at
#      nice 19 weighs exactly as much as one at nice 0. The fleet's heavy work is
#      DELIBERATELY deferential (green-checkpoint runs its heavy legs at nice 10 via
#      scripts/pc-heavy.sh — WI-6140), so it yields to this gate by construction and still
#      counts in full against LOAD_GATE. Measured here 2026-07-26 19:46Z: ~89 cores of
#      nice>=10 work vs ~63 of nice<=0, loadavg ~150. No amount of nice/ionice/throttling
#      can lower that number — the old gate was unsatisfiable by any remedy short of an
#      idle box, which is why WI-6140's throttle worked perfectly and changed nothing here.
#
# THE SIGNAL WE ACTUALLY WANT is "would our smokes be starved of CPU", and cgroup-v2 PSI
# answers exactly that: it measures STALL TIME (runnable but waiting on CPU), so deferential
# work that yields does not register. Same kernel facility, same reasoning as
# _rd_remote_cpu_pressure() in bin/deb-hetzner-restart.sh (WI-5639) one level up: that helper
# reads a FRAME's own cgroup, this reads the host root cgroup.
#
# CALIBRATION (this box, 128 cores, 2026-07-26, sampled every 4s across loadavg 78-85 —
# i.e. an ordinary busy fleet hour): `some avg10` bounced 0.11-3.25 while `some avg60` held
# 2.18-2.41 and `some avg300` 1.41-1.49. Two field choices follow from that data:
#   • `some`, not `full` — `full` is structurally useless here (full total=0: on 128 cores
#     EVERY task has never once been stalled simultaneously), so it can never discriminate.
#   • avg60, not avg10 — this gate fires hourly and then runs for ~25min, so the question is
#     "will the next half hour be contended", which a 10s window answers badly: avg10 moved
#     30x inside one calm minute above. avg60 is the stable predictor. It is also the right
#     ASYMMETRY: a false SKIP is the expensive failure (it is the entire bug being fixed
#     here — a whole day with no verdict), while a false PROCEED is cheap and already
#     defended twice over by the mid-run STORM downgrade and the frame-scoped
#     event-loop-lag starvation check at the verdict. So prefer the spike-immune signal and
#     let the in-run guards catch a storm that starts after admission.
# PRESSURE_GATE 30 therefore sits ~12x above this box's observed steady state.
#
# THIS IS NOT A LOAD_GATE RAISE (owner decision D-003 forbids that, and LOAD_GATE is
# untouched — it still governs the no-PSI fallback below). What changed is WHICH QUANTITY is
# measured.
#
# ON D-003's PRESCRIBED REMEDY (isolation): do NOT lean this change on "the frames are
# isolated anyway", because that is not reliably true — the 13:39 run logged "WARN: degrading
# this run to AFFINITY-ONLY (no cgroup-v2 exclusive partition; host fleet NOT evicted)"
# (/tmp/live-fed-gate-20260726-133957). Read that carefully though: that run PREDATES the
# WI-6133 self-or-ancestor fix (which first appears in the tree at commit ba5bed69, 14:24,
# one minute before that very run's verdict), so it is evidence that the degradation existed,
# NOT evidence that the fix fails. Whether exclusivity engages now is an open question for
# the first run after 14:24 — see WI-6133.
#
# The justification that does NOT depend on any of that is the measurement: across the three
# most recent completed runs (12:17, 13:28, 14:25) the gate's own frame-scoped verdict read
# "frames NOT starved — worst [event-loop-lag] maxMs 0ms" while host loadavg sat in the
# 100-160 band. Whatever isolation was or was not in force, the frames were not starved and
# the host number said nothing about them — which is exactly why admission must not be
# decided by that number.
#
# Both numbers are logged on every path (and carried on the SKIPPED line) so the next
# investigator can recalibrate from real data instead of re-deriving this.
gate_cpu_pressure_some() {
  # echo the host root-cgroup CPU PSI `some <field>` (a 0-100 percentage; field defaults to
  # avg60), or "" when the kernel or cgroup mount does not expose PSI. NEVER fatal and never
  # a wrong number: an unreadable file, a non-PSI format, a missing field or a non-numeric
  # value all return "" so the caller falls back explicitly instead of silently reading 0
  # (which would admit blind — the opposite of what an unknown signal should do).
  local field="${1:-avg60}" f="${CPU_PRESSURE_FILE:-/sys/fs/cgroup/cpu.pressure}" line v
  [ -r "$f" ] || return 0
  line="$(grep -m1 '^some ' "$f" 2>/dev/null)" || return 0
  case "$line" in *"$field="*) ;; *) return 0 ;; esac
  v="${line#*"$field"=}"; v="${v%% *}"
  case "$v" in ''|*[!0-9.]*) return 0 ;; esac
  printf '%s' "$v"
}

LOAD1="$(cut -d' ' -f1 "${LOADAVG_FILE:-/proc/loadavg}" 2>/dev/null || echo 0)"
PRESSURE60="$(gate_cpu_pressure_some "${PRESSURE_FIELD:-avg60}")"
if [ -n "$PRESSURE60" ]; then
  ADMIT_SIGNAL="cpu-pressure-some-${PRESSURE_FIELD:-avg60}"; ADMIT_VALUE="$PRESSURE60"; ADMIT_GATE="$PRESSURE_GATE"
else
  # No PSI (non-PSI kernel / cgroup v1): fall back to the historical loadavg gate rather than
  # admitting blind. Expected to be rare on this fleet; named in the log so it is never silent.
  ADMIT_SIGNAL="loadavg-fallback-no-psi"; ADMIT_VALUE="$LOAD1"; ADMIT_GATE="$LOAD_GATE"
fi
ADMIT_CONTEXT="host loadavg $LOAD1 vs LOAD_GATE $LOAD_GATE — SHARED-BOX aggregate, nice-blind, NOT the admission signal (WI-6151)"
if awk "BEGIN{exit !($ADMIT_VALUE > $ADMIT_GATE)}"; then
  if [ "${GATE_FORCE:-0}" = 1 ]; then
    # GATE_FORCE means FORCE (WI-1861 follow-up): a forced run is an ATTENDED validation —
    # skip only the unattended-admission gate; the mid-run STORM downgrade still protects
    # the verdict if the box saturates while the smokes run.
    log "$ADMIT_SIGNAL $ADMIT_VALUE > gate $ADMIT_GATE but GATE_FORCE=1 — proceeding anyway (storm downgrade still armed); $ADMIT_CONTEXT."
  else
    log "SKIP: $ADMIT_SIGNAL $ADMIT_VALUE > gate $ADMIT_GATE — the box is genuinely CPU-contended, so the smokes would be starved; retry next window (not a failure). $ADMIT_CONTEXT."
    check_staleness
    skip_cleanup
    verdict "GATE: SKIPPED ($ADMIT_SIGNAL $ADMIT_VALUE > $ADMIT_GATE; $ADMIT_CONTEXT)"; exit 0
  fi
else
  log "admission OK: $ADMIT_SIGNAL $ADMIT_VALUE <= gate $ADMIT_GATE; proceeding. $ADMIT_CONTEXT."
  # ALSO on stdout, deliberately (WI-6151). log() writes to stderr, and stderr does NOT reach
  # this unit's journal — verified empirically: the whole 13:39-14:25 run emitted ZERO
  # "[live-fed-gate …]" lines to journald while its stdout `echo` verdict landed fine. So on
  # the PROCEED path the single most consequential branch in this script was invisible to
  # anyone watching the journal: you saw "Starting", then 45 minutes of silence, then a
  # verdict, with no record of what admission decided or on what numbers. (The SKIP path was
  # only visible by luck — its verdict happens to be an echo.) One line closes that.
  # Deliberately NOT prefixed "GATE: " — that namespace is the run's VERDICT and is pattern-
  # matched by consumers; this is a progress marker and must not be mistaken for one.
  echo "ADMISSION: PROCEED ($ADMIT_SIGNAL $ADMIT_VALUE <= $ADMIT_GATE; $ADMIT_CONTEXT)"
fi

# ── 1b. GitHub credentialed-REST preflight (2026-07-16 outage class) ───────────
# The smokes create/publish hives from REAL GitHub repos using the smoke accounts'
# tokens (fetchGithubRepoMeta repo-id lookup, resolveOwner attestation). On
# 2026-07-16 GitHub's edge served HTML 503 to ALL credentialed REST from this box
# for hours while anonymous requests, /rate_limit, and git-over-HTTPS all kept
# working — so the box looked healthy, but every run burned ~25 min into a false
# RED that mimics a code regression (announced=False, publish.memberLinks=0).
# Probe the exact call class the smokes need (authenticated REST read of the
# fixture repo) and SKIP loudly — like the load gate — when it is down:
# environmental, not a failure. check_staleness still runs, so a persistent
# outage trips the staleness EI instead of looking green.
if [ "${GATE_SKIP_GH_PREFLIGHT:-0}" != 1 ]; then
  GH_PREFLIGHT_USER="${GATE_GH_USER:-papercupai}"
  GH_PREFLIGHT_TOKEN="$(gh auth token --user "$GH_PREFLIGHT_USER" 2>/dev/null || true)"
  if [ -z "$GH_PREFLIGHT_TOKEN" ]; then
    # No token is a local misconfig, not the outage class — let the smoke surface it.
    log "WARN: no gh token for $GH_PREFLIGHT_USER — cannot preflight credentialed GitHub REST; proceeding."
  else
    GH_CODE=000
    for _try in 1 2 3; do
      GH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
        -H "Authorization: Bearer $GH_PREFLIGHT_TOKEN" \
        https://api.github.com/repos/octocat/Hello-World 2>/dev/null || echo 000)"
      [ "$GH_CODE" = 200 ] && break
      sleep 10
    done
    if [ "$GH_CODE" != 200 ]; then
      if [ "${GATE_FORCE:-0}" = 1 ]; then
        log "credentialed GitHub REST unhealthy (HTTP $GH_CODE) but GATE_FORCE=1 — proceeding anyway."
      else
        log "SKIP: credentialed GitHub REST unhealthy (HTTP $GH_CODE for $GH_PREFLIGHT_USER after 3 tries) — smokes would false-RED (announced=False/memberLinks=0); retry next window (not a failure)."
        check_staleness
        skip_cleanup
        verdict "GATE: SKIPPED (github-api-unhealthy HTTP $GH_CODE)"; exit 0
      fi
    else
      log "credentialed GitHub REST OK (200 for $GH_PREFLIGHT_USER); proceeding."
    fi
  fi
fi

# ── 1c. two-account attestation WRITE preflight (EI-20192345878553998) ────────
# §1b proves authenticated REST READS work. That does not prove either smoke account can
# CREATE the private gist that carries its device attestation: GitHub's unverified-email wall
# returns 200 for GET /user and GET /gists while POST /gists returns 422. The inner content
# matrix now catches that correctly, but only AFTER the wrapper has rebuilt/repacked a multi-GB
# desktop bundle. Run the SAME production probe here for BOTH DISTINCT identities before §2.
# Keep the inner probe as defense-in-depth: this wrapper saves the gate-wide cost; the smoke's
# own preflight keeps a direct/ad-hoc invocation honest.
preflight_attestation_write_account() {
  local expected_user="$1" token actual_login probe_out probe_rc
  token="$(gh auth token --user "$expected_user" 2>/dev/null || true)"
  if [ -z "$token" ]; then
    echo "ATTESTATION_WRITE: user=$expected_user code=token_missing detail=no-gh-token"
    return 1
  fi

  actual_login="$(GH_TOKEN="$token" gh api user --jq .login 2>/dev/null || true)"
  if [ -z "$actual_login" ]; then
    echo "ATTESTATION_WRITE: user=$expected_user code=identity_unavailable detail=GET-/user-failed"
    return 1
  fi
  if [[ "${actual_login,,}" != "${expected_user,,}" ]]; then
    echo "ATTESTATION_WRITE: user=$expected_user code=identity_mismatch actual=$actual_login"
    return 1
  fi

  probe_out="$({
    cd "$DESKTOP_DIR/.." &&
      PAPERCUSP_ATTEST_TOKEN="$token" PAPERCUSP_ATTEST_LOGIN="$actual_login" \
      npx tsx -e '
        import { probeGistWriteCapability } from "./packages/operator-core/lib/identity/attest.ts";
        async function main() {
          const user = process.env.PAPERCUSP_ATTEST_LOGIN ?? "unknown";
          const cap = await probeGistWriteCapability(process.env.PAPERCUSP_ATTEST_TOKEN ?? "");
          if (!cap.ok) {
            console.log(JSON.stringify({
              user,
              ok: false,
              code: cap.code,
              status: cap.status,
              detail: cap.detail,
              remediation: cap.remediation,
            }));
            process.exit(1);
          }
          console.log(JSON.stringify({ user, ok: true, cleanedUp: cap.cleanedUp }));
        }
        main().catch((err) => {
          console.log(JSON.stringify({
            user: process.env.PAPERCUSP_ATTEST_LOGIN ?? "unknown",
            ok: false,
            code: "probe_exception",
            detail: String(err),
          }));
          process.exit(1);
        });
      '
  } 2>&1)"
  probe_rc=$?
  printf '%s\n' "$probe_out"
  return "$probe_rc"
}

preflight_attestation_write_accounts() {
  local user out rc failed=0
  if [[ "${P_A_USER,,}" = "${P_B_USER,,}" ]]; then
    echo "ATTESTATION_WRITE: code=same_account user_a=$P_A_USER user_b=$P_B_USER detail=D-030-requires-distinct-accounts"
    return 1
  fi
  for user in "$P_A_USER" "$P_B_USER"; do
    out="$(preflight_attestation_write_account "$user" 2>&1)"
    rc=$?
    printf '%s\n' "$out"
    [ "$rc" -eq 0 ] || failed=1
  done
  return "$failed"
}

# WI-39359 (p2p-release lane) — mirrors the local-matrix leg's OWN admission conditions
# (RUN_LOCAL_MATRIX / wrapper present / cadence window) so the attestation wall below can ask
# "would the attestation-INDEPENDENT leg actually run this window?" before it decides whether
# blinding the entire gate is justified. Keep in sync with the leg's branches near the bottom.
local_matrix_due() {
  [ "${RUN_LOCAL_MATRIX:-1}" = 1 ] || return 1
  [ -e "$DESKTOP_DIR/bin/local-matrix.sh" ] || return 1
  [ "$(age_h "$STATE_DIR/last-matrix-green")" -ge "${MATRIX_TTL_H:-144}" ] || return 1
  return 0
}

P_A_USER="${P_A_USER:-papercupai}"
P_B_USER="${P_B_USER:-aviynw}"
ATTESTATION_PREFLIGHT_OUTPUT="$(preflight_attestation_write_accounts 2>&1)"
ATTESTATION_PREFLIGHT_RC=$?
ATTESTATION_BLOCKED=0
if [ "$ATTESTATION_PREFLIGHT_RC" -ne 0 ]; then
  printf '%s\n' "$ATTESTATION_PREFLIGHT_OUTPUT" >"$WORK/attestation-preflight.out"
  ATTESTATION_PREFLIGHT_SUMMARY="$(printf '%s' "$ATTESTATION_PREFLIGHT_OUTPUT" | tr '\n\t' '  ' | head -c 1800)"
  SUMMARY="attestation-write-preflight=FAIL accounts=$P_A_USER,$P_B_USER reason=$ATTESTATION_PREFLIGHT_SUMMARY"
  log "ATTESTATION WRITE PREFLIGHT RED before build: $ATTESTATION_PREFLIGHT_SUMMARY"
  echo "$(now_s)" >"$STATE_DIR/last-run"

  # WI-39359 — DO NOT BLIND THE WHOLE GATE ON A CREDENTIAL WALL.
  # Measured 2026-08-16: local-matrix.sh has ZERO functional attestation dependency (its only
  # three gist/attest matches are comments), while two-instance-content-matrix-smoke.sh has 37
  # (incl. its own preflight_attestation) and two-instance-hive-from-repo-smoke.sh has 45. So
  # when both GitHub identities cannot mint an attestation gist, the two GitHub-dependent legs
  # genuinely cannot run — but the 18-scenario local matrix (membership_churn, content_bidir,
  # replication_soak, restart_durability) still can, and it is the leg that carries the core
  # federation behaviour. Between 2026-08-14 and 2026-08-16 this early exit voided ~50 runs of
  # p2p coverage over a credential fault none of those scenarios touch.
  # COST CONTROL: only continue when the local-matrix leg is genuinely DUE, so the cheap early
  # exit (the reason this preflight exists — it saves a multi-GB build) still governs every
  # other window. Never GREEN in this state; see the ATTESTATION_BLOCKED guard at the verdict.
  if local_matrix_due; then
    ATTESTATION_BLOCKED=1
    log "ATTESTATION WALL: neither identity can mint an attestation gist, but local-matrix is DUE and has no attestation dependency — running it instead of voiding the window. GitHub-dependent legs will report SKIPPED-ATTESTATION-WALL."
  else
    verdict "GATE: RED (attestation-write-preflight) — $SUMMARY ; logs in $WORK"
  fi

  # email_unverified is already an explicit needs-human account wall. Recognize that
  # non-terminal item instead of cloning it; every other preflight failure still gets the
  # normal fail-loud filing path. In both cases last-red is stamped only when tracking is real.
  preflight_tracked=0
  if printf '%s' "$ATTESTATION_PREFLIGHT_OUTPUT" | grep -q '"code":"email_unverified"'; then
    wall_prefix="Fresh-home P2P gate depends on both GitHub accounts being able to create attestation gists"
    existing_wall="$(find_open_duplicate "$wall_prefix" active)"
    if [ -n "$existing_wall" ]; then
      log "attestation email wall already tracked as non-terminal $existing_wall — no duplicate filing."
      preflight_tracked=1
    fi
  fi
  if [ "$preflight_tracked" != 1 ]; then
    early_title="live-federation-gate RED: attestation-write-preflight failed before build ($STAMP)"
    early_prefix="live-federation-gate RED: attestation-write-preflight failed before build ("
    existing_early="$(find_open_duplicate "$early_prefix" active)"
    if [ -n "$existing_early" ]; then
      log "attestation preflight red already tracked as non-terminal $existing_early — no duplicate filing."
      preflight_tracked=1
    elif file_ei "$early_title" "The live federation gate proved neither build nor protocol because the required two distinct GitHub identities failed their attestation gist WRITE preflight. $SUMMARY. This runs before sidecar build by design; do not bypass distinct-account coverage. Logs: $WORK/attestation-preflight.out."; then
      preflight_tracked=1
    fi
  fi
  # Deliberately do NOT stamp last-red here. The standard protocol/build RED below backs off
  # because re-running the full gate is expensive and unchanged code adds no signal. This
  # preflight exits before §2, costs only two write probes, and its state can change without a
  # code change when the account email is verified. Re-check it next window so that external
  # remediation unblocks the gate promptly; dedup above prevents the hourly check cloning work.
  [ "$preflight_tracked" = 1 ] \
    && log "attestation preflight red is durably tracked; next window rechecks the cheap prerequisite before any build." \
    || log "attestation preflight red is not durably tracked; next window rechecks and retries filing before any build."
  check_staleness
  # WI-39359: exit only when the attestation-independent leg would NOT have run anyway.
  # When ATTESTATION_BLOCKED=1 we fall through to §2 and run local-matrix; the two
  # GitHub-dependent legs are force-skipped with a token that names WHY, so a reader can
  # never mistake "we could not test this" for "we tested this and it passed".
  if [ "$ATTESTATION_BLOCKED" != 1 ]; then
    exit 1
  fi
  SKIP_MATRIX=1
  SKIP_FROMREPO=1
  ATTESTATION_WALL_TOKEN="SKIPPED-ATTESTATION-WALL"
else
  log "attestation WRITE preflight OK for both distinct accounts ($P_A_USER, $P_B_USER); proceeding to build."
fi

# ── 2. fresh artifact: rebuild sidecar from HEAD, then REPACK a .deb (content-matrix needs a .deb;
#       from-repo uses the sidecar directly). $GATE_DEB short-circuits to a prebuilt .deb. ───────
FAIL_BUILD=0
if [ -n "${GATE_DEB:-}" ] && [ ! -f "$GATE_DEB" ]; then
  log "WARN: GATE_DEB=$GATE_DEB does not exist — ignoring stale override and rebuilding/repacking if enabled."
  GATE_DEB=""
fi
if [ -z "${GATE_DEB:-}" ]; then
  if [ "$REBUILD" = 1 ]; then
    # Build PROVENANCE (WI-1861): the build reads the LIVE shared working tree, not committed
    # HEAD — a fleet peer's mid-write edit can be captured ("torn-tree build") and produce a
    # red no commit ever contained (the 11:53 2026-07-03 'blueprint invalid' red is the type
    # specimen: unreproducible at the next build, byte-identical blueprints). Stamp HEAD + the
    # dirty-file count so every verdict is attributable and a torn-tree red is diagnosable.
    GIT_HEAD="$(cd "$DESKTOP_DIR/.." && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    GIT_DIRTY="$(cd "$DESKTOP_DIR/.." && git status --porcelain 2>/dev/null | wc -l || echo '?')"
    log "rebuilding sidecar from working tree (HEAD=$GIT_HEAD, dirty-files=$GIT_DIRTY)…"
    echo "head=$GIT_HEAD dirty=$GIT_DIRTY ts=$(date -Is)" >"$WORK/provenance"
    # WI-5706: a bare dirty COUNT let two agents correlate "dirty=1" to a schema-drift
    # red (stale query text bundled mid-rename) but not to the EXACT in-flight edit — by
    # the time anyone looked, the tree had moved on and the specific diff was gone. Persist
    # the actual dirty-file list (paths only, not full diff contents — cheap, and a path
    # alone is usually enough to spot "this touches the routines/harness-status query path")
    # so a future dirty+erroring run is attributable to its cause, not just its symptom.
    if [ "${GIT_DIRTY:-0}" != "0" ] && [ "${GIT_DIRTY:-?}" != "?" ]; then
      ( cd "$DESKTOP_DIR/.." && git status --porcelain ) >"$WORK/dirty-files.txt" 2>/dev/null || true
    fi
    ( cd "$DESKTOP_DIR" && bash bin/build-desktop-sidecar.sh ) >"$WORK/build.log" 2>&1 || { FAIL_BUILD=1; log "BUILD FAILED — $WORK/build.log"; }
  fi
  # Grep the FUNCTION NAME, not a log phrase: the original 'grantEpochKeysToMembers on
  # admit' literal was reworded out of the source and the stale check WARNed on every
  # build while the mechanism was in fact present (bundle carries the symbol 3x).
  grep -qa 'grantEpochKeysToMembers' "$DESKTOP_DIR/src-tauri/sidecar/serve.mjs" 2>/dev/null \
    || log "WARN: fresh serve.mjs lacks the Seam-2 grantEpochKeysToMembers symbol — re-key legs may false-RED."
  # 2026-07-18 (run 20260718-000508): a nested sidecar publish (concurrent cargo
  # build.rs placeholder squatted src-tauri/sidecar mid-swap; the bundler's mv then
  # published sidecar/sidecar.tmp.<pid>/) shipped a serve.mjs-less sidecar into the
  # gate deb — the smoke died 7 min in on luxon injection and the run burned a
  # content-matrix RED on pure build corruption. Refuse to repack a tree that is
  # obviously not a sidecar bundle: that is a BUILD red, not a matrix red.
  if [ "$FAIL_BUILD" != 1 ] && [ ! -f "$DESKTOP_DIR/src-tauri/sidecar/serve.mjs" ]; then
    FAIL_BUILD=1
    log "BUILD FAILED — src-tauri/sidecar has no serve.mjs (nested sidecar.tmp.* publish?) — refusing to repack a corrupt sidecar tree"
  fi
  # EI-20580419609576585 — the REPACK must not be gated on SKIP_MATRIX alone. SKIP_MATRIX=1
  # is set by the attestation wall (:1086) to force-skip the two GITHUB-dependent legs, but
  # the repack it also suppressed is what produces $GATE_DEB — and $GATE_DEB is what :1520
  # passes to local-matrix.sh as `--deb=`. With no --deb, local-matrix falls back to its
  # implicit newest-bundle pick and hard-fails the staleness guard (common.sh
  # _warn_if_deb_stale, which dies when ANY commit touching apps/operator is newer than the
  # .deb by even one second and renders that as a misleading "~0d OLDER"). Net effect: the
  # owner-gated GITHUB wall silently disabled the attestation-INDEPENDENT leg too, which is
  # the exact outcome the wall's own design comment at :1042 says it is avoiding.
  # So: repack whenever the build succeeded AND some leg will actually consume the artifact —
  # content-matrix (SKIP_MATRIX != 1) or the local-matrix leg (local_matrix_due, the same
  # predicate the wall itself consults at :1009). Keeps the repack cost off windows where
  # nothing would use it, instead of tying it to an unrelated flag.
  if [ "$FAIL_BUILD" != 1 ] && { [ "$SKIP_MATRIX" != 1 ] || local_matrix_due; }; then
    CARGO_TARGET_ROOT="${CARGO_TARGET_DIR:-$HOME/.cargo-target}"
    BASE_DEB="$(ls -t \
      "$DESKTOP_DIR"/src-tauri/target/release/bundle/deb/Papercusp*_amd64.deb \
      "$CARGO_TARGET_ROOT"/release/bundle/deb/Papercusp\ GUI_*_amd64.deb \
      "$CARGO_TARGET_ROOT"/release/bundle/deb/Papercusp_*_amd64.deb \
      /tmp/*/Papercusp_integrated.deb 2>/dev/null | head -1)"
    if [ -n "$BASE_DEB" ]; then
      GATE_DEB="$WORK/Papercusp_gate.deb"
      ( cd "$WORK" && mkdir -p pkg && dpkg-deb -R "$BASE_DEB" pkg \
          && APPDIR="$(find pkg/usr/lib -maxdepth 1 -mindepth 1 -type d | head -1)" && rm -rf "$APPDIR/sidecar" && cp -r "$DESKTOP_DIR/src-tauri/sidecar" "$APPDIR/sidecar" \
          && dpkg-deb -b pkg "$GATE_DEB" && rm -rf pkg ) >"$WORK/repack.log" 2>&1 \
        && log "repacked fresh .deb (base=$BASE_DEB)" || { log "repack FAILED ($WORK/repack.log) — skipping content-matrix"; GATE_DEB=""; SKIP_MATRIX=1; }
    else
      log "no base .deb to repack — skipping content-matrix leg"; SKIP_MATRIX=1
    fi
  fi
fi

# ── 3. run the smokes ─────────────────────────────────────────────────────────
# PASS iff an `OVERALL: PASS` line exists in the smoke output.
# DISCOVERY-RETRY: the from-repo flow discovers via cupboard-off DHT gossip, which lands
# only ~50% of the time per attempt (no cupboard service → directory-only). A single run
# would false-RED the gate half the time on a flake, not a regression — so we re-run (up to
# DISCOVERY_ATTEMPTS, default 3) ONLY when the failure is `discovered=FAIL` (the flake), never
# on a real post-discovery failure. ~3 attempts ⇒ ~88% chance discovery lands. Each attempt is
# load-gated implicitly (the whole gate already passed the load check; a flake adds little).
# DISPLAY-BUSY (WI-1977): fed_fresh_display (federation-asserts.sh) refuses a busy Xvfb
# display with `FATAL: :$num busy — set PAPERCUSP_SMOKE_DISPLAY to a free one` rather than
# ever sharing a peer's display. The gate's own fixed GATE_DISPLAY default (250, +2=252 for
# from-repo) is ALSO the number a human/agent reproducing a gate red picks when they want an
# EXACT match (an "evidence pair" left intentionally running for a debugging thread) — so an
# hourly timer run can collide with a legitimate, long-lived evidence pair that has nothing to
# do with a real regression. Unlike the discovery flake above, retrying buys nothing (the
# display stays busy for as long as the OTHER process holds it) — classify it as a resource
# contention SKIP, never a RED, matching this file's existing storm-downgrade / load-gate-skip
# philosophy (a busy resource is starvation, not signal).
run_smoke() {  # <label> <script> <deb-or-empty> <extra-env...>
  local label="$1" script="$2" deb="$3"; shift 3
  local out="$WORK/$label.out" attempts="${DISCOVERY_ATTEMPTS:-3}" i res
  for i in $(seq 1 "$attempts"); do
    log "running $label (attempt $i/$attempts) …"
    ( cd "$DESKTOP_DIR/.." && env "$@" bash "papercusp-desktop/bin/$script" ${deb:+"$deb"} ) >"$out" 2>&1 || true
    # ANCHORED (WI-37222). This pattern was `OVERALL: PASS` unanchored, which also matches the
    # SUBSET verdict lines the smokes emit — `WITNESS OVERALL: PASS`, `MODERATION OVERALL: PASS`,
    # `ATTESTATION OVERALL: PASS`. A run whose CORE legs failed but whose witness/moderation/
    # attestation subset passed therefore scored this leg PASS off the subset's line. Latent, never
    # observed firing (the one banked from-repo.out has core=1/subsetPASS=0), but a false GREEN on
    # the release gate is not a defect to leave armed — and the subsets are scored separately below
    # precisely so they cannot stand in for the core verdict. Both scripts run_smoke invokes emit
    # their core `OVERALL: PASS` at column 0 (verified: content-matrix:466, from-repo:1137), and no
    # smoke in bin/ emits an indented bare one, so anchoring cannot false-FAIL a genuine pass.
    if grep -qaE '^OVERALL: PASS' "$out" 2>/dev/null; then echo PASS; return; fi
    if grep -qaE 'busy — set PAPERCUSP_SMOKE_DISPLAY to a free one' "$out" 2>/dev/null; then
      log "$label: display busy (a long-lived pair — likely evidence for another investigation — already holds it) — SKIPPING, not a regression"
      echo SKIPPED-BUSY; return
    fi
    # Retry ONLY on a discovery flake; a real post-discovery RED is a genuine result — keep it.
    if grep -qaE 'discovered=FAIL' "$out" 2>/dev/null && [ "$i" -lt "$attempts" ]; then
      log "$label: discovered=FAIL (cupboard-off DHT flake) — retrying"; cp "$out" "$out.attempt$i" 2>/dev/null; continue
    fi
    # Retry a BOOT-READINESS flake (WI-3734, 2026-07-10): an EMPTY-body "create failed" /
    # "B join failed" — curl got NO response content at all, not even a JSON error body —
    # is the signature of firing a live API call against a sidecar that fed_wait_api
    # accepted (incl. via its "legacy liberal accept" fallback) before it actually
    # finished booting (embedded-PG init + ~400 migrations under load), NOT a protocol
    # regression: a genuine create/join failure always returns actual JSON error content
    # after the colon (see two-instance-content-matrix-smoke.sh:157/276). Confirmed live
    # on this fleet's high-load box (2026-07-10 12:42 + 13:38 runs): both hit this exact
    # empty-body signature on attempt 1 and were never retried — this class fell through
    # every existing safety net (load-gate admission checks only the START load; the
    # end-of-run STORM downgrade only fires if load is STILL high at verdict time, not
    # transiently high mid-boot; this discovery-flake retry only matched a different
    # signature) and reached the gate's verdict as a bare content-matrix=FAIL. Mirrors the
    # discovery-flake retry above exactly — same rationale, same bounded attempts budget.
    if grep -qaE '✗ (create|B join) failed: *$' "$out" 2>/dev/null && [ "$i" -lt "$attempts" ]; then
      log "$label: empty-body create/join failure (sidecar boot-readiness flake, not a protocol regression) — retrying"; cp "$out" "$out.attempt$i" 2>/dev/null; continue
    fi
    break
  done
  echo FAIL
}

# EI-18721667437666267: the two-instance pair writes its instance logs to a FIXED work dir
# (two-instance-content-matrix-smoke.sh:50 — PAPERCUSP_MATRIX_WORK, default
# ~/.papercusp-lane-a-fed; :90 — inst-a.log/inst-b.log) and REUSES it every run. Those two
# files hold the ONLY federation evidence — [swarm] lifecycle, [swarm:unpaired] escalations,
# [boot-history] announce_admitted/announce_pending — and the gate's per-run dir never kept
# them, so the next scheduled run destroyed a failing run's evidence before anyone triaged it.
# OBSERVED 2026-07-26: three consecutive failing runs (074510/083840/094205) all lost their
# logs; only the PASSING 104022 run's survived — exactly the wrong sample. WI-5673 had to be
# root-caused from a passing run plus source reading because of this.
#
# Bank UNCONDITIONALLY, not just on red: a run that looks green at verdict time is routinely
# the baseline you need to diff a later red against, and the carve-out logic below can
# downgrade a FAIL to PASS-971 *after* the leg has already run. The per-run dir already holds
# a ~3.2GB .deb, so a few MB of logs is free. Never fail the gate over banking — a copy error
# is logged and swallowed.
bank_pair_logs() {  # <label> [pair-work-dir]
  local label="$1"
  local src="${2:-${PAPERCUSP_MATRIX_WORK:-$HOME/.papercusp-lane-a-fed}}"
  local dst="$WORK/pair-logs-$label" n=0 f
  if [ ! -d "$src" ]; then
    log "bank_pair_logs($label): no pair work dir at $src — nothing to bank"; return 0
  fi
  mkdir -p "$dst" 2>/dev/null || { log "bank_pair_logs($label): could not create $dst — skipping"; return 0; }
  for f in "$src"/inst-*.log; do
    [ -e "$f" ] || continue
    if cp -p "$f" "$dst/" 2>/dev/null; then n=$((n+1)); fi
  done
  # The pair is deliberately LEFT RUNNING on exit (see the singleton guard's note above), so
  # these logs keep growing after the leg — this is a point-in-time copy taken at verdict time.
  log "bank_pair_logs($label): banked $n pair log(s) from $src -> $dst"
}
# True iff a leg's result string is any flavor of "nothing proven" (SKIPPED / SKIPPED-BUSY /
# SKIPPED-STARVATION).
is_skip_result() { case "$1" in SKIPPED*) return 0 ;; *) return 1 ;; esac; }

# ── local-matrix frame-starvation downgrade (WI-5329, 2026-07-19) ─────────────────────────
# THE GAP THIS CLOSES: the STORM_GATE comment above already CLAIMS "the honest starvation
# signal is event-loop-lag inside the frame serve.logs (grep '[event-loop-lag]'), which the
# verdict reader checks per WI-5319" — but no such check existed anywhere in this gate or in
# local-matrix.sh. Host loadavg (STORM_GATE) is a single END-OF-RUN sample and, per that same
# comment, a weak proxy once frames are cpuset-pinned — a mid-run CPU spike (exactly when the
# restart-heavy scenarios below hammer the pinned frames) can have subsided by verdict time
# even though it already caused the failure. ROOT-CAUSED live (WI-5329, gate runs
# 20260717-211750 through 20260719-094058): restart_durability/reconnect_catchup/
# replication_soak REDs correlate with `[event-loop-lag] high loop delay — host is CPU-bound
# on the main thread` (maxMs > 1s) inside the FRAME's own serve.log at the exact moment its
# substrate boot blew the 30s timeout (`boot timeout after 30000ms` → zombie window → late
# boot ADOPTED, repeating every restart cycle) — while the single end-of-run host loadavg
# sample was, on at least one run (09:40:54 same day), NOT above STORM_GATE, so a purely
# environmental starvation event was filed as a fresh regression bug.
#
# DELIBERATELY NARROW (mirrors the content-matrix PASS-971 carve-out's discipline above):
# downgrades ONLY when (a) EVERY failing scenario in this run's local-matrix.out is one of the
# restart-heavy class already known to trip this (a FAIL in any OTHER scenario — concurrent
# writes, directory, … — is a genuine regression signature and is NEVER downgraded here) AND
# (b) a banked frame log from THIS SPECIFIC run actually shows the starvation symptom, not
# merely that the host was generically busy.
#
# revocation_kcut CASCADE CARVE-OUT (WI-5616, 2026-07-20): bin/lib/scenarios/b3-revocation.sh's
# own BASELINE-FAIL probe already self-attributes a revocation_kcut FAIL to a same-run
# replication_soak failure (it checks SCN_RC[replication_soak] and, when nonzero, reports
# "SAME downstream WI-183-class stall (see WI-5481/WI-5448), not a fresh regression" instead
# of a roster/regression verdict) — cross-run-evidenced (EI-15535, WI-5481, WI-5448) as the SAME
# starvation class this downgrade already exists to catch, just observed one scenario later.
# Before this carve-out, that documented attribution was trusted by the scenario script but
# IGNORED here: any revocation_kcut FAIL riding alongside a starvation-class replication_soak
# FAIL still blocked the downgrade (revocation_kcut wasn't in STARVATION_PRONE_SCENARIOS), so a
# fresh "NEW regression — investigate" bug got filed on every such run (WI-5616 is one instance).
# So: a revocation_kcut FAIL is ALSO tolerated, but ONLY when replication_soak is ALSO among
# this run's failures (mirrors b3-revocation.sh's own gate exactly) — an isolated revocation_kcut
# FAIL with no replication_soak FAIL in the same run is NEVER downgraded here; it stays a
# genuine regression signature, same as before.
STARVATION_PRONE_SCENARIOS="restart_durability reconnect_catchup replication_soak"
local_matrix_only_starvation_prone_fails() { # <local-matrix.out path>
  local out="$1" name all_known=1 saw_any=0 fails
  [ -f "$out" ] || return 1
  fails="$(grep -aoE '^[[:space:]]*FAIL[[:space:]]+[A-Za-z0-9_]+' "$out" 2>/dev/null | awk '{print $2}' | sort -u)"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    saw_any=1
    case " $STARVATION_PRONE_SCENARIOS " in
      *" $name "*) continue ;;
    esac
    if [ "$name" = revocation_kcut ] && printf '%s\n' "$fails" | grep -qx 'replication_soak'; then
      continue   # cascade-tolerant: see the revocation_kcut CASCADE CARVE-OUT comment above
    fi
    all_known=0
  done <<<"$fails"
  [ "$saw_any" = 1 ] && [ "$all_known" = 1 ]
}
_frame_lag_scan() { # <leg-start-epoch-s> — echo "<files> <worst_maxms> <starved_files>" for the
  # banked frame serve.logs belonging to THIS run (mtime after the leg started). The single
  # scanner behind BOTH the starvation downgrade predicate and the verdict-line note below, so
  # the number a verdict PRINTS can never disagree with the number the downgrade DECIDED on.
  local start_ts="${1:-0}" bank_dir="${RIG_BANK_DIR:-$HOME/.papercusp/live-fed-gate/triage}"
  local f maxms files=0 hits=0 worst=0 marker
  [ -d "$bank_dir" ] || { echo "0 0 0"; return 0; }
  marker="$(mktemp -u 2>/dev/null || echo "/tmp/.lfg-starvation-marker.$$")"
  touch -d "@$start_ts" "$marker" 2>/dev/null || touch "$marker" 2>/dev/null
  while IFS= read -r -d '' f; do
    files=$((files + 1))
    maxms="$(grep -aoE 'maxMs: [0-9.]+' "$f" 2>/dev/null | grep -oE '[0-9.]+' \
      | awk 'BEGIN{m=0} {if($1+0>m) m=$1+0} END{print m+0}')"
    awk "BEGIN{exit !($maxms > $worst)}" 2>/dev/null && worst="$maxms"
    if awk "BEGIN{exit !($maxms > 1000)}" 2>/dev/null; then hits=$((hits + 1)); fi
  done < <(find "$bank_dir" -maxdepth 1 -name 'serve-*.log' -newer "$marker" -print0 2>/dev/null)
  rm -f "$marker" 2>/dev/null
  echo "$files $worst $hits"
}
check_local_matrix_frame_starvation() { # <leg-start-epoch-s> — true iff a banked frame
  # serve.log from THIS run (mtime after the leg started) shows severe frame-local CPU
  # starvation. 1000ms is conservative: healthy runs on this fleet box see occasional
  # sub-300ms event-loop blips; a >1s single-threaded stall is enough to blow the 30s
  # substrate-boot budget by a wide margin on its own.
  local hits
  hits="$(_frame_lag_scan "$1" | awk '{print $3+0}')"
  [ "${hits:-0}" -gt 0 ]
}
# frame_pressure_note — EI-18716933933700596. Echo the FRAME-SCOPED reading that must be
# printed ALONGSIDE any host-loadavg number on a verdict/downgrade line.
#
# WHY THIS EXISTS: every load-flavoured line this gate emits ("SKIPPED (load …)",
# "SKIPPED-STORM (load …)", the RED verdict) used to carry the HOST 1-min loadavg and nothing
# else. That number is a shared-box aggregate and is NOT cgroup-scoped (WI-5639: read from
# inside a frame it still reports the host), so it cannot tell "this rig's frames were starved"
# from "a hundred unrelated containers on the shared dev box were busy" — and by naming ONLY
# load, the line actively invites the reader to conclude "the box was too loaded" and stop.
# Observed live 2026-07-26: host loadavg 129.64 while the rig frames sat at CPU 8.21%/2.34%
# with frame-scoped cpu.pressure some+full avg10/60/300 all 0.00 — the frames were idle and the
# real generator was three unrelated long-lived pgvector containers doing D-state I/O. An
# investigator reading the failure line alone had no way to see that without hand-correlating
# docker stats. So: state the frame-scoped verdict on the same line, including the explicit
# "do NOT read the host number as frame starvation" when the frames are provably clean.
#
# Best-effort and never fatal: with no banked frame evidence it says exactly that (an unknown
# is reported as unknown, never silently as "not starved").
frame_pressure_note() { # [start-epoch-s] -> one-line frame-scoped reading
  local start_ts="${1:-${MATRIX_LEG_START_TS:-${GATE_RUN_START_TS:-0}}}" scan files worst hits
  scan="$(_frame_lag_scan "$start_ts" 2>/dev/null || echo "0 0 0")"
  files="$(printf '%s' "$scan" | awk '{print $1+0}')"
  worst="$(printf '%s' "$scan" | awk '{print $2+0}')"
  hits="$(printf '%s' "$scan" | awk '{print $3+0}')"
  if [ "${files:-0}" -eq 0 ]; then
    echo "frame-scoped: UNKNOWN (no frame serve.log banked for this run — the host load number below neither rules frame starvation in nor out)"
  elif [ "${hits:-0}" -gt 0 ]; then
    echo "frame-scoped: STARVED — $hits/$files banked frame log(s) from this run show [event-loop-lag] maxMs up to ${worst}ms (>1000ms): the frames themselves were genuinely stalled"
  else
    echo "frame-scoped: frames NOT starved — $files banked frame log(s) from this run, worst [event-loop-lag] maxMs ${worst}ms (<=1000ms). Host loadavg is a SHARED-BOX aggregate and does not measure these frames (WI-5639) — do NOT conclude 'the box was too loaded' from it; look for a real regression"
  fi
}

MATRIX_RES="${ATTESTATION_WALL_TOKEN:-SKIPPED}"
if [ "$SKIP_MATRIX" != 1 ]; then
  MATRIX_RES="$(run_smoke content-matrix two-instance-content-matrix-smoke.sh "${GATE_DEB:-}" \
    PAPERCUSP_SMOKE_DISPLAY="$GATE_DISPLAY" DISCOVERY_RETRIES=100)"
  # EI-18721667437666267 — bank the pair's federation logs into this run's artifact dir
  # BEFORE the next run overwrites them. Must stay here, immediately after the leg: the
  # carve-out below can rewrite MATRIX_RES, and banking must not depend on the verdict.
  bank_pair_logs content-matrix
  # TEMPORARY MITIGATION — known-red carve-out, re-scoped 2026-07-03 after the WI-971
  # differential (evidence: WI-971 thread post 49980, live attempt-5 pair):
  #   · backfill / backfill-late reds = WI-1942 (receive-side historical-catch-up LATENCY;
  #     send side verified clean — A drains seeds instantly). The smoke's phase-6b
  #     late-recheck discriminates latency (phase-5 red / 6b green) from death (both red);
  #     BOTH classes stay carved out because WI-1942 is filed + owned, and a known
  #     latency-class miss must not block the regressions this gate exists to catch.
  #   · incr-B→A reds = were a SMOKE artifact (WS_B pre-join mis-derive, fixed in the
  #     smoke) + the joiner home-view drain gap (join-hive.ts 2c′, landed 2026-07-03
  #     ~14:12). Kept in the carve-out ONLY until the post-fix verify run lands —
  #     NARROW this regex to the backfill classes alone once WI-971 closes, and remove
  #     the whole block when WI-1942 closes.
  # Downgrade a FAIL to PASS-971 ONLY when the run got past join AND every hard ✗ line
  # is exactly these signatures — an incr-A→B miss, a create/join fail, or any other ✗
  # stays a genuine RED.
  if [ "$MATRIX_RES" = FAIL ] && grep -qa '✓ B joined' "$WORK/content-matrix.out" 2>/dev/null; then
    # EI-8385-class fix (2026-07-09): `grep -c PATTERN FILE || echo 0` is a classic bash
    # double-output trap — `grep -c` ALWAYS prints a count (even "0") but exits 1 when
    # that count is zero, so on a zero-match run BOTH the "0" grep already printed AND
    # the `|| echo 0` fallback fire, leaving X_TOTAL/X_OTHER as a TWO-LINE "0\n0" string.
    # `[ "$X_OTHER" -eq 0 ]` then dies with "integer expression expected" (visible in
    # journalctl as `line N: [: 0\n0: integer expression expected`), the `if` never
    # matches, and a content-matrix FAIL that fully qualifies for the documented PASS-971
    # carve-out below is left as a genuine RED every single run — the actual root cause
    # behind the WI-3358/WI-3477 duplicate-bug-storm this file's RED-EI dedup masked but
    # never fixed. Use `|| true` (adds no output) + a param-expansion default (covers the
    # file-missing case, where grep exits 2 with no output at all) so each var is always
    # exactly one clean integer line.
    X_TOTAL="$(grep -ac '✗' "$WORK/content-matrix.out" 2>/dev/null || true)"; X_TOTAL="${X_TOTAL:-0}"
    X_OTHER="$(grep -a '✗' "$WORK/content-matrix.out" 2>/dev/null | grep -acvE '(backfill(-late)?|incr-B→A) +NEVER crossed' || true)"; X_OTHER="${X_OTHER:-0}"
    if [ "$X_TOTAL" -ge 1 ] && [ "$X_OTHER" -eq 0 ]; then
      # assert-integrity-ok: this IS a FAIL→PASS downgrade, but a narrowly-gated, LOUDLY-LOGGED
      # one — not the silent default-to-pass R2 hunts. It fires only when X_TOTAL>=1 (hard-fails
      # genuinely occurred) AND X_OTHER==0 (every one matches a documented known-red class); the
      # log line immediately below states "NOT a clean pass"; and PASS-971 is a DISTINCT token
      # from PASS, so no downstream reader can mistake it for clean. The residual risk — that a
      # known-red carve-out masks a real regression indefinitely — is a scenario-level concern
      # tracked as EI-18657324526667507, not something this line-level lint can adjudicate.
      MATRIX_RES="PASS-971"
      log "content-matrix FAIL downgraded → PASS-971: all $X_TOTAL hard-fails match the documented known-red classes (backfill/backfill-late = WI-1942 latency; incr-B→A = WI-971 fix landed, verify pending); everything else green. NOT a clean pass."
    fi
  fi
  log "content-matrix → $MATRIX_RES"
fi
# The from-repo leg runs WITNESS_PROBE=1 + the re-key flag so it also exercises the AK
# owner-enforcement + the device-filtered C-001 re-key cut (K0-K3) — the re-key was the 3rd
# green-rig/red-binary bug (A-003, WI-259, WI-280), all hermetically-green but live-red, so the
# live gate must cover them too. STATUS (2026-07-25, WI-5775 verify): the outbox-drain leg
# itself (WI-971/WI-259) is now VERIFIED FIXED — two live runs both PASS, bidirectional +
# continuous federation. WI-280/WI-1666 (re-key K0-K3) also verified PASS this run. The
# WITNESS sub-probe's AK-ban leg (policy-only ban, revoke:false) WAS a separate failing
# concern (WI-5783, filed 2026-07-25) — B's write still landed on A after a ban. WI-5783 is
# now RESOLVED (2026-07-26, live-verified PASS on 3 consecutive from-repo WITNESS runs): the
# owner instance ran TWO merge loops for the same Hive, and the member-scoped one resolved its
# policy lookup as opts.harnessSlug — missing the ban policy written under the pot/home slug —
# so enforcement silently fell back to a no-op apply. Because `run_smoke` only greps this
# smoke's own top-level `OVERALL: PASS` line, a WITNESS-only failure would otherwise pass
# silently (the smoke's own OVERALL line does not fold WITNESS in) — the explicit WITNESS_RES
# check below closes that gap.
# ⚠ 2026-08-01: that check is now a REGRESSION DETECTOR, not an expected-red. With WI-5783
# closed there is no longer ANY leg whose red is expected, so a from-repo-witness FAIL must be
# investigated like any other — never waved through as "the known witness red". Two such REDs
# fired 2026-07-31 (23:00Z, 00:02Z) while this file still described the leg as expected.
FROMREPO_RES="${ATTESTATION_WALL_TOKEN:-SKIPPED}"
WITNESS_RES="${ATTESTATION_WALL_TOKEN:-SKIPPED}"
if [ "$SKIP_FROMREPO" != 1 ]; then
  FROMREPO_RES="$(run_smoke from-repo two-instance-hive-from-repo-smoke.sh "" \
    HIVE_SMOKE_MODE=sidecar PAPERCUSP_SMOKE_DISPLAY="$((GATE_DISPLAY + 2))" DISCOVERY_RETRIES=100 \
    PAPERCUSP_FLAG_PAPERCUSP_HIVE_REKEY=1 WITNESS_PROBE=1)"
  log "from-repo+witness → $FROMREPO_RES"
  # WI-5783: fold the WITNESS sub-probe's own verdict into a REAL red — the top-level
  # OVERALL line above does not cover it. Only meaningful when the smoke actually ran the
  # witness block (witness_ran=1, i.e. join_ok=1 got that far); a run that never reached
  # WITNESS (e.g. failed earlier) has no "WITNESS OVERALL" line at all and stays SKIPPED,
  # not a false PASS.
  if grep -qaE 'FOLDED LIVE WITNESS' "$WORK/from-repo.out" 2>/dev/null; then
    if grep -qaE 'WITNESS OVERALL: PASS' "$WORK/from-repo.out" 2>/dev/null; then
      WITNESS_RES="PASS"
    else
      WITNESS_RES="FAIL"
    fi
    log "from-repo witness (AK-ban/re-key sub-probe) → $WITNESS_RES"
  fi
fi

# ── 3b. local-matrix leg (P-013 fold-in; activates when P-002's local-matrix.sh lands) ──
# Runs the full containerized 8-scenario matrix on a WEEKLY cadence once the one-command
# wrapper exists (bin/local-matrix.sh, P-002 of shared-hive-p2p-release-readiness-2026-07-03).
# Contract: exit 0 = matrix green. No-op until the wrapper exists.
# SEQUENCING (per the plan item: "+ (once green) the local matrix on cadence"): the matrix
# leg piggybacks ONLY on a window whose content-matrix smoke PASSED — running the heavy,
# newly-landed matrix on a window whose cheap smoke already failed just burns the box and
# pollutes the verdict (exactly what the 2026-07-03 validation run showed).
#
# EI-18715623477356990 — the four declines above/below were ONE compound `if`, so a window that
# skipped the leg left MATRIXFULL_RES="SKIPPED" with no way to tell WHICH gate closed (or that
# one had). Split into explicit branches that each name themselves in MATRIX_SKIP_REASON; the
# content-red decline additionally gets its OWN result token so the verdict SUMMARY carries it
# too. Deliberately NOT a decoupling of the two legs (that is a scenario-level call for the
# p2p-release lane, suggestion 2 on the EI) — this makes the existing coupling ANNOUNCE itself.
MATRIXFULL_RES="SKIPPED"
if [ "${RUN_LOCAL_MATRIX:-1}" != 1 ]; then
  MATRIX_SKIP_REASON="leg disabled for this run (RUN_LOCAL_MATRIX=${RUN_LOCAL_MATRIX:-1})"
elif [ ! -e "$DESKTOP_DIR/bin/local-matrix.sh" ]; then
  MATRIX_SKIP_REASON="wrapper bin/local-matrix.sh not present"
# WI-39359: the content-matrix gate below exists because running the heavy matrix on a window
# whose CHEAP SMOKE ALREADY FAILED just burns the box. Under the attestation wall the cheap
# smoke did not fail — it never ran, for a credential reason no local-matrix scenario touches —
# so that rationale does not apply and the coupling would only propagate the blindness. This is
# the scenario-level decoupling EI-18715623477356990 deferred to the p2p-release lane, scoped
# DELIBERATELY to the credential-wall case only: a genuine content-matrix RED still declines the
# leg exactly as before. NOTE this must stay a GUARD on the existing condition rather than its
# own elif branch — a branch that merely logs would match and fall out of the chain WITHOUT
# running the matrix, which is the silent no-coverage outcome this whole change exists to end.
elif [ "${ATTESTATION_BLOCKED:-0}" != 1 ] && ! { [ "$MATRIX_RES" = PASS ] || [ "$MATRIX_RES" = PASS-971 ]; }; then
  # A DISTINCT token (still SKIPPED* so is_skip_result keeps treating it as "nothing proven"),
  # because this is the decline that blocks a whole second verification plane indefinitely: a
  # persistently-red content-matrix means revocation_kcut (order 90) and
  # attestation_unattested_device (order 91) — which ONLY this leg runs — never execute at all.
  MATRIXFULL_RES="SKIPPED-CONTENT-RED"
  MATRIX_SKIP_REASON="content-matrix=$MATRIX_RES — the leg is gated on a green cheap smoke, so revocation_kcut + attestation_unattested_device did NOT run this window (workaround: run papercusp-desktop/bin/local-matrix.sh directly; it takes its own blocking rig flock)"
elif [ "$(age_h "$STATE_DIR/last-matrix-green")" -lt "${MATRIX_TTL_H:-144}" ]; then
  MATRIX_SKIP_REASON="cadence window (last matrix green $(age_h "$STATE_DIR/last-matrix-green")h ago < MATRIX_TTL_H=${MATRIX_TTL_H:-144}h)"
else
  {
    log "running local-matrix (weekly cadence) …"
    # Pass the gate's freshly-repacked .deb — without it the leg's default_deb()
    # picks the newest PREBUILT bundle, which can be days stale (the 2026-07-16 RED
    # ran a Jul-11 deb against current-tree expectations and its own WARN said so).
    MATRIX_LEG_START_TS="$(now_s)"
    # MATRIX_FRAMES (default 3) — 2026-07-27, P-425, executing D-007's own stated trigger
    # ("do NOT pass --frames=3 yet; flip it the moment the 2-frame gate is genuinely green"),
    # which the earned first green at 2026-07-27T02:00:39Z MET. Until this line the gate
    # invoked local-matrix.sh with no --frames, so it ran FRAMES=2 and order-35
    # membership_churn resolved to SKIP on EVERY run — it has never executed in the gate's
    # history, and before EI-18660392396897977 that exclusion was silent.
    # Third-frame prerequisites VERIFIED before flipping: this box has nproc=128 (>=24), so
    # local-matrix.sh derives _def_cpuset_c=104-111 (a real dedicated cpuset, not empty —
    # below 24 cores it disables pinning entirely), plus CN_C=pcusp-rig-c and IP_C=10.99.0.13.
    # A first-ever membership_churn RED is COVERAGE, not a regression: triage it, do not
    # revert to 2 frames to hide it. Set MATRIX_FRAMES=2 for a one-off cheaper run.
    if ( cd "$DESKTOP_DIR/.." && bash "papercusp-desktop/bin/local-matrix.sh" --frames="${MATRIX_FRAMES:-3}" ${GATE_DEB:+--deb="$GATE_DEB"} ) >"$WORK/local-matrix.out" 2>&1; then
      MATRIXFULL_RES="PASS"; echo "$(now_s)" >"$STATE_DIR/last-matrix-green"
      # EI-18657324526667507: last-matrix-green answers "when was it last GOOD"; last-matrix-verdict
      # answers "when did it last DECIDE anything". They must stay separate — a leg that only ever
      # FAILS is still running (not stale), and a leg that has been green for a week but has since
      # been suppressed by load/rig-busy is stale even though last-matrix-green looks recent.
      echo "$(now_s)" >"$STATE_DIR/last-matrix-verdict"; rm -f "$STATE_DIR/matrix-stale-ei-filed"
    else
      MATRIXFULL_RES="FAIL"
      # WI-2381 carve-out RETIRED 2026-07-18 [self, WI-5137/P-402]: the seat_offer/
      # spawn_request known-red was root-caused to RIG_WORKSPACE_ID never being set on
      # headless frames (serve.mjs-only boot skips the Rust workspace-id mint), and
      # deb-hetzner-rig.sh now mints a default — those legs are expected GREEN on a
      # freshly-provisioned rig. Any local-matrix FAIL therefore stays FAIL: first-green
      # must be a FULL pass, and the old PASS-2381 downgrade both stamped
      # last-matrix-green and let the gate report green with the seat legs unproven.
      #
      # WI-5319/WI-5329 frame-starvation downgrade (2026-07-19): see the function
      # doc-comments above. Narrow + evidence-gated — never masks a non-restart-class FAIL.
      if local_matrix_only_starvation_prone_fails "$WORK/local-matrix.out" \
        && check_local_matrix_frame_starvation "$MATRIX_LEG_START_TS"; then
        MATRIXFULL_RES="SKIPPED-STARVATION"
        log "local-matrix FAIL downgraded → SKIPPED-STARVATION: every failing scenario is in the restart-heavy class (restart_durability/reconnect_catchup/replication_soak), or is revocation_kcut cascading from a same-run replication_soak FAIL (b3-revocation.sh's own SCN_RC[replication_soak] attribution — WI-5616), AND a banked frame serve.log from this run shows [event-loop-lag] maxMs>1000ms — genuine frame-local CPU starvation (WI-5319 signal, root-caused WI-5329), not a regression. Host-loadavg STORM_GATE below is a weak proxy for these CPU-pinned frames (single end-of-run sample) and can miss this."
      fi
      # EI-18657324526667507: a genuine FAIL IS a verdict (the leg ran and decided), so it clears
      # the leg-staleness clock. Stamped AFTER the starvation downgrade and gated on the result
      # still being FAIL, because SKIPPED-STARVATION is deliberately NOT a verdict — it means the
      # restart-heavy class was never actually proven this run (D-005), which is exactly the
      # "nothing was decided" state the staleness clock must keep counting.
      [ "$MATRIXFULL_RES" = FAIL ] && { echo "$(now_s)" >"$STATE_DIR/last-matrix-verdict"; rm -f "$STATE_DIR/matrix-stale-ei-filed"; }
    fi
    log "local-matrix → $MATRIXFULL_RES"
    # The starvation downgrade is ALSO a "did not decide" (D-005: the restart-heavy class was
    # never proven) — carry it on the same reason string so it reads like every other decline.
    [ "$MATRIXFULL_RES" = SKIPPED-STARVATION ] && MATRIX_SKIP_REASON="frame-starvation downgrade — the restart-heavy scenario class was NOT proven this run"
  }
fi
# One line, always, whenever the leg did not decide — journald gets the reason even for the
# windows whose verdict line a reader never sees.
[ -n "$MATRIX_SKIP_REASON" ] && log "local-matrix DID NOT DECIDE this window: $MATRIX_SKIP_REASON"

# ── 4. verdict ────────────────────────────────────────────────────────────────
REDS=()
[ "$FAIL_BUILD" = 1 ] && REDS+=("sidecar-build")
[ "$MATRIX_RES" = FAIL ] && REDS+=("content-matrix")
[ "$FROMREPO_RES" = FAIL ] && REDS+=("from-repo")
[ "$WITNESS_RES" = FAIL ] && REDS+=("from-repo-witness")
[ "$MATRIXFULL_RES" = FAIL ] && REDS+=("local-matrix")
# EI-11342: a prod-port squat by a rig-owned process invalidates the run AND is itself a
# red-worthy defect (an instance bound the wrong port ⇒ whatever that instance "proved" is void).
if [ -s "$GUARD_TRIP_FILE" ]; then
  REDS+=("prod-port-squat")
  log "PROD-PORT GUARD tripped during this run (EI-11342): $(tr '\n' '; ' <"$GUARD_TRIP_FILE")"
fi
SUMMARY="content-matrix=$MATRIX_RES from-repo=$FROMREPO_RES from-repo-witness=$WITNESS_RES local-matrix=$MATRIXFULL_RES build=$([ "$FAIL_BUILD" = 1 ] && echo FAIL || echo OK)"
log "VERDICT: $SUMMARY"
echo "$(now_s)" >"$STATE_DIR/last-run"

# All legs skipped ⇒ NOT green (the vacuous-pass trap): nothing was proven this window.
# is_skip_result() also matches SKIPPED-BUSY (WI-1977: a display-contention skip is still a
# skip for this purpose — nothing was proven, whether by load-gate SKIPPED or a busy display).
if is_skip_result "$MATRIX_RES" && is_skip_result "$FROMREPO_RES" && is_skip_result "$MATRIXFULL_RES" && [ "$FAIL_BUILD" != 1 ]; then
  log "all smoke legs SKIPPED — nothing proven; NOT recording a green."
  check_staleness
  verdict "GATE: SKIPPED (no legs ran — $SUMMARY)$(matrix_skip_suffix)"; exit 0
fi

if [ ${#REDS[@]} -eq 0 ]; then
  # A window whose local-matrix "passed" only via the WI-5329 frame-starvation downgrade is NOT a
  # genuine green (D-005): the restart-heavy class (incl. replication_soak) was never actually
  # proven this run. Recording last-green here is what suppressed real hourly re-runs for ~22h on
  # 2026-07-19 and hid WI-5481. So record last-downgrade (short retry TTL) instead — never a green.
  if [ "$MATRIXFULL_RES" = SKIPPED-STARVATION ]; then
    echo "$(now_s)" >"$STATE_DIR/last-downgrade"
    # WI-37464: this window was NOT red, so clear any red backoff — otherwise the longer red TTL
    # would keep governing after the state has already moved on, over-suppressing the shorter
    # downgrade retry this branch deliberately asks for.
    rm -f "$STATE_DIR/last-red"
    check_staleness
    verdict "GATE: SKIPPED-STARVATION (would-be-green but restart-class unproven — not a fresh green; $SUMMARY)$(matrix_skip_suffix)"; exit 0
  fi
  # WI-39359 — AN ATTESTATION-BLOCKED WINDOW CAN NEVER BE GREEN, however clean its legs were.
  # content-matrix, from-repo and from-repo-witness were NOT exercised (no credential could mint
  # an attestation gist), so a green here would assert coverage nobody produced — precisely the
  # false-green class D-018 exists to stop, and the same shape as the "green that survives only
  # as an epoch integer" discrepancy §8 #1 already records. Emit an explicit PARTIAL that names
  # what did and did not run, and deliberately do NOT stamp last-green (which would suppress
  # re-runs and let the wall sit undetected behind a cadence gate).
  if [ "${ATTESTATION_BLOCKED:-0}" = 1 ]; then
    check_matrix_staleness
    verdict "GATE: PARTIAL (attestation-blocked) — local-matrix=$MATRIXFULL_RES ran WITHOUT attestation; content-matrix/from-repo/from-repo-witness NOT exercised (both GitHub identities cannot mint an attestation gist). NOT a green: $SUMMARY$(matrix_stale_suffix)$(matrix_skip_suffix)"
    exit 1
  fi
  echo "$(now_s)" >"$STATE_DIR/last-green"; rm -f "$STATE_DIR/stale-ei-filed" "$STATE_DIR/red-ei-filed" "$STATE_DIR/red-ei-legs" "$STATE_DIR/last-red"
  # EI-18657324526667507 — THE load-bearing call. check_staleness() is (correctly) not invoked on
  # the green path, so without this the leg check would never run in exactly the state that hides
  # it: gate GREEN off the cheap content-matrix leg while local-matrix has decided nothing for
  # days. Note matrix-stale-ei-filed is deliberately NOT cleared here (unlike stale-ei-filed) —
  # only a real local-matrix verdict clears the leg's clock; a green gate is not evidence it ran.
  check_matrix_staleness
  verdict "GATE: GREEN — $SUMMARY$(matrix_stale_suffix)$(matrix_skip_suffix)"; exit 0
fi

# Storm downgrade: if the box got SATURATED mid-run, a FAIL is likelier starvation than a
# regression (the exact false-RED seen when a fleet storm hit load 94 mid-run) — downgrade
# to SKIPPED-STORM, no EI, retry next window. A real regression re-fails on a calm window.
LOAD1_END="$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)"
# EI-18716933933700596: every line below that names the host load ALSO names the frame-scoped
# reading, so "the box was too loaded" can be confirmed or ruled out from the verdict line
# itself instead of a manual docker-stats correlation. Computed once — the scan walks the bank
# dir, and the STORM branch exits before the RED line, so at most one of these two is emitted.
FRAME_NOTE="$(frame_pressure_note)"
if awk "BEGIN{exit !($LOAD1_END > $STORM_GATE)}"; then
  log "STORM: load rose to $LOAD1_END (> STORM_GATE $STORM_GATE) during the run — downgrading RED(${REDS[*]}) to SKIPPED (starvation, not signal). $FRAME_NOTE"
  # WI-37464: a storm downgrade is the SECOND unsuppressed expensive outcome — it costs a FULL
  # heavy run and, before this, stamped nothing at all, so it too re-fired every hour. It is the
  # same CLASS as the starvation downgrade above (environmental, not a verdict, may clear on its
  # own), so it takes the same marker and the same SHORT retry TTL rather than the red one.
  echo "$(now_s)" >"$STATE_DIR/last-downgrade"
  check_staleness
  verdict "GATE: SKIPPED-STORM (load $LOAD1_END; would-be-red: ${REDS[*]}; $FRAME_NOTE)$(matrix_skip_suffix)"; exit 0
fi

verdict "GATE: RED (${REDS[*]}) — $SUMMARY$(matrix_skip_suffix) ; $FRAME_NOTE ; logs in $WORK"

# ── 5. file an EI on RED (best-effort curl-MCP; the loud echo + $WORK logs are the fallback) ─
# Dedup (RED_REFILE_H, see header): only file once per window per still-red condition —
# this gate runs hourly and an unresolved regression stays red for days, so without this a
# new bug work-item minted every run buries the ONE that actually needs fixing under dozens
# of timestamp-only duplicates. Cleared on the next GREEN (above), so a real fix is never
# hidden behind a stale suppression, and re-fires after RED_REFILE_H even while still red so
# a forgotten/dropped tracking item doesn't go dark forever.
TITLE="live-federation-gate RED: ${REDS[*]} failed on the packaged binary ($STAMP)"
TITLE_PREFIX="live-federation-gate RED: ${REDS[*]} failed on the packaged binary ("
BODY="Automated live-federation gate (WI-261/P-013) caught a RED on the real binary the hermetic suite would not (green-rig/red-binary class). Failing legs: ${REDS[*]}. Verdict: $SUMMARY. Logs: $WORK/*.out. Host 1-min loadavg at verdict: $LOAD1_END (SHARED-BOX aggregate — not frame-scoped). $FRAME_NOTE (EI-18716933933700596: read the frame-scoped line, not the host load, before concluding this was environmental). Owner: shared-hive release lane. NOTE (updated 2026-07-25, WI-5775): WI-971 (outbox drain never wired for joined/created hive harnesses; WI-259 closed as its dup) is now VERIFIED FIXED — a bare from-repo RED is a NEW regression, investigate. NOTE (updated 2026-08-01): WI-5783 (AK-ban policy-only drop not enforced) is RESOLVED and live-verified, so a from-repo-witness RED is NO LONGER EXPECTED — it is a NEW regression like every other leg. There is currently NO leg whose red is expected: content-matrix, local-matrix, from-repo, from-repo-witness and build ALL mean investigate. (Prior wording told the reader a witness red was expected; it outlived its own condition by ~6 days and rode into filed tickets — see WI-6540.)"
RED_MARKER="$STATE_DIR/red-ei-filed"
# Dedup is PER failing-leg-set, not global (2026-07-16: a brand-new local-matrix
# RED was silently suppressed for 12h under the marker of an already-fixed
# content-matrix RED — a distinct regression got no tracking item). Same legs
# within the window ⇒ suppress; different legs ⇒ a new condition ⇒ file.
RED_LEGS_MARKER="$STATE_DIR/red-ei-legs"
red_marker_age_h="$(age_h "$RED_MARKER")"
prev_legs="$(cat "$RED_LEGS_MARKER" 2>/dev/null || true)"
# WI-37464 run-backoff. Deliberately a SEPARATE marker from red-ei-filed, not a reuse of it:
# red-ei-filed answers "is this red already FILED?" (dedup, RED_REFILE_H) and last-red answers
# "should we spend an hour of this box's CPU re-running it?". They are different questions with
# different clocks, and collapsing two questions onto one marker is precisely the defect that
# produced both this bug and EI-19305010835660160 (the same TTL failing the opposite way).
# Default 1 = tracked; only an UNCONFIRMED filing clears it, mirroring red-ei-filed's own rule.
red_tracked=1
# find_open_duplicate (bug-drain-200k fleet finding, 2026-07-20): the RED_REFILE_H
# marker above is LOCAL, EPHEMERAL state — it is deliberately cleared on every GREEN
# (below, "rm -f ... red-ei-filed red-ei-legs"), so an INTERMITTENT regression
# (red, green, red, green, …) resets it every cycle and mints a BRAND-NEW work-item
# each time even though the underlying failure is the exact same still-open,
# already-tracked condition. This produced ~170 open near-identical
# "live-federation-gate RED: <legs> failed on the packaged binary (<stamp>)" bugs
# (found + partly hand-closed via the bug-drain-200k fleet; WI-3358/WI-4336 etc. all
# duplicates of the one still-open live root cause, WI-5441 at filing time). The
# platform DOES have a create-time semantic-dupe guard (semantic-dupe-guard.ts,
# P-008) but it is embedding-based with a 2.5s cold-load budget that an HOURLY
# caller with no warm sidecar between runs reliably forfeits (fail-open by design)
# — it was never actually protecting this filer. This is a second, DETERMINISTIC,
# no-embedder check: before filing, ask whether an OPEN bug already carries the
# same leg-set title template (ignoring the per-run timestamp) and skip filing if
# so. Best-effort — any curl/parse failure here falls through to filing as before,
# never suppressing a genuine new regression because this check itself broke.
# (find_open_duplicate moved to ~L258, above check_staleness's earlier callers — see there.)
if [ "$red_marker_age_h" -lt "$RED_REFILE_H" ] && [ "$prev_legs" = "${REDS[*]}" ]; then
  log "RED already tracked (EI filed ${red_marker_age_h}h ago for same legs '${REDS[*]}', < RED_REFILE_H ${RED_REFILE_H}h) — skipping duplicate filing. $TITLE"
else
  existing_open="$(find_open_duplicate "$TITLE_PREFIX")"
  if [ -n "$existing_open" ]; then
    log "RED already tracked as still-OPEN $existing_open (same leg-set template; the ${RED_REFILE_H}h local marker had reset, e.g. after an intervening GREEN) — skipping duplicate filing. $TITLE"
    echo "$(now_s)" >"$RED_MARKER"
    printf '%s' "${REDS[*]}" >"$RED_LEGS_MARKER"
  else
    [ -n "$prev_legs" ] && [ "$prev_legs" != "${REDS[*]}" ] && [ "$red_marker_age_h" -lt "$RED_REFILE_H" ] \
      && log "failing-leg set changed ('$prev_legs' → '${REDS[*]}') — filing despite the ${red_marker_age_h}h-old marker."
    # 2026-08-01: the markers are written ONLY when the filing is CONFIRMED. They mean
    # "this red is tracked somewhere durable" and are read as permission to stay quiet;
    # stamping them after an unconfirmed filing converts a transient operator/curl failure
    # into a permanently-lost red. On failure we leave them untouched so the NEXT window
    # re-attempts — a duplicate item is cheap, a silently-dropped release-gate red is not.
    if file_ei "$TITLE" "$BODY"; then
      echo "$(now_s)" >"$RED_MARKER"
      printf '%s' "${REDS[*]}" >"$RED_LEGS_MARKER"
    else
      log "EI filing NOT CONFIRMED — deliberately NOT stamping red-ei-filed/red-ei-legs, so the next window re-attempts instead of suppressing this red as 'already tracked'."
      red_tracked=0
    fi
  fi
fi
# WI-37464: back off ONLY on a red somebody can actually see. An untracked red (the filing
# failed and no open duplicate was found) still re-runs next window — the same trade the
# red-ei markers above make, for the same reason: a duplicate item is cheap, a silently-dropped
# release-gate red is not. Stamped after the filing block so all three tracked branches — marker
# still fresh, existing open duplicate, freshly filed — reach it.
if [ "$red_tracked" = 1 ]; then
  echo "$(now_s)" >"$STATE_DIR/last-red"
else
  log "red is NOT tracked anywhere durable — deliberately NOT stamping last-red, so the next hourly window RE-RUNS and re-attempts the filing rather than going quiet on an unreported red."
fi
check_staleness
exit 1
