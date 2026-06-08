#!/usr/bin/env bash
# federation-asserts.sh — the single shared orchestration/assert core for ALL
# two-instance federation proofs (D-003 of linux-test-vm-and-federation-2026-06-04).
#
# Consumed by three drivers:
#   • bin/two-instance-federation-smoke.sh  (local driver: boot + isolation + discovery)
#   • bin/two-instance-merge-smoke.sh       (local driver: + write-free bidirectional MERGE)
#   • bin/vm-federation.sh                  (vm driver: the same asserts over SSH into VMs)
#
# The lib never decides WHERE an instance runs. A driver defines three
# primitives, then calls the fed_* asserts:
#
#   drv_exec <inst>         run a bash script (stdin) in the instance's exec
#                           context (local driver: this host; vm driver: ssh)
#   drv_applog <inst>       app-log path AS SEEN INSIDE that exec context
#   drv_psql <inst> <sql>   run one `psql -tA -c` statement against the
#                           instance's embedded PG (from inside its machine)
#
# plus per-instance metadata in global assoc arrays (filled by fed_wait_boot):
#   FED_PG[inst]  FED_SC[inst]      — embedded-PG / sidecar (hono-host) ports
#
# Every network probe (curl to the sidecar, psql) deliberately goes THROUGH
# drv_exec / drv_psql: a packaged instance binds 127.0.0.1 and is reachable
# only from inside its own machine — the locality is the driver's business.
#
# Conventions: functions return non-zero on failure and print why; the DRIVER
# owns exit codes and overall pass/fail policy (behavior parity with the
# pre-refactor smokes).

declare -gA FED_PG FED_SC
declare -ga FED_KILL_PIDS

fed_log() { printf '\n=== %s ===\n' "$*"; }

# ── .deb extraction + integrity ─────────────────────────────────────────────

# fed_extract_deb <deb> <pkgdir> — extract; assert the desktop binary exists.
fed_extract_deb() {
  local deb="$1" pkg="$2"
  [ -f "$deb" ] || { echo "FATAL: .deb not found: $deb"; return 1; }
  mkdir -p "$pkg"; dpkg-deb -x "$deb" "$pkg"
  [ -x "$pkg/usr/bin/papercusp-desktop" ] || { echo "FATAL: binary missing in .deb: $pkg/usr/bin/papercusp-desktop"; return 1; }
}

# fed_clobber_check <pkgdir> — the build-clobber defect ships 0-byte sidecar
# files; a clobbered .deb cannot boot embedded-PG or the operator.
fed_clobber_check() {
  local pkg="$1" side="$1/usr/lib/Papercusp/sidecar" clobbered=0 f sz
  # SP1 C5 layout: serve.mjs is the boot entry (host.mjs retired); the
  # embedded-postgres-server package ships under sidecar/node_modules so
  # serve.mjs's externalized bare-specifier import resolves.
  for f in "$side/serve.mjs" \
           "$side/node_modules/@papercusp/embedded-postgres-server/src/index.js" \
           "$side/node_modules/@papercusp/embedded-postgres-server/node_modules/@embedded-postgres/linux-x64/native/bin/initdb" \
           "$side/node_modules/@papercusp/embedded-postgres-server/node_modules/@embedded-postgres/linux-x64/native/bin/postgres" \
           "$side/spa/index.html"; do
    sz=$(stat -c%s "$f" 2>/dev/null || echo MISSING)
    printf '  %10s  %s\n' "$sz" "$f"
    { [ "$sz" = "0" ] || [ "$sz" = "MISSING" ]; } && clobbered=1
  done
  if [ "$clobbered" = "1" ]; then
    echo
    echo "FATAL: this .deb is CORRUPT — 0-byte/missing sidecar files (the"
    echo "       build-desktop-sidecar.sh concurrent-build clobber). Rebuild with a"
    echo "       clean, non-concurrent build and re-run."
    return 1
  fi
}

# fed_assert_deb_swarm_support <pkgdir> — P-011 fail-fast: an older .deb
# silently ignores PAPERCUSP_DHT_BOOTSTRAP (public DHT → same-box/bridge
# discovery cannot work) and emits no [swarm] logs (failures invisible).
# The env-var name and log prefix are literal strings in the esbuild-bundled
# host.mjs, so a static grep is a reliable version gate.
fed_assert_deb_swarm_support() {
  local serve_mjs="$1/usr/lib/Papercusp/sidecar/serve.mjs"
  grep -q 'PAPERCUSP_DHT_BOOTSTRAP' "$serve_mjs" 2>/dev/null \
    || { echo "FATAL: .deb too old — serve.mjs lacks PAPERCUSP_DHT_BOOTSTRAP support (swarm.ts, landed 2026-06-02). Rebuild from a current tree."; return 1; }
  grep -q '\[swarm\]' "$serve_mjs" 2>/dev/null \
    || { echo "FATAL: .deb too old — serve.mjs lacks the [swarm] boot diagnostics (boot.ts). Rebuild from a current tree."; return 1; }
  echo "✓ .deb honors PAPERCUSP_DHT_BOOTSTRAP + emits [swarm] logs (static check)"
}

# ── headless display (host-side) ────────────────────────────────────────────

# fed_ensure_display <num> <work> — reuse :num if up, else start Xvfb.
# Echoes 1 if we started it (caller kills it on cleanup), 0 if reused.
fed_ensure_display() {
  local num="$1" work="$2"
  if DISPLAY=":$num" xdpyinfo >/dev/null 2>&1; then echo 0; return 0; fi
  fed_log "starting Xvfb :$num (headless — never the user's :0)" >&2
  nohup Xvfb ":$num" -screen 0 1280x1024x24 >"$work/xvfb.log" 2>&1 &
  sleep 2; echo 1
}

# fed_fresh_display <num> <work> — refuse a busy display (never share a peer's
# Xvfb), start a dedicated one. Appends its pid to FED_KILL_PIDS.
fed_fresh_display() {
  local num="$1" work="$2"
  if DISPLAY=":$num" xdpyinfo >/dev/null 2>&1; then
    echo "FATAL: :$num busy — set PAPERCUSP_SMOKE_DISPLAY to a free one"; return 1
  fi
  fed_log "start Xvfb :$num" >&2
  Xvfb ":$num" -screen 0 1280x1024x24 >"$work/xvfb.log" 2>&1 & FED_KILL_PIDS+=("$!")
  sleep 2
}

# ── local testnet DHT (deterministic discovery without the public DHT) ──────

# fed_start_testnet_dht <operator_dir> <work> [advertise_host]
# Spins a hyperdht/testnet on the host. With no advertise_host it binds 127.0.0.1
# and uses 3 nodes (same-box loopback discovery — all reachable on loopback). With
# an advertise_host (the fed-bridge IP 10.77.0.1) it binds 0.0.0.0 and runs a
# SINGLE node advertised on that host: a multi-node testnet's secondary nodes
# advertise host-internal (127.0.0.1) addresses the VMs cannot reach over the
# bridge, so a VM peer's DHT lookups to them fail and holepunch coordination
# stalls (peers join the topic but never peer_connect). One reachable node on the
# bridge IP is sufficient to coordinate two peers + announces it cleanly.
# Echoes the bootstrap list (host:port,…); appends the node pid to FED_KILL_PIDS.
fed_start_testnet_dht() {
  local operator_dir="$1" work="$2" host="${3:-}"
  fed_log "spin local testnet DHT (hyperdht/testnet${host:+, single node advertised on $host})" >&2
  # $work rides argv as a cleanup marker: killing the launching subshell pid
  # orphans the node child, but fed_cleanup_scoped's `grep -F "$work"` over
  # ps args catches it (the pre-refactor smokes leaked these DHT nodes).
  ( cd "$operator_dir" && PAPERCUSP_DHT_HOST="$host" node --input-type=module -e '
      import createTestnet from "hyperdht/testnet.js";
      const host = process.env.PAPERCUSP_DHT_HOST || undefined;
      // host-advertised (bridge) → 1 reachable node; loopback → 3 (all reachable).
      const t = await createTestnet(host ? 1 : 3, host ? { host } : {});
      console.log("BOOTSTRAP=" + t.bootstrap.map(b => b.host + ":" + b.port).join(","));
      console.error("[testnet] nodes=" + t.nodes.length + " bootstrap=" + JSON.stringify(t.bootstrap));
      process.stdin.resume();
    ' "$work" ) >"$work/dht.log" 2>&1 & FED_KILL_PIDS+=("$!")
  local i bootstrap=""
  for i in $(seq 1 20); do
    bootstrap=$(grep -oE 'BOOTSTRAP=[^ ]+' "$work/dht.log" 2>/dev/null | head -1 | cut -d= -f2)
    [ -n "$bootstrap" ] && break; sleep 1
  done
  [ -n "$bootstrap" ] || { echo "FATAL: testnet DHT did not start"; cat "$work/dht.log"; return 1; }
  echo "$bootstrap"
}

# ── the LOCAL driver (an isolated packaged instance on THIS host) ───────────
# Both pre-refactor smokes launched instances the same way (isolated $HOME,
# shared gh config, bundled-node-first PATH, vglrun on a headless display);
# vm-federation.sh --vms=1 reuses it for the host-side instance.

# fed_local_launch <home> <logf> <bin> <display_num> [VAR=val ...]
fed_local_launch() {
  local home="$1" logf="$2" bin="$3" disp="$4"; shift 4
  mkdir -p "$home/.config"
  ln -sf "$HOME/.config/gh" "$home/.config/gh"          # share gh auth (announce identity)
  ln -sf "$HOME/.gitconfig" "$home/.gitconfig" 2>/dev/null || true
  ( cd "$(dirname "$bin")"
    env DISPLAY=":$disp" HOME="$home" PATH="$(dirname "$(command -v node)"):$PATH" "$@" \
      setsid nohup vglrun -d egl0 "$bin" >"$logf" 2>&1 < /dev/null ) &
  FED_KILL_PIDS+=("$!")
}

# Local-driver primitives. A script that only runs local instances can use
# these as-is: FED_LOG[inst]=<host log path>, FED_DB[inst]=<host DSN>.
declare -gA FED_LOG FED_DB
drv_exec_local()   { bash -s; }
drv_applog_local() { echo "${FED_LOG[$1]}"; }
drv_psql_local()   { psql "${FED_DB[$1]}" -tA -c "$2"; }

# Default vtable = local. vm-federation.sh overrides these three.
drv_exec()   { drv_exec_local "$@"; }
drv_applog() { drv_applog_local "$@"; }
drv_psql()   { drv_psql_local "$@"; }

# ── boot / isolation ────────────────────────────────────────────────────────

# fed_wait_boot <inst> [tries] — poll the instance's app log for embedded-PG +
# sidecar readiness; fill FED_PG/FED_SC. Accepts both current and older boot
# markers (union of the two pre-refactor smokes' patterns).
# The sidecar grep MUST be anchored to the '[serve] listening' (or legacy
# 'hono-host] listening') prefix: the packaged app hosts OTHER http listeners
# (code-server logs a generic 'HTTP server listening on http://127.0.0.1:N/'
# well before the sidecar is up), and a bare 'listening on' grep races them —
# PG-ready lands first, the only 'listening' match is code-server, and every
# API call then hits the wrong port (405s; share/finalize "returns" empty).
# Seen live 2026-06-07: B sc grabbed code-server twice in a row while A won
# the race both times.
# MUST be called directly (NOT in a $(…) command substitution — the array
# fills would die in the subshell). On failure sets FED_BOOT_ERR and returns 1.
declare -g FED_BOOT_ERR=""
fed_wait_boot() {
  local inst="$1" tries="${2:-50}" i out pg sc logf
  logf="$(drv_applog "$inst")"
  for i in $(seq 1 "$tries"); do
    out="$(drv_exec "$inst" <<EOF
log="$logf"
pg=\$(grep -oE 'ready on localhost:[0-9]+ db=papercusp' "\$log" 2>/dev/null | grep -oE '[0-9]+' | tail -1)
[ -n "\$pg" ] || pg=\$(grep -oE 'embedded-postgres-server ready on 127\.0\.0\.1:[0-9]+' "\$log" 2>/dev/null | grep -oE '[0-9]+\$' | tail -1)
sc=\$(grep -oE '\[serve\] listening on http://127\.0\.0\.1:[0-9]+' "\$log" 2>/dev/null | grep -oE '[0-9]+\$' | tail -1)
[ -n "\$sc" ] || sc=\$(grep -oE 'hono-host\] listening on http://127\.0\.0\.1:[0-9]+' "\$log" 2>/dev/null | grep -oE '[0-9]+\$' | tail -1)
[ -n "\$sc" ] || sc=\$(grep -oE '(operator|sidecar) ready on :[0-9]+' "\$log" 2>/dev/null | grep -oE '[0-9]+' | tail -1)
if grep -qiE 'falling through to pglite|initdb may have failed|failed to spawn embedded-postgres-server|\[serve\] fatal' "\$log" 2>/dev/null; then echo "PGFAIL"; exit 0; fi
[ -n "\$pg" ] && [ -n "\$sc" ] && echo "\$pg \$sc"
EOF
)"
    case "$out" in
      PGFAIL) FED_BOOT_ERR="EMBEDDED_PG_FAILED"; return 1 ;;
      "")     sleep 3 ;;
      *)      pg=${out%% *}; sc=${out##* }
              FED_PG[$inst]="$pg"; FED_SC[$inst]="$sc"
              return 0 ;;
    esac
  done
  FED_BOOT_ERR="BOOT_TIMEOUT"; return 1
}

# fed_assert_isolated <instA> <instB> — distinct PG + sidecar ports. (Trivially
# true across two VMs; the check matters for two instances on one machine.)
fed_assert_isolated() {
  local a="$1" b="$2"
  if [ "${FED_PG[$a]}" != "${FED_PG[$b]}" ] && [ "${FED_SC[$a]}" != "${FED_SC[$b]}" ]; then
    echo "✓ isolated (distinct PG + sidecar ports)"
  else
    echo "FATAL: port collision — instances not isolated"; return 1
  fi
}

# ── sidecar API readiness ────────────────────────────────────────────────────

# fed_wait_api <inst> [tries] — the boot log's "hono-host listening" line can
# precede the API actually accepting connections; poll a cheap endpoint until it
# answers (any HTTP status = up; curl exit 7 = connection refused) so the share/
# register curls don't race a not-quite-ready sidecar. Returns 1 on timeout.
fed_wait_api() {
  local inst="$1" tries="${2:-20}" i code
  for i in $(seq 1 "$tries"); do
    code="$(drv_exec "$inst" <<EOF
curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${FED_SC[$inst]}/api/desktop/preflight" 2>/dev/null || echo 000
EOF
)"
    [ -n "$code" ] && [ "$code" != "000" ] && return 0
    sleep 2
  done
  return 1
}

# ── share (swarm-topic join) ────────────────────────────────────────────────

# fed_register_project <inst> <slug> <parent_dir> <folder>
# Register a harness project (the share endpoint needs a registered harness).
fed_register_project() {
  local inst="$1" slug="$2" parent="$3" folder="$4"
  drv_exec "$inst" <<EOF >/dev/null
curl -s -m 60 -X POST "http://127.0.0.1:${FED_SC[$inst]}/api/harness/projects" \
  -H 'content-type: application/json' \
  -d '{"slug":"$slug","parentDir":"$parent","folderName":"$folder"}'
EOF
}

# fed_share_finalize <inst> <slug> <state_json> — POST share/finalize; echoes
# the interesting response fragments (bindingPublished / state).
fed_share_finalize() {
  local inst="$1" slug="$2" state_json="$3"
  drv_exec "$inst" <<EOF
curl -s -m 90 -X POST "http://127.0.0.1:${FED_SC[$inst]}/api/harness/$slug/share/finalize" \
  -H 'content-type: application/json' \
  -d '{"state":$state_json}' | head -c 400
EOF
}

# ── discovery ───────────────────────────────────────────────────────────────

# fed_wait_discovery <instA> <instB> <mode> [tries]
#   strict — require the always-on [swarm] peer_connected line; a [swarm] join
#            FAILED line on either side fails immediately (post-2026-06-02 debs).
#   loose  — the older federation-smoke grep (peer_connected|peer connected|
#            onAnnounce|admit), warn-only semantics left to the caller.
# Echoes 1 (discovered) or 0.
fed_wait_discovery() {
  local a="$1" b="$2" mode="$3" tries="${4:-30}" i out
  for i in $(seq 1 "$tries"); do
    out="$(_fed_disc_probe "$a" "$mode")$(_fed_disc_probe "$b" "$mode")"
    case "$out" in
      *FAILED*) echo "✗ swarm join FAILED — see [swarm] lines in the instance logs" >&2; echo 0; return 1 ;;
      *HIT*)    echo 1; return 0 ;;
    esac
    sleep 3
  done
  echo 0; return 1
}
_fed_disc_probe() {  # <inst> <mode> → HIT / FAILED / ""
  local inst="$1" mode="$2" logf; logf="$(drv_applog "$inst")"
  if [ "$mode" = "strict" ]; then
    drv_exec "$inst" <<EOF
if grep -qE '\[swarm\] join FAILED' "$logf" 2>/dev/null; then echo FAILED;
elif grep -qE '\[swarm\] peer_connected' "$logf" 2>/dev/null; then echo HIT; fi
EOF
  else
    drv_exec "$inst" <<EOF
grep -qiE 'peer_connected|peer connected|onAnnounce|admit' "$logf" 2>/dev/null && echo HIT || true
EOF
  fi
}

# ── the MERGE assert (the hard bidirectional gate) ──────────────────────────

# fed_merge_assert <src> <dst> <slug> <feature_id> <title> <status> [tries]
# INSERT origin='local' on src; poll dst for the row with origin='remote'.
# Echoes 1 (merged) or 0.
fed_merge_assert() {
  local src="$1" dst="$2" slug="$3" fid="$4" title="$5" status="$6" tries="${7:-30}" i row ts
  ts="$(date +%s)000"
  drv_psql "$src" "INSERT INTO harness_shared.harness_features_consolidated (harness_slug,feature_id,title,summary,status,attempts,origin,ts,created_ts,updated_ts) VALUES ('$slug','$fid','$title','merge proof','$status',0,'local',$ts,$ts,$ts);" >/dev/null
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$dst" "SELECT origin FROM harness_shared.harness_features_consolidated WHERE harness_slug='$slug' AND feature_id='$fid';" 2>/dev/null | tr -d '[:space:]')"
    [ "$row" = "remote" ] && { echo 1; return 0; }
    sleep 3
  done
  echo 0; return 1
}

# ── teardown ────────────────────────────────────────────────────────────────

# fed_cleanup_scoped <work> — kill FED_KILL_PIDS + every process whose cmdline
# carries THIS run's $work (the packaged instance trees: desktop binary,
# host.mjs sidecar, embedded-PG, code-server). NEVER a broad
# `pkill -f papercusp-desktop` — that kills peers' dev desktops.
fed_cleanup_scoped() {
  local work="$1" p
  for p in "${FED_KILL_PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true; done
  pkill -9 -f "$work" 2>/dev/null || true
  ps -eo pid,args 2>/dev/null | grep -F "$work" | grep -v grep | awk '{print $1}' | xargs -r kill -9 2>/dev/null || true
  rm -rf "$work" 2>/dev/null || true
}
