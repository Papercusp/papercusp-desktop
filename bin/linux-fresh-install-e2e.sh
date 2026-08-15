#!/usr/bin/env bash
# Linux install + launch verification of the SHIPPED build. Bounded, single-shot, re-runnable.
#
# ─────────────────────────────────────────────────────────────────────────────
# THIS SCRIPT EMITS A VERDICT. exit 0 = PASS, 1 = FAIL, 2 = VOID.
#
# It is the Linux counterpart of bin/mac-vm-fresh-install-e2e.sh, which existed
# alone: bin/ carried a full mac fresh-install e2e plus seven mac-vm-* helpers
# and NOTHING equivalent for Linux (only build/repack scripts). The mac script's
# own comments cite "the Linux leg's `dpkg webkit2gtk=0`" control
# (EI-20075266271803900) — that leg is not in this repo. Written 2026-08-15 for
# WI-39343 (verify published 0.0.17-alpha on all three platforms).
#
# VOID is a first-class outcome and the reason this script can be trusted. A run
# whose preconditions were violated COULD NOT HAVE FAILED, so it must not be
# allowed to report PASS. "The tests passed" and "the tests could not have
# failed" are indistinguishable from the outside unless the script says so.
#
# ── WHY THIS IS NOT A COPY OF THE MAC CONTROLS ───────────────────────────────
# The mac script runs on a clean VM and can assert two controls that are simply
# NOT AVAILABLE on the Linux dev box. Faking them would be worse than not having
# them, so each is replaced by something actually falsifiable here:
#
#   C1  mac asserts "node/npm absent from PATH", so a /api/health answer proves
#       node came from the bundle. The dev box HAS node on PATH and cannot
#       un-have it. REPLACEMENT: we launch the artifact with a PATH scrubbed of
#       every directory containing a node/npm binary. That is strictly MORE
#       faithful to a clean user machine, and it is asserted (not assumed) by
#       re-resolving node under the scrubbed PATH before launch.
#
#   C2  mac asserts "nothing answers /api/health before we launch". On this box
#       that is guaranteed FALSE — the dev stack answers on :3055, :3070 and
#       :3170 continuously, and one of those would satisfy a naive port scan and
#       produce a PASS attributable to something that is not the artifact at all
#       (EI-19426130546444930: an HTTP-200 probe proves LIVENESS, not
#       PROVENANCE). REPLACEMENT: snapshot the set of health-answering ports
#       BEFORE launch, and accept only a port that is (a) absent from that
#       snapshot AND (b) owned by a pid whose executable path resolves INSIDE
#       our own extract dir. Both halves are required: (a) alone is satisfied by
#       any unrelated service that happens to start mid-run.
#
# PROVENANCE BINDING: a listening port only counts when its owning pid's exe
# (/proc/<pid>/exe, which argv cannot spoof) is inside the extracted artifact.
#
# ── NON-DESTRUCTIVE BY CONSTRUCTION ──────────────────────────────────────────
# This runs on the owner's real shared machine, so it must not mutate it:
#   · NO `dpkg -i`. The .deb is verified by metadata + extraction, never by a
#     system install (that needs sudo, writes /usr, and / is chronically near
#     full here). The RUN verification is therefore carried by the AppImage,
#     which is self-contained and is itself a published user-facing artifact.
#     Report that split honestly — this script does NOT prove `dpkg -i` works.
#   · HOME is redirected to a scratch dir so first-run provisioning cannot touch
#     the owner's real ~/.papercusp.
#   · Xvfb, so launching a GUI app cannot steal focus from the owner's desktop.
#   · All large files go under $PC_L_WORK (default /tmp), never $HOME.
#
# ENV:
#   PC_L_VERSION=0.0.17            version under test
#   PC_L_BASE=<url>                published artifact base (default: release-host.env)
#   PC_L_WORK=/tmp/pc-linux-e2e    work dir (downloads + extracts + scratch HOME)
#   PC_L_SOURCE=published|local    default published — test the bytes users get
#   PC_L_LOCAL_DIR=<dir>           with PC_L_SOURCE=local, where to find artifacts
#   PC_L_BOOT_TIMEOUT=300          seconds to wait for the operator to answer
#   PC_L_KEEP=1                    keep the work dir on exit (default: keep extracts,
#                                  they are large but re-download is expensive)
# ─────────────────────────────────────────────────────────────────────────────

# Deliberately NOT `set -e`: we must run every assertion and report the full
# picture, not abort at the first one. Failures are accumulated explicitly.

PC_L_VERSION="${PC_L_VERSION:-0.0.17}"
PC_L_WORK="${PC_L_WORK:-/tmp/pc-linux-e2e}"
PC_L_SOURCE="${PC_L_SOURCE:-published}"
PC_L_BOOT_TIMEOUT="${PC_L_BOOT_TIMEOUT:-300}"

if [ -z "$PC_L_BASE" ]; then
  # shellcheck disable=SC1090
  [ -f "$HOME/.papercusp/release-host.env" ] && . "$HOME/.papercusp/release-host.env"
  PC_L_BASE="${PAPERCUSP_RELEASE_HOST}/desktop-v${PC_L_VERSION}-alpha"
fi

FAILURES=0
VOIDS=0
NOTREACHED=0
APP_PID=""
XVFB_PID=""

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES+1)); }
void() { printf '  VOID  %s\n' "$1"; VOIDS=$((VOIDS+1)); }
skip() { printf '  ----  %s (not reached)\n' "$1"; NOTREACHED=$((NOTREACHED+1)); }

cleanup() {
  # Never pkill by name — it has twice killed the owner's live desktop and peer
  # Xvfb instances (CLAUDE.md). Only ever our own recorded pids.
  [ -n "$APP_PID" ] && kill -TERM "-$APP_PID" 2>/dev/null
  [ -n "$APP_PID" ] && kill -TERM "$APP_PID" 2>/dev/null
  sleep 3
  [ -n "$APP_PID" ] && kill -KILL "-$APP_PID" 2>/dev/null
  [ -n "$XVFB_PID" ] && kill -TERM "$XVFB_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

emit_verdict() {
  echo
  echo "=============================================================="
  if [ "$VOIDS" -gt 0 ]; then
    echo " VERDICT: VOID ($VOIDS control(s) violated, $FAILURES failure(s))"
    echo " This run COULD NOT HAVE FAILED honestly. Do not quote it as evidence."
    echo "=============================================================="
    exit 2
  fi
  if [ "$FAILURES" -gt 0 ]; then
    echo " VERDICT: FAIL ($FAILURES failed assertion(s), $NOTREACHED not reached)"
    echo " scope: source=$PC_L_SOURCE version=$PC_L_VERSION deb=metadata+extract-only (no dpkg -i)"
    echo "=============================================================="
    exit 1
  fi
  echo " VERDICT: PASS (0 failures, $NOTREACHED not reached)"
  echo " scope: source=$PC_L_SOURCE version=$PC_L_VERSION deb=metadata+extract-only (no dpkg -i)"
  echo "=============================================================="
  exit 0
}

# Returns "PORT PID EXE" for a health-200 port owned by a pid under $1, else nothing.
probe_health_bound() {
  local root="$1" P code pid exe
  for P in $(ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -u); do
    case " $BASELINE_PORTS " in *" $P "*) continue ;; esac   # C2: pre-existing
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$P/api/health" 2>/dev/null)
    [ "$code" = "200" ] || continue
    pid=$(ss -ltnpH "sport = :$P" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
    [ -n "$pid" ] || continue
    exe=$(readlink -f "/proc/$pid/exe" 2>/dev/null)
    case "$exe" in "$root"*) echo "$P $pid $exe"; return 0 ;; esac
  done
  return 1
}

echo "=============================================================="
echo " Linux install+launch E2E — version $PC_L_VERSION, source=$PC_L_SOURCE"
echo " base: $PC_L_BASE"
echo " work: $PC_L_WORK"
echo "=============================================================="

mkdir -p "$PC_L_WORK" || { echo "cannot create work dir"; exit 2; }
cd "$PC_L_WORK" || exit 2

APPIMAGE="Papercusp_GUI_${PC_L_VERSION}_amd64.AppImage"
DEB="Papercusp GUI_${PC_L_VERSION}_amd64.deb"

echo
echo "=== 0. controls + host census (does this box let the run fail?) ==="

# C2 baseline: every port already answering /api/health, recorded BEFORE launch.
BASELINE_PORTS=""
for P in $(ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -u); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$P/api/health" 2>/dev/null)
  [ "$code" = "200" ] && BASELINE_PORTS="$BASELINE_PORTS $P"
done
BASELINE_PORTS=$(echo $BASELINE_PORTS)
echo "  baseline health-200 ports (excluded from attribution): [${BASELINE_PORTS:-none}]"
pass "C2 baseline captured — a later 200 counts only if its port is NEW *and* its pid's exe is inside our extract"

# C1 replacement: scrub node/npm out of PATH for the launched app.
SCRUBBED_PATH=""
IFS=':' read -ra _dirs <<< "$PATH"
for d in "${_dirs[@]}"; do
  [ -z "$d" ] && continue
  if [ -x "$d/node" ] || [ -x "$d/npm" ]; then continue; fi
  SCRUBBED_PATH="${SCRUBBED_PATH:+$SCRUBBED_PATH:}$d"
done
if PATH="$SCRUBBED_PATH" command -v node >/dev/null 2>&1; then
  void "C1 node STILL resolvable under the scrubbed PATH — a health answer could come from a host node, not the bundle"
else
  pass "C1 node/npm absent under the scrubbed PATH the app is launched with — a health answer means node came from the bundle"
fi

for t in Xvfb dpkg-deb curl ss; do
  command -v "$t" >/dev/null 2>&1 || void "required tool missing: $t"
done

echo
echo "=== 1. acquire artifacts (source=$PC_L_SOURCE) ==="
fetch_one() {
  local name="$1" enc rc
  if [ "$PC_L_SOURCE" = "local" ]; then
    [ -f "$PC_L_LOCAL_DIR/$name" ] || { fail "local artifact missing: $name"; return 1; }
    cp -f "$PC_L_LOCAL_DIR/$name" "./$name" || { fail "copy failed: $name"; return 1; }
    return 0
  fi
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$name")
  local want
  want=$(curl -sS -I --max-time 60 "$PC_L_BASE/$enc" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}' | tail -1)
  if [ -z "$want" ]; then fail "published artifact not reachable (no content-length): $name"; return 1; fi
  if [ -f "./$name" ] && [ "$(stat -c %s "./$name")" = "$want" ]; then
    echo "        already have $name ($want bytes)"; return 0
  fi
  echo "        downloading $name ($want bytes) ..."
  curl -sS --fail --max-time 3600 -o "./$name" "$PC_L_BASE/$enc"; rc=$?
  [ $rc -ne 0 ] && { fail "download failed rc=$rc: $name"; return 1; }
  local got; got=$(stat -c %s "./$name")
  if [ "$got" != "$want" ]; then fail "size mismatch $name: got $got want $want"; return 1; fi
  pass "downloaded $name — $got bytes, matches published content-length exactly"
  return 0
}

HAVE_APPIMAGE=0; HAVE_DEB=0
fetch_one "$APPIMAGE" && HAVE_APPIMAGE=1
fetch_one "$DEB"      && HAVE_DEB=1

echo
echo "=== 2. .deb — metadata + extraction (NO system install; see header) ==="
if [ "$HAVE_DEB" = "1" ]; then
  DEBVER=$(dpkg-deb -f "./$DEB" Version 2>/dev/null)
  if [ "$DEBVER" = "$PC_L_VERSION" ]; then
    pass ".deb control Version = $DEBVER"
  else
    fail ".deb control Version = '${DEBVER:-<unreadable>}', expected $PC_L_VERSION"
  fi
  DEBARCH=$(dpkg-deb -f "./$DEB" Architecture 2>/dev/null)
  [ "$DEBARCH" = "amd64" ] && pass ".deb Architecture = amd64" || fail ".deb Architecture = '${DEBARCH:-<unreadable>}'"

  rm -rf ./deb-root && mkdir -p ./deb-root
  if dpkg-deb -x "./$DEB" ./deb-root 2>/dev/null; then
    pass ".deb payload extracts cleanly"
    DEBBIN=$(find ./deb-root -type f -perm -u+x -path '*bin*' 2>/dev/null | head -5)
    if [ -n "$DEBBIN" ]; then
      pass ".deb ships executables: $(echo "$DEBBIN" | head -1 | sed 's|^\./deb-root||')"
    else
      fail ".deb contains no executable under a bin dir"
    fi
    DEBNODE=$(find ./deb-root -type f -name node 2>/dev/null | head -1)
    if [ -n "$DEBNODE" ]; then
      pass ".deb carries a bundled node sidecar: $(echo "$DEBNODE" | sed 's|^\./deb-root||')"
    else
      fail ".deb carries NO bundled node — the operator sidecar could not start on a machine without node"
    fi
  else
    fail ".deb payload failed to extract"
  fi
else
  skip ".deb metadata + extraction"
fi

echo
echo "=== 3. AppImage — extract + LAUNCH + attribute a health answer ==="
if [ "$HAVE_APPIMAGE" != "1" ]; then
  skip "AppImage launch"
  emit_verdict
fi

chmod +x "./$APPIMAGE"
rm -rf ./squashfs-root
# --appimage-extract avoids requiring FUSE, which is not guaranteed here.
if ./"$APPIMAGE" --appimage-extract >/dev/null 2>&1 && [ -d ./squashfs-root ]; then
  pass "AppImage self-extracts (no FUSE required)"
else
  fail "AppImage failed to self-extract"
  emit_verdict
fi

EXTRACT_ROOT="$(cd ./squashfs-root && pwd)"
APPRUN="$EXTRACT_ROOT/AppRun"
[ -x "$APPRUN" ] || { fail "AppRun missing or not executable"; emit_verdict; }

APPNODE=$(find "$EXTRACT_ROOT" -type f -name node 2>/dev/null | head -1)
[ -n "$APPNODE" ] && pass "AppImage carries a bundled node sidecar" || fail "AppImage carries NO bundled node"

# Isolated HOME so first-run provisioning cannot touch the owner's ~/.papercusp.
SCRATCH_HOME="$PC_L_WORK/scratch-home"
rm -rf "$SCRATCH_HOME"; mkdir -p "$SCRATCH_HOME/xdg"
chmod 700 "$SCRATCH_HOME/xdg"

DISPLAY_NUM=$(( 90 + (RANDOM % 8) ))
Xvfb ":$DISPLAY_NUM" -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB_PID=$!
sleep 2
if ! kill -0 "$XVFB_PID" 2>/dev/null; then
  void "Xvfb failed to start — cannot launch a GUI app headlessly without stealing the owner's display"
  emit_verdict
fi
pass "Xvfb up on :$DISPLAY_NUM (pid $XVFB_PID) — no focus steal"

APP_LOG="$PC_L_WORK/app-launch.log"
echo "        launching AppRun (HOME=$SCRATCH_HOME, DISPLAY=:$DISPLAY_NUM, node-free PATH) ..."
setsid env -i \
  HOME="$SCRATCH_HOME" \
  DISPLAY=":$DISPLAY_NUM" \
  PATH="$SCRUBBED_PATH" \
  USER="${USER:-runner}" \
  LANG="${LANG:-C.UTF-8}" \
  XDG_RUNTIME_DIR="$SCRATCH_HOME/xdg" \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  "$APPRUN" >"$APP_LOG" 2>&1 &
APP_PID=$!
sleep 5
if ! kill -0 "$APP_PID" 2>/dev/null; then
  fail "app process died within 5s of launch — see $APP_LOG"
  echo "  ---- launch log tail ----"; tail -25 "$APP_LOG" 2>/dev/null | sed 's/^/  | /'
  emit_verdict
fi
pass "app process launched and survived first 5s (pid $APP_PID)"

echo "        waiting up to ${PC_L_BOOT_TIMEOUT}s for an operator health answer attributable to this artifact ..."
FOUND=""
WAITED=0
while [ "$WAITED" -lt "$PC_L_BOOT_TIMEOUT" ]; do
  FOUND=$(probe_health_bound "$EXTRACT_ROOT")
  [ -n "$FOUND" ] && break
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    fail "app process EXITED after ${WAITED}s without ever answering /api/health"
    echo "  ---- launch log tail ----"; tail -25 "$APP_LOG" 2>/dev/null | sed 's/^/  | /'
    emit_verdict
  fi
  sleep 5; WAITED=$((WAITED+5))
done

if [ -z "$FOUND" ]; then
  fail "no artifact-attributable /api/health 200 within ${PC_L_BOOT_TIMEOUT}s"
  echo "  ---- launch log tail ----"; tail -25 "$APP_LOG" 2>/dev/null | sed 's/^/  | /'
  emit_verdict
fi

HPORT=$(echo "$FOUND" | awk '{print $1}')
HPID=$(echo "$FOUND" | awk '{print $2}')
HEXE=$(echo "$FOUND" | awk '{print $3}')
pass "operator answered /api/health 200 on :$HPORT after ~${WAITED}s"
pass "PROVENANCE BOUND — pid $HPID exe is inside the extracted artifact: $(echo "$HEXE" | sed "s|$EXTRACT_ROOT|<extract>|")"

HEALTH=$(curl -s --max-time 10 "http://127.0.0.1:$HPORT/api/health" 2>/dev/null)
echo "        /api/health => $(echo "$HEALTH" | head -c 400)"
RVER=$(echo "$HEALTH" | python3 -c "import json,sys
try:
  d=json.load(sys.stdin); print(d.get('version') or (d.get('build') or {}).get('version') or '')
except Exception: print('')" 2>/dev/null)
if [ "$RVER" = "$PC_L_VERSION" ]; then
  pass "running operator self-reports version $RVER — matches the artifact under test"
elif [ -z "$RVER" ]; then
  fail "/api/health carried no version field — cannot confirm the running build is $PC_L_VERSION"
else
  fail "running operator reports version '$RVER', expected $PC_L_VERSION"
fi

sleep 10
if kill -0 "$APP_PID" 2>/dev/null; then
  pass "no first-run crash — app still alive 10s after the operator came up"
else
  fail "app exited shortly after the operator came up (first-run crash)"
fi

emit_verdict
