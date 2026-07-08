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

# 5) fed_local_launch_sidecar rejects same/empty hono+pg ports (the 2026-07-03
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

# 6) ambient-env neutralization (the 2026-07-03 P-002 layer-4 class): fleet
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
done

# 7) Route-cutover guard (WI-2929): the live federation driver runs against the
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
required_line="$(grep '^REQUIRED_TOOLS=' "$verify_file" || true)"
case "$required_line" in
  *" omp "*|*" omp\""*)
    bad "verify-sidecar-bundle still requires retired bundled omp (WI-3344/WI-3343 regression)" ;;
  *)
    ok "verify-sidecar-bundle does not require retired bundled omp" ;;
esac

echo
if [ "$FAILS" -eq 0 ]; then echo "PASS — port self-discovery self-test green"; exit 0; fi
echo "FAIL — $FAILS assertion(s) failed"; exit 1
