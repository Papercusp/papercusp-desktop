#!/usr/bin/env bash
# federation-asserts.selftest.sh — focused unit test for the PORT SELF-DISCOVERY
# hardening (WI-754) in federation-asserts.sh. It proves fed_probe_sidecar +
# fed_discover_sidecar_os pick the REAL sidecar port out of an instance's
# listeners and reject a decoy listener (the code-server class), using synthetic
# HTTP listeners — NO real desktop / .deb / VM boot. Pure, hermetic, ~2s.
#
#   bash bin/lib/federation-asserts.selftest.sh     # exit 0 = PASS, 1 = FAIL
#
# Why a bash self-test and not Vitest: the unit under test is bash (the rig's
# assert core). This is the rig's own micro-test; the four canonical TS/Cargo/LLM
# frameworks don't host shell units. The full rig (the *.sh smokes) is the
# integration test.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=federation-asserts.sh
source "$DIR/federation-asserts.sh"
set +e   # this self-test owns its own exit codes (asserts may intentionally fail a probe)

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 unavailable"; exit 0; }
command -v curl    >/dev/null 2>&1 || { echo "SKIP: curl unavailable"; exit 0; }

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

WORK="$(mktemp -d /tmp/fed-selftest.XXXXXX)"
WORK2="$(mktemp -d /tmp/fed-selftest.XXXXXX)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK" "$WORK2"; }
trap cleanup EXIT

free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'; }

# start_listener <port> <sidecar|decoy> — a synthetic instance http listener.
# The sidecar answers GET /api/desktop/preflight with 200; the decoy 404s it
# (like code-server). The unique $WORK is in argv so the /proc-scoped discovery
# path can attribute it to this instance.
start_listener() {
  local port="$1" kind="$2"
  python3 - "$port" "$kind" "$WORK" <<'PY' &
import http.server, socketserver, sys
port = int(sys.argv[1]); is_sidecar = (sys.argv[2] == 'sidecar')
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/desktop/preflight' and is_sidecar:
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
with socketserver.TCPServer(('127.0.0.1', port), H) as s:
    s.serve_forever()
PY
  PIDS+=("$!")
}

SIDE_PORT="$(free_port)"; DECOY_PORT="$(free_port)"
[ "$SIDE_PORT" != "$DECOY_PORT" ] || DECOY_PORT="$(free_port)"
start_listener "$SIDE_PORT" sidecar
start_listener "$DECOY_PORT" decoy
for _ in $(seq 1 50); do
  if curl -s -o /dev/null -m 1 "http://127.0.0.1:$SIDE_PORT/" \
     && curl -s -o /dev/null -m 1 "http://127.0.0.1:$DECOY_PORT/"; then break; fi
  sleep 0.2
done

echo "fed port self-discovery self-test (sidecar=$SIDE_PORT decoy=$DECOY_PORT)"

# instance 't' on the local driver; its log WRONGLY labels the DECOY as [serve]
# (the code-server-won-the-grep race) and also mentions the real sidecar port.
LOGF="$WORK/t.applog"
printf 'embedded-postgres-server ready on 127.0.0.1:55555\n[serve] listening on http://127.0.0.1:%s\nHTTP server listening on http://127.0.0.1:%s/\n' \
  "$DECOY_PORT" "$SIDE_PORT" > "$LOGF"
FED_LOG[t]="$LOGF"

# 1) fed_probe_sidecar classifies correctly
fed_probe_sidecar t "$SIDE_PORT"  && ok "fed_probe_sidecar accepts the real sidecar ($SIDE_PORT)"      || bad "fed_probe_sidecar rejected the real sidecar ($SIDE_PORT)"
fed_probe_sidecar t "$DECOY_PORT" && bad "fed_probe_sidecar wrongly accepted the decoy ($DECOY_PORT)"  || ok "fed_probe_sidecar rejects the decoy ($DECOY_PORT)"

# 2) self-heal: FED_SC points at the DECOY → discovery must adopt the real port
FED_SC[t]="$DECOY_PORT"
if fed_discover_sidecar_os t; then
  [ "${FED_SC[t]}" = "$SIDE_PORT" ] \
    && ok "fed_discover_sidecar_os self-healed FED_SC $DECOY_PORT → $SIDE_PORT" \
    || bad "fed_discover_sidecar_os resolved ${FED_SC[t]}, expected $SIDE_PORT"
else
  bad "fed_discover_sidecar_os found no sidecar (expected $SIDE_PORT)"
fi

# 3) negative: an instance (separate scope) whose only known port is a decoy → return 1
LOGF2="$WORK2/t2.applog"
printf '[serve] listening on http://127.0.0.1:%s\n' "$DECOY_PORT" > "$LOGF2"
FED_LOG[t2]="$LOGF2"; FED_SC[t2]="$DECOY_PORT"
if fed_discover_sidecar_os t2; then
  bad "fed_discover_sidecar_os should have failed (only a decoy is in t2's scope), resolved ${FED_SC[t2]}"
else
  ok "fed_discover_sidecar_os returns 1 when no port in scope answers the sidecar preflight"
fi

# 4) fed_pick_free_port skips a held port and returns a higher, free one
held="$SIDE_PORT"   # the sidecar synthetic listener is bound here
got="$(fed_pick_free_port "$held")"
if [ "${got:-0}" -gt "$held" ] 2>/dev/null && ! ss -tlnH "sport = :$got" 2>/dev/null | grep -q .; then
  ok "fed_pick_free_port skipped held :$held → free :$got"
else
  bad "fed_pick_free_port returned '$got' for held :$held (expected a higher, free port)"
fi

# 5) advisory port locks close the ss-probe → bind selection race
LOCK_DIR="$WORK/port-locks"
LOCK_PORT="$((SIDE_PORT + 20))"
if fed_acquire_port_lock "$LOCK_PORT" "$LOCK_DIR"; then
  if bash -c 'source "$1"; fed_acquire_port_lock "$2" "$3"' _ "$DIR/federation-asserts.sh" "$LOCK_PORT" "$LOCK_DIR"; then
    bad "fed_acquire_port_lock allowed a concurrent holder on :$LOCK_PORT"
  else
    ok "fed_acquire_port_lock rejects a concurrent holder on :$LOCK_PORT"
  fi
  fed_release_port_locks
  if fed_acquire_port_lock "$LOCK_PORT" "$LOCK_DIR"; then
    ok "fed_acquire_port_lock is reusable after release"
    fed_release_port_locks
  else
    bad "fed_acquire_port_lock did not release :$LOCK_PORT"
  fi
else
  bad "fed_acquire_port_lock could not acquire :$LOCK_PORT"
fi

# 6) fed_local_launch_sidecar rejects same/empty hono+pg ports (the 2026-07-03
#    P-002 class: argless fed_pick_free_port x4 handed 18000 to everything and
#    every instance EADDRINUSE'd at boot — the guard must fail LOUDLY instead)
if fed_local_launch_sidecar "$WORK/g-home" /dev/null "$WORK" 18000 18000 2>/dev/null; then
  bad "fed_local_launch_sidecar accepted hono_port == pg_port (18000/18000)"
else
  ok "fed_local_launch_sidecar rejects hono_port == pg_port"
fi
if fed_local_launch_sidecar "$WORK/g-home" /dev/null "$WORK" "" "" 2>/dev/null; then
  bad "fed_local_launch_sidecar accepted empty ports"
else
  ok "fed_local_launch_sidecar rejects empty ports"
fi

# 7) ambient-env neutralization (the 2026-07-03 P-002 layer-4 class): fleet
#    shells carry PAPERCUSP_DHT_HOST=<bridge-ip> and PAPERCUSP_DHT_BOOTSTRAP=
#    <bridge-ip:port>; a launcher that INHERITS either swarm-binds/bootstraps
#    loopback smokes on the bridge → 0 peer dials. Static guard: every local
#    launcher must force-empty BOTH (trailing "$@" still lets callers opt in).
#    They must also force PAPERCUSP_BACKGROUND_WORKERS=1: request-only ambient
#    mode skips the hyperbee substrate and leaves content-matrix outboxes stuck.
for fn in fed_local_launch fed_local_launch_sidecar; do
  body="$(declare -f "$fn")"
  for var in PAPERCUSP_DHT_HOST PAPERCUSP_DHT_BOOTSTRAP; do
    if printf '%s\n' "$body" | grep -q "${var}= "; then
      ok "$fn force-empties ambient $var"
    else
      bad "$fn no longer force-empties ambient $var (P-002 layer-4 regression)"
    fi
  done
  if printf '%s\n' "$body" | grep -q 'PAPERCUSP_BACKGROUND_WORKERS=1'; then
    ok "$fn forces packaged federation background workers on"
  else
    bad "$fn no longer forces PAPERCUSP_BACKGROUND_WORKERS=1 (WI-3350 regression)"
  fi
  # EI-15308: both local launchers set HOME="$home" to isolate the instance, but
  # serve.ts's PAPERCUSP_DIR = process.env.PAPERCUSP_HOME || homedir()+".papercusp"
  # PREFERS PAPERCUSP_HOME over that isolated HOME. Every su/dev shell carries
  # PAPERCUSP_HOME ambiently, so a launcher that doesn't `env -u` it collapses the
  # instance onto the caller's real shared operator home (cold-start lock/port
  # collision — "another `serve` holds the cold-start lock; aborting"), defeating
  # isolation. Same env-inheritance class as the DATABASE_URL family above.
  if printf '%s\n' "$body" | grep -q -- '-u PAPERCUSP_HOME'; then
    ok "$fn scrubs ambient PAPERCUSP_HOME (isolation-leak guard)"
  else
    bad "$fn no longer scrubs ambient PAPERCUSP_HOME (EI-15308 shared-home isolation-leak regression)"
  fi
done

# 7b) EI-15308 (smoke-local copy): two-instance-hive-from-repo-smoke.sh's sc_launch
# is a script-local launcher (not in this sourced lib, so `declare -f` can't see
# it) that likewise sets HOME="$home". Static-grep it for the same PAPERCUSP_HOME
# scrub so the smoke's private launcher can't regress the isolation leak either.
SC_LAUNCH_FILE="$DIR/../two-instance-hive-from-repo-smoke.sh"
if grep -q -- '-u PAPERCUSP_HOME' "$SC_LAUNCH_FILE"; then
  ok "two-instance-hive-from-repo-smoke sc_launch scrubs ambient PAPERCUSP_HOME (EI-15308)"
else
  bad "two-instance-hive-from-repo-smoke sc_launch no longer scrubs PAPERCUSP_HOME (EI-15308 regression)"
fi

# 8) Route-cutover guard (WI-2929): the live federation driver runs against the
# current pot route. A stale /hives/from-repo call hard-404s on current packaged
# binaries before the matrix can exercise federation at all.
# WI-3350: the join route likewise moved to /api/discovery/join-pot; stale
# /join-hive curls hard-404 during the content-matrix B-join step.
ROUTE_FILES=(
  "$DIR/federation-asserts.sh"
  "$DIR/../two-instance-content-matrix-smoke.sh"
  "$DIR/../two-instance-hive-from-repo-smoke.sh"
  "$DIR/../deb-hetzner-fast-iterate.sh"
  "$DIR/deb-hetzner-rig.sh"
  "$DIR/../work-distribution-drill.sh"
)
route_bad=0
for file in "${ROUTE_FILES[@]}"; do
  if grep -q 'hives/from-repo' "$file"; then
    bad "$(basename "$file") still references retired hives/from-repo route"
    route_bad=1
  fi
  if grep -Eq 'curl .*/api/discovery/join-hive' "$file"; then
    bad "$(basename "$file") still curls retired discovery/join-hive route"
  fi
  # mig-557 lexicon sweep: /api/discovery/hives → /api/discovery/pots. The old
  # route 404s {"error":"not_found"} on current builds and red-fails the whole
  # discovery leg (caught live 2026-07-16 — the from-repo smoke's B poll).
  if grep -Eq 'curl .*/api/discovery/hives' "$file"; then
    bad "$(basename "$file") still curls retired discovery/hives route (renamed /api/discovery/pots)"
    route_bad=1
  fi
done
if [ "$route_bad" = 0 ]; then
  ok "live federation scripts use current pots/from-repo and discovery/join-pot routes"
fi

# 8) Packaged-deb discovery guard (WI-3344): after the GUI/Server product split,
# Linux artifacts are named "Papercusp GUI_..._amd64.deb". A stale
# Papercusp_0.0.2_amd64.deb default made the live gate file content-matrix REDs
# before the smoke even extracted a package. The gate must ignore missing explicit
# overrides, and the direct smoke must not keep the retired filename as its default.
gate_file="$DIR/../live-federation-gate.sh"
matrix_file="$DIR/../two-instance-content-matrix-smoke.sh"
verify_file="$DIR/../verify-sidecar-bundle.sh"
if grep -q 'does not exist — ignoring stale override' "$gate_file"; then
  ok "live-federation-gate ignores a missing GATE_DEB override instead of feeding it to the smoke"
else
  bad "live-federation-gate no longer guards missing GATE_DEB overrides (WI-3344 regression)"
fi
if grep -q 'Papercusp\\ GUI_' "$gate_file" && grep -q 'Papercusp\\ GUI_' "$matrix_file"; then
  ok "live federation deb discovery includes the current 'Papercusp GUI' artifact name"
else
  bad "live federation deb discovery is missing the current 'Papercusp GUI' artifact glob"
fi
if grep -q 'Papercusp_0.0.2_amd64.deb' "$matrix_file"; then
  bad "content-matrix smoke still carries the retired Papercusp_0.0.2_amd64.deb default"
else
  ok "content-matrix smoke no longer carries the retired default deb filename"
fi
if grep -q 'OVERALL: PASS' "$matrix_file"; then
  ok "content-matrix smoke emits the OVERALL verdict live-federation-gate parses"
else
  bad "content-matrix smoke no longer emits OVERALL: PASS (live-federation-gate will mark it FAIL)"
fi

# 8b) RED-EI dedup guard (2026-07-09, EI-8385-class fix): a prior version filed a BRAND
# NEW work_items:create bug on EVERY hourly RED run — no dedup key, and the title embeds a
# run timestamp so no similarity guard ever caught the duplicates — piling up 30+ open
# "live-federation-gate RED: content-matrix failed…" bugs for the SAME unresolved regression
# over 3 days (WI-3358..WI-3477+). The gate must suppress re-filing within RED_REFILE_H and
# clear the suppression marker on the next GREEN (never hide a real fix behind stale state).
if grep -q 'RED_MARKER="\$STATE_DIR/red-ei-filed"' "$gate_file" && grep -q 'red_marker_age_h' "$gate_file"; then
  ok "live-federation-gate dedups RED EI filings via a red-ei-filed marker"
else
  bad "live-federation-gate no longer dedups RED EI filings (duplicate-bug-storm regression)"
fi
if grep -q 'rm -f "\$STATE_DIR/stale-ei-filed" "\$STATE_DIR/red-ei-filed"' "$gate_file"; then
  ok "live-federation-gate clears the RED-EI marker on the next GREEN"
else
  bad "live-federation-gate no longer clears red-ei-filed on GREEN (would hide a real fix behind stale suppression)"
fi

# 8c) PASS-971 downgrade doesn't false-RED on a zero-match grep (2026-07-09 fix, the
# ACTUAL root cause behind WI-3358/WI-3477 — the RED-EI dedup above only masked the
# symptom). `grep -c PATTERN FILE || echo 0` ALWAYS prints a count (even "0") but exits
# 1 when that count is 0, so a zero-match run fired BOTH the printed "0" AND the
# `|| echo 0` fallback, leaving X_TOTAL/X_OTHER a two-line "0\n0" string that blew up
# `[ "$X_OTHER" -eq 0 ]` with "integer expression expected" (visible in journalctl) —
# so a content-matrix FAIL that fully qualified for the documented PASS-971 carve-out
# was left as a genuine RED on EVERY real run (all 3 checked 2026-07-09). Exercise the
# gate's actual downgrade snippet (not a re-implementation) against a synthetic
# zero-X_OTHER fixture and assert it downgrades cleanly with no stderr noise.
if grep -qE 'grep -ac.*\|\| echo 0' "$gate_file"; then
  bad "live-federation-gate downgrade logic still uses the 'grep -c ... || echo 0' double-output trap (false-RED regression)"
else
  DOWNGRADE_FIXTURE="$(mktemp /tmp/fed-selftest-downgrade.XXXXXX)"
  { echo '✓ B joined'; echo '  ✗ features         incr-B→A NEVER crossed (src outbox=1/1)'; } >"$DOWNGRADE_FIXTURE"
  downgrade_snippet="$(awk '/^  if \[ "\$MATRIX_RES" = FAIL \]/{p=1} p{print} p&&/^  fi$/{exit}' "$gate_file")"
  if [ -z "$downgrade_snippet" ]; then
    bad "could not extract the PASS-971 downgrade snippet from live-federation-gate.sh (structure changed — update this test)"
  else
    DOWNGRADE_STDERR="$(mktemp /tmp/fed-selftest-downgrade-stderr.XXXXXX)"
    downgrade_result="$(MATRIX_RES=FAIL WORK="$(dirname "$DOWNGRADE_FIXTURE")" bash -c "
      WORK_FILE='$DOWNGRADE_FIXTURE'
      $(echo "$downgrade_snippet" | sed "s#\"\$WORK/content-matrix.out\"#\"\$WORK_FILE\"#g")
      echo \"\$MATRIX_RES\"
    " 2>"$DOWNGRADE_STDERR")"
    if [ "$downgrade_result" = "PASS-971" ] && ! grep -q "integer expression expected" "$DOWNGRADE_STDERR"; then
      ok "PASS-971 downgrade handles a zero-X_OTHER run cleanly (no false-RED, no stderr noise)"
    else
      bad "PASS-971 downgrade false-RED regression: result='$downgrade_result' stderr='$(cat "$DOWNGRADE_STDERR")'"
    fi
    rm -f "$DOWNGRADE_STDERR"
  fi
  rm -f "$DOWNGRADE_FIXTURE"
fi
# 8d) run_smoke retries a BOOT-READINESS flake, not just a discovery flake (WI-3734,
# 2026-07-10): an EMPTY-body "create failed"/"B join failed" (fed_wait_api accepted a
# sidecar — incl. via its "legacy liberal accept" fallback — before it actually finished
# booting under load) used to fall through every retry check and kill the whole gate
# run on attempt 1. Exercise the ACTUAL run_smoke() function (not a re-implementation)
# against a synthetic "smoke script" stand-in that fails empty-body on its first
# invocation and passes on its second — assert it retries and returns PASS, and that a
# GENUINE (non-empty-body) failure is still NOT retried.
runsmoke_snippet="$(awk '/^run_smoke\(\)/{p=1} p{print} p&&/^}$/{exit}' "$gate_file")"
if [ -z "$runsmoke_snippet" ]; then
  bad "could not extract run_smoke() from live-federation-gate.sh (structure changed — update this test)"
else
  # run_smoke does: ( cd "$DESKTOP_DIR/.." && bash "papercusp-desktop/bin/$script" ) — so
  # the fake layout needs an actual "papercusp-desktop/bin/" child under DESKTOP_DIR's
  # parent, with DESKTOP_DIR itself pointing at the "papercusp-desktop" dir (absolute,
  # so it's unambiguous regardless of cwd).
  RS_ROOT="$(mktemp -d /tmp/fed-selftest-runsmoke.XXXXXX)"
  RS_BIN_DIR="$RS_ROOT/papercusp-desktop/bin"; mkdir -p "$RS_BIN_DIR"
  RS_WORK="$(mktemp -d /tmp/fed-selftest-runsmoke-work.XXXXXX)"
  RS_COUNTER="$RS_WORK/calls"
  # attempt 1: empty-body create failure (the boot-readiness flake); attempt 2: PASS.
  cat >"$RS_BIN_DIR/flaky-then-pass.sh" <<EOF
#!/usr/bin/env bash
n=\$(( \$(cat "$RS_COUNTER" 2>/dev/null || echo 0) + 1 )); echo "\$n" >"$RS_COUNTER"
if [ "\$n" -eq 1 ]; then echo '✗ create failed: '; else echo 'OVERALL: PASS'; fi
EOF
  chmod +x "$RS_BIN_DIR/flaky-then-pass.sh"
  # a genuine (non-empty-body) failure must NOT retry — stays FAIL every attempt.
  cat >"$RS_BIN_DIR/genuine-fail.sh" <<'EOF'
#!/usr/bin/env bash
echo '✗ create failed: {"error":"duplicate hive slug"}'
EOF
  chmod +x "$RS_BIN_DIR/genuine-fail.sh"

  flaky_result="$(
    DESKTOP_DIR="$RS_ROOT/papercusp-desktop" WORK="$RS_WORK" DISCOVERY_ATTEMPTS=3 \
    bash -c "$(cat <<BASH
log() { :; }
$runsmoke_snippet
run_smoke flaky flaky-then-pass.sh ""
BASH
)"
  )"
  rm -f "$RS_COUNTER"
  genuine_result="$(
    DESKTOP_DIR="$RS_ROOT/papercusp-desktop" WORK="$RS_WORK" DISCOVERY_ATTEMPTS=3 \
    bash -c "$(cat <<BASH
log() { :; }
$runsmoke_snippet
run_smoke genuine genuine-fail.sh ""
BASH
)"
  )"
  if [ "$flaky_result" = PASS ]; then
    ok "run_smoke retries an empty-body create/join failure (boot-readiness flake) and recovers to PASS"
  else
    bad "run_smoke did not retry the empty-body boot-readiness flake: got '$flaky_result' (expected PASS on attempt 2)"
  fi
  if [ "$genuine_result" = FAIL ]; then
    ok "run_smoke does NOT retry a genuine (non-empty-body) create failure — stays FAIL"
  else
    bad "run_smoke incorrectly retried/passed a genuine create failure: got '$genuine_result' (expected FAIL)"
  fi
  rm -rf "$RS_ROOT" "$RS_WORK"
fi

# 9) EI-505: fed_plan_part_merge_assert must SKIP (not spuriously FAIL) when
# harness_plan_parts is absent on either frame — a shipped .deb built before mig
# 270/271 landed has neither the table nor its capture trigger, and the raw INSERT
# used to hard-error ("relation ... does not exist"), reading as a genuine merge
# FAILURE and sinking deb-hetzner-federation.sh's OVERALL to INCOMPLETE even though
# discovery + feature + coord merges all passed. Stub drv_psql to simulate both
# frames, with no real PG / network involved — pure, hermetic.
declare -A EI505_HAS_TABLE=()
EI505_MERGED=0
drv_psql() {
  local inst="$1" sql="$2"
  case "$sql" in
    *"to_regclass('harness_shared.harness_plan_parts')"*)
      [ "${EI505_HAS_TABLE[$inst]:-0}" = 1 ] && echo t || echo f ;;
    *"INSERT INTO harness_shared.harness_plan_parts"*)
      EI505_MERGED=1 ;;
    *"SELECT origin||'|'||body FROM harness_shared.harness_plan_parts"*)
      [ "$EI505_MERGED" = 1 ] && echo "remote|xmerge-proof-from-src" ;;
    *"harness_features_consolidated WHERE harness_slug"*)
      echo "fake-ws" ;;
  esac
}

EI505_HAS_TABLE=( [src]=1 [dst]=0 ); EI505_MERGED=0
res="$(fed_plan_part_merge_assert src dst slug 1)"
[ "$res" = skip ] && ok "fed_plan_part_merge_assert SKIPs when harness_plan_parts is absent on dst (EI-505)" \
                   || bad "fed_plan_part_merge_assert expected 'skip' (table absent on dst), got '$res'"

EI505_HAS_TABLE=( [src]=0 [dst]=1 ); EI505_MERGED=0
res="$(fed_plan_part_merge_assert src dst slug 1)"
[ "$res" = skip ] && ok "fed_plan_part_merge_assert SKIPs when harness_plan_parts is absent on src (EI-505)" \
                   || bad "fed_plan_part_merge_assert expected 'skip' (table absent on src), got '$res'"

EI505_HAS_TABLE=( [src]=1 [dst]=1 ); EI505_MERGED=0
res="$(fed_plan_part_merge_assert src dst slug 1)"
[ "$res" = 1 ] && ok "fed_plan_part_merge_assert still MERGES (returns 1) when the table is present on both frames" \
               || bad "fed_plan_part_merge_assert expected '1' (table present, merge lands), got '$res'"

# deb-hetzner-federation.sh's OVERALL logic must treat a SKIPped plan-part leg as
# N/A, not a failure, and must not label it FAIL in the summary line.
FED_SCRIPT="$DIR/../deb-hetzner-federation.sh"
if grep -qE '\[ "\$ppab" != skip \]' "$FED_SCRIPT" && grep -q 'ppab" = skip \] \|\| \[ "\$ppab" = 1' "$FED_SCRIPT"; then
  ok "deb-hetzner-federation.sh's OVERALL condition treats a SKIPped plan-part leg as N/A, not FAIL"
else
  bad "deb-hetzner-federation.sh no longer excludes a SKIPped plan-part leg from the OVERALL gate (EI-505 regression)"
fi
if grep -q 'pp_label()' "$FED_SCRIPT" && grep -q 'skip) echo SKIP' "$FED_SCRIPT"; then
  ok "deb-hetzner-federation.sh reports plan-part legs as PASS/SKIP/FAIL, not a binary PASS/FAIL"
else
  bad "deb-hetzner-federation.sh no longer distinguishes SKIP from FAIL in its summary line (EI-505 regression)"
fi
unset -f drv_psql

required_line="$(grep '^REQUIRED_TOOLS=' "$verify_file" || true)"
case "$required_line" in
  *" omp "*|*" omp\""*)
    bad "verify-sidecar-bundle still requires retired bundled omp (WI-3344/WI-3343 regression)" ;;
  *)
    ok "verify-sidecar-bundle does not require retired bundled omp" ;;
esac

# fed_wait_api must ALWAYS dump instance diagnostics (listening ports + app-log
# tail) when it cannot confirm a 2xx sidecar — via EITHER exit path: the
# hard-FAIL branch (last literally "000") already did this; the "legacy
# liberal accept" branch (last non-2xx but not exactly the 3-char sentinel
# "000") used to return silently, losing the only record of why the sidecar
# never answered (2026-07-20 live-fed-gate triage: 3 consecutive content-matrix
# RED attempts all took this exact branch and left zero diagnostics before
# fed_cleanup_scoped's `rm -rf $WORK` destroyed the real app logs). Exercise
# the ACTUAL fed_wait_api against a port nothing listens on, with a log file
# fed_discover_sidecar_os cannot resolve to anything — forcing a non-2xx exit
# — and assert the diagnostic dump fires regardless of which non-2xx branch
# it took.
WAPI_WORK="$(mktemp -d /tmp/fed-selftest-waitapi.XXXXXX)"
WAPI_LOG="$WAPI_WORK/inst-y.applog"
echo "some unrelated boot log content, no discoverable sidecar port here" > "$WAPI_LOG"
FED_LOG[y]="$WAPI_LOG"
CLOSED_PORT="$(free_port)"   # bound+released — nothing is listening on it
declare -A FED_SC; FED_SC[y]="$CLOSED_PORT"
# Stub fed_discover_sidecar_os to fail FAST (real one does an O(all /proc entries)
# scan — correct in production but would make this hermetic ~2s selftest both slow
# AND host-load-dependent; every OTHER function this test doesn't target is a
# no-op/stub too, same pattern as the fed_plan_part_merge_assert stubs above).
eval "$(declare -f fed_discover_sidecar_os | sed '1s/.*/fed_discover_sidecar_os_real()/')"
fed_discover_sidecar_os() { return 1; }
WAPI_STDERR="$(mktemp /tmp/fed-selftest-waitapi-stderr.XXXXXX)"
fed_wait_api y 1 2>"$WAPI_STDERR" >/dev/null
unset -f fed_discover_sidecar_os; eval "$(declare -f fed_discover_sidecar_os_real | sed '1s/.*/fed_discover_sidecar_os()/')"; unset -f fed_discover_sidecar_os_real
if grep -q "listening TCP ports:" "$WAPI_STDERR" && grep -q "app-log tail" "$WAPI_STDERR"; then
  ok "fed_wait_api dumps instance diagnostics on a non-2xx exit (both the hard-FAIL and legacy-liberal-accept branches)"
else
  bad "fed_wait_api took a non-2xx exit but did not dump instance diagnostics (stderr: $(cat "$WAPI_STDERR" | tr '\n' '|'))"
fi
rm -rf "$WAPI_WORK" "$WAPI_STDERR"

echo
if [ "$FAILS" -eq 0 ]; then echo "PASS — port self-discovery self-test green"; exit 0; fi
echo "FAIL — $FAILS assertion(s) failed"; exit 1
