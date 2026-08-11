#!/bin/bash
# Run ON the Mac directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE).
# Fresh-install E2E of the SHIPPED Mac build. Bounded, single-shot, re-runnable.
#
# ─────────────────────────────────────────────────────────────────────────────
# THIS SCRIPT EMITS A VERDICT. exit 0 = PASS, 1 = FAIL, 2 = VOID.
#
# It used to run `set +e` with no exit code, so it ALWAYS exited 0 — including
# when the operator never booted. It printed "operator did NOT reach /api/health
# 200 within 200s" and returned success. A surface that cannot emit a failing
# verdict is not a signal (plan fix-0014-platform-defects-2026-08-10, D-009);
# it is decoration that looks like evidence, which is worse than nothing because
# it is quotable.
#
# VOID is a first-class outcome and the reason this script can be trusted. A run
# whose preconditions were violated COULD NOT HAVE FAILED, so it must not be
# allowed to report PASS. Every run asserts its own controls (below) and voids
# itself when they do not hold. "The tests passed" and "the tests could not have
# failed" are indistinguishable from the outside unless the script says so.
#
# CONTROLS asserted INSIDE every run — the macOS analogue of the Linux leg's
# `dpkg webkit2gtk=0` (EI-20075266271803900):
#   C1  node/npm absent from PATH. The operator sidecar is node-based, so if
#       /api/health answers, node came FROM THE BUNDLE. If a host node appears,
#       the artifact is no longer being asked to carry it → VOID, not PASS.
#   C2  nothing already answers /api/health before we launch. Otherwise a stray
#       or hand-launched listener satisfies the probe and a broken artifact
#       reports PASS (EI-19426130546444930: an HTTP-200 probe proves LIVENESS,
#       not PROVENANCE) → VOID.
#
# PROVENANCE BINDING: a listening port only counts when its owning pid's
# executable path is inside the INSTALLED bundle. The old port scan accepted any
# node process listening anywhere, so the strongest assertion in the script was
# satisfiable by something that was not the artifact at all.
#
# ENV:
#   MAC_E2E_SOURCE=published|build   default published — test the bytes users get.
#                                    `build` tests the local build tree (opt-out).
#   MAC_E2E_VERSION=0.0.15           published version to fetch.
#   MAC_E2E_ARTIFACT_BASE=<url>      override the published artifact base URL.
#   MAC_E2E_QUARANTINE=honest|strip  default honest — apply quarantine like a real
#                                    download and let Gatekeeper answer. `strip`
#                                    is the legacy behaviour and DOWNGRADES the
#                                    verdict scope (Gatekeeper NOT tested).
#   MAC_E2E_FRESH_STATE=1            move ~/.papercusp aside (restored on exit) so
#                                    first-run provisioning is genuinely exercised.
#                                    OFF by default: this runs on the owner's real
#                                    machine and we do not mutate their state dir.
#   MAC_E2E_BUNDLE_BASE=<dir>        explicit bundle dir (implies MAC_E2E_SOURCE=build).
# ─────────────────────────────────────────────────────────────────────────────

# NOTE: deliberately NOT `set -e`. We must run every assertion and report the
# full picture, not abort at the first one. Failures are accumulated explicitly.
# What we do NOT do is the old `set +e` with no exit code.

MAC_E2E_SOURCE="${MAC_E2E_SOURCE:-published}"
MAC_E2E_VERSION="${MAC_E2E_VERSION:-0.0.15}"
MAC_E2E_QUARANTINE="${MAC_E2E_QUARANTINE:-honest}"
ARTIFACT_BASE="${MAC_E2E_ARTIFACT_BASE:-https://pub-cb5359a346e94c0c88562bd41db9295a.r2.dev/HK70BNWvxXWRRRkMgl3PXqgdZyWYLsCG/desktop-v${MAC_E2E_VERSION}-alpha}"
[ -n "$MAC_E2E_BUNDLE_BASE" ] && MAC_E2E_SOURCE=build

FAILURES=0
VOIDS=0
NOTREACHED=0
CONFIDENCE="clean-room"

probe_health() {
  # echoes "PORT PID EXE" for the first port answering /api/health 200, else nothing.
  # The EXE is what turns a liveness probe into a provenance one, so it is resolved
  # here rather than at the call site where it would be easy to forget.
  local P code pid exe
  for P in $(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk '{print $9}' | grep -oE '[0-9]{4,5}$' | sort -u); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$P/api/health" 2>/dev/null)
    if [ "$code" = "200" ]; then
      pid=$(lsof -nP -iTCP:"$P" -sTCP:LISTEN -t 2>/dev/null | head -1)
      # `ps -o comm=` is WRONG here and fails in the expensive direction: for the
      # bundled sidecar it returns bare "node", so a correctly-installed app gets
      # REJECTED as foreign — a false FAIL on the one process we most need to
      # recognise. (Measured on Avis-iMac: comm="node" while the real image was
      # /Applications/Papercusp Server.app/Contents/Resources/sidecar/bin/node.)
      # lsof -d txt reports the actual mapped executable image, which is also not
      # spoofable by argv the way `ps -o args=` would be. args is the fallback only.
      exe=$(lsof -p "$pid" -a -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
      [ -z "$exe" ] && exe=$(ps -p "$pid" -o args= 2>/dev/null)
      echo "$P $pid $exe"
      return 0
    fi
  done
  return 1
}

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
    echo " confidence class: $CONFIDENCE"
    echo "=============================================================="
    exit 1
  fi
  echo " VERDICT: PASS (0 failures, $NOTREACHED not reached)"
  echo " confidence class: $CONFIDENCE"
  echo " scope: source=$MAC_E2E_SOURCE quarantine=$MAC_E2E_QUARANTINE version=$MAC_E2E_VERSION${CONTROLS_ONLY_NOTE}"
  echo "=============================================================="
  exit 0
}

pass()       { echo "  PASS  $*"; }
fail()       { echo "  FAIL  $*"; FAILURES=$((FAILURES+1)); }
void()       { echo "  VOID  $*"; VOIDS=$((VOIDS+1)); }
notreached() { echo "  ....  NOT REACHED — $*"; NOTREACHED=$((NOTREACHED+1)); }
note()       { echo "        $*"; }

echo "=============================================================="
echo " macOS fresh-install E2E — source=$MAC_E2E_SOURCE version=$MAC_E2E_VERSION quarantine=$MAC_E2E_QUARANTINE"
echo " host=$(hostname) macOS=$(sw_vers -productVersion 2>/dev/null)"
echo "=============================================================="

# ── 0. CONTROLS + host census ───────────────────────────────────────────────
# Run FIRST. A control checked after the fact cannot void a run that already
# reported a result, and the whole point is that this run must be able to fail.
echo
echo "=== 0. controls + host census (does this box let the run fail?) ==="

HOST_NODE=$(command -v node 2>/dev/null)
HOST_NPM=$(command -v npm 2>/dev/null)
if [ -n "$HOST_NODE" ] || [ -n "$HOST_NPM" ]; then
  void "C1 host supplies node/npm (node=${HOST_NODE:-none} npm=${HOST_NPM:-none}) — a booting operator would NOT prove the bundle carries its runtime"
else
  pass "C1 node/npm absent from PATH — if the operator answers, node came from the bundle"
fi

# Contamination census. These do not void the run, but they cap what it may CLAIM.
if [ -d "$HOME/papercup-build-mac" ]; then
  note "host carries a build tree ($(du -sh "$HOME/papercup-build-mac" 2>/dev/null | cut -f1)) — not a never-had-a-dev-install box"
  CONFIDENCE="host-contaminated"
fi
if [ -d "$HOME/.papercusp" ] && [ -z "$MAC_E2E_FRESH_STATE" ]; then
  note "~/.papercusp state dir PRESENT and preserved — first-run provisioning is NOT verified by this run"
  CONFIDENCE="host-contaminated"
fi
for T in cargo rustc; do
  command -v "$T" >/dev/null 2>&1 && note "host has $T (build-time only; not on a packaged app's launch path)"
done
note "confidence class: $CONFIDENCE"

# CONTROLS-ONLY: a read-only pre-flight answering "can this box even produce an
# honest verdict right now?" without touching /Applications or downloading 5GB.
# It exists so the verdict machinery is DEMONSTRABLE on demand — a gate nobody
# has watched fail is a gate nobody should trust, and requiring a destructive
# 5GB run to see one is how that check stops being made.
if [ -n "$MAC_E2E_CONTROLS_ONLY" ]; then
  CONTROLS_ONLY_NOTE=" [CONTROLS-ONLY: no install/launch was performed — this is a preflight, NOT runtime evidence]"
  echo
  echo "=== 2. C2 pre-launch baseline (read-only; running apps NOT quit in this mode) ==="
  BASE_HIT=$(probe_health)
  if [ -n "$BASE_HIT" ]; then
    void "C2 something already answers /api/health → $BASE_HIT"
    note "with this listener up, a real run could not attribute a 200 to the artifact"
  else
    pass "C2 nothing answers /api/health — a real run could attribute a 200 to the artifact"
  fi
  emit_verdict
fi

# ── 1. quit any running instance ────────────────────────────────────────────
echo
echo "=== 1. quit running instances ==="
osascript -e 'tell application "Papercusp GUI" to quit' 2>/dev/null
osascript -e 'tell application "Papercusp Server" to quit' 2>/dev/null
sleep 3
# Bounded to the INSTALLED bundle paths on purpose — never a bare name pattern.
pkill -f '/Applications/Papercusp GUI.app/Contents/MacOS' 2>/dev/null
pkill -f '/Applications/Papercusp Server.app/Contents/MacOS' 2>/dev/null
pkill -f '/Applications/Papercusp Server.app/Contents/Resources/sidecar' 2>/dev/null
sleep 3
note "remaining papercusp procs: $(ps aux | grep -iE '[P]apercusp' | wc -l | tr -d ' ')"

# ── 2. C2 baseline: nothing may already be answering ────────────────────────
echo
echo "=== 2. C2 pre-launch baseline (a listener here would make any PASS meaningless) ==="
BASE_HIT=$(probe_health)
if [ -n "$BASE_HIT" ]; then
  void "C2 something ALREADY answers /api/health before launch → $BASE_HIT"
  note "this run cannot distinguish 'the artifact booted' from 'that process was already there'"
else
  pass "C2 nothing answers /api/health pre-launch — a later 200 is attributable to what we install"
fi

# ── 3. acquire the artifact ─────────────────────────────────────────────────
echo
echo "=== 3. acquire artifact (source=$MAC_E2E_SOURCE) ==="
GUIAPP=""; SRVAPP=""
STAGE="$HOME/papercusp-e2e-stage"
rm -rf "$STAGE"; mkdir -p "$STAGE"

if [ "$MAC_E2E_SOURCE" = "published" ]; then
  CACHE="$HOME/papercusp-e2e-artifacts/$MAC_E2E_VERSION"
  mkdir -p "$CACHE"
  for PAIR in "Papercusp GUI.app.tar.gz" "Papercusp Server.app.tar.gz"; do
    OUT="$CACHE/$PAIR"
    if [ -s "$OUT" ]; then
      note "cached: $PAIR ($(du -h "$OUT" | cut -f1))"
    else
      note "downloading $PAIR ..."
      # -C - resumes a partial file; the artifacts are ~2.4GB each.
      curl -fL -C - --retry 3 --max-time 3600 -o "$OUT" \
        "$ARTIFACT_BASE/$(printf '%s' "$PAIR" | sed 's/ /%20/g')" \
        || { fail "download failed: $PAIR"; rm -f "$OUT"; }
    fi
    [ -s "$OUT" ] && tar -xzf "$OUT" -C "$STAGE" 2>/dev/null
  done
  GUIAPP=$(find "$STAGE" -maxdepth 2 -name '*GUI*.app' -type d 2>/dev/null | head -1)
  SRVAPP=$(find "$STAGE" -maxdepth 2 -name '*Server*.app' -type d 2>/dev/null | head -1)
  note "PROVENANCE: bytes fetched from $ARTIFACT_BASE"
else
  TGT="$HOME/papercup-build-mac/papercup/papercusp-desktop/src-tauri/target"
  if [ -n "$MAC_E2E_BUNDLE_BASE" ]; then
    BASE="$MAC_E2E_BUNDLE_BASE"
  else
    BASE=$(ls -t "$TGT"/universal-apple-darwin/release/bundle/dmg/*GUI*.dmg \
                 "$TGT"/x86_64-apple-darwin/release/bundle/dmg/*GUI*.dmg 2>/dev/null \
           | head -1 | xargs -I{} dirname {})
  fi
  note "BASE=$BASE"
  note "PROVENANCE: LOCAL BUILD TREE — these are not the bytes any user receives"
  CONFIDENCE="$CONFIDENCE,local-build-not-shipped-bytes"
  for DMG in $(ls -t "$BASE"/*Server*.dmg 2>/dev/null | head -1) $(ls -t "$BASE"/*GUI*.dmg 2>/dev/null | head -1); do
    MNT=$(hdiutil attach "$DMG" -nobrowse -readonly -mountrandom /tmp 2>/dev/null | grep -oE '/tmp/[^ ]+$' | tail -1)
    APP=$(find "$MNT" -maxdepth 1 -name '*.app' 2>/dev/null | head -1)
    [ -n "$APP" ] && cp -R "$APP" "$STAGE"/
    hdiutil detach "$MNT" >/dev/null 2>&1
  done
  GUIAPP=$(find "$STAGE" -maxdepth 1 -name '*GUI*.app' -type d 2>/dev/null | head -1)
  SRVAPP=$(find "$STAGE" -maxdepth 1 -name '*Server*.app' -type d 2>/dev/null | head -1)
fi

if [ -z "$GUIAPP" ] || [ -z "$SRVAPP" ]; then
  fail "could not acquire both app bundles (GUI='${GUIAPP:-missing}' Server='${SRVAPP:-missing}')"
else
  pass "acquired $(basename "$GUIAPP") + $(basename "$SRVAPP")"
  # Assert the artifact IS the version we claim to be testing. The published darwin
  # URLs are UNVERSIONED (`Papercusp GUI.app.tar.gz`), so the filename can never
  # answer this and a stale-bytes publish would be invisible (EI-20116702746261803).
  GOTVER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
            "$GUIAPP/Contents/Info.plist" 2>/dev/null)
  if [ "$MAC_E2E_SOURCE" = "published" ] && [ -n "$GOTVER" ] && [ "$GOTVER" != "$MAC_E2E_VERSION" ]; then
    fail "artifact version mismatch: manifest/url says $MAC_E2E_VERSION, bundle Info.plist says $GOTVER"
  else
    pass "bundle Info.plist version = ${GOTVER:-unknown}"
  fi
fi

# ── 4. replace the installed apps ───────────────────────────────────────────
echo
echo "=== 4. remove stale installs + install fresh (DESTRUCTIVE to /Applications) ==="
LSR=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
for app in "/Applications/Papercusp GUI.app" "/Applications/Papercusp Server.app" "/Applications/Papercusp.app"; do
  [ -e "$app" ] && { "$LSR" -u "$app" 2>/dev/null; rm -rf "$app" && note "removed $app"; }
done
# Prove the removal actually happened — otherwise a launch below could be
# satisfied by the PREVIOUS install and the whole run would be measuring nothing.
STALE=$(ls -d /Applications/Papercusp*.app 2>/dev/null | grep -v Tutorial | head -3)
if [ -n "$STALE" ]; then
  void "stale install(s) survived removal: $STALE — a later launch may not be the artifact under test"
else
  pass "no prior Papercusp app remains in /Applications"
fi

if [ -n "$GUIAPP" ] && [ -n "$SRVAPP" ]; then
  cp -R "$SRVAPP" /Applications/ && note "installed $(basename "$SRVAPP")"
  cp -R "$GUIAPP" /Applications/ && note "installed $(basename "$GUIAPP")"
fi

# ── 5. Gatekeeper ───────────────────────────────────────────────────────────
echo
echo "=== 5. Gatekeeper (the ad-hoc-signing question) ==="
GK_BLOCKED=0
if [ "$MAC_E2E_QUARANTINE" = "strip" ]; then
  xattr -dr com.apple.quarantine "/Applications/Papercusp GUI.app" 2>/dev/null
  xattr -dr com.apple.quarantine "/Applications/Papercusp Server.app" 2>/dev/null
  note "quarantine STRIPPED (legacy mode) — Gatekeeper NOT tested by this run"
  CONFIDENCE="$CONFIDENCE,gatekeeper-untested"
else
  # Mark the apps exactly as a browser download would. Stripping this xattr is
  # what hid the ad-hoc-signing question for every previous run of this script.
  for app in "/Applications/Papercusp GUI.app" "/Applications/Papercusp Server.app"; do
    xattr -w com.apple.quarantine "0081;$(printf '%x' "$(date +%s)");Safari;" "$app" 2>/dev/null
  done
  note "quarantine APPLIED (as a real download) — asking Gatekeeper the real question"

  SPCTL=$(spctl --assess --type execute --verbose=2 "/Applications/Papercusp GUI.app" 2>&1)
  note "spctl: $(echo "$SPCTL" | tr '\n' ' ' | head -c 200)"
  if echo "$SPCTL" | grep -qi 'accepted'; then
    pass "Gatekeeper ACCEPTS the shipped GUI bundle"
  else
    GK_BLOCKED=1
    fail "Gatekeeper REJECTS the shipped GUI bundle — a normal user who downloads this cannot open it"
    note "this is a finding about the ARTIFACT (ad-hoc signed / not notarized), not a script defect"
  fi
fi
"$LSR" -f "/Applications/Papercusp Server.app" 2>/dev/null
"$LSR" -f "/Applications/Papercusp GUI.app" 2>/dev/null

# ── 6. launch + runtime assertions ──────────────────────────────────────────
echo
echo "=== 6. launch GUI and verify the operator actually starts ==="
OPPORT=""; OPPID=""; OPEXE=""
if [ "$GK_BLOCKED" = "1" ]; then
  # Do NOT silently continue as if runtime were verified. Gatekeeper blocking the
  # app is precisely the state in which "the operator did not boot" is expected —
  # reporting those assertions as failures would double-count one root cause, and
  # reporting them as passes would be a lie.
  notreached "operator boot — Gatekeeper blocked launch"
  notreached "SPA render — Gatekeeper blocked launch"
  notreached "gateway :8788 — Gatekeeper blocked launch"
else
  open "/Applications/Papercusp GUI.app" 2>/dev/null
  note "launched; waiting for operator boot (up to 200s)..."
  for i in $(seq 1 100); do
    sleep 2
    HIT=$(probe_health)
    if [ -n "$HIT" ]; then
      OPPORT=$(echo "$HIT" | awk '{print $1}')
      OPPID=$(echo "$HIT" | awk '{print $2}')
      OPEXE=$(echo "$HIT" | cut -d' ' -f3-)
      note "port :$OPPORT answered 200 after ~$((i*2))s (pid $OPPID)"
      break
    fi
  done

  if [ -z "$OPPORT" ]; then
    fail "operator did NOT reach /api/health 200 within 200s"
    notreached "SPA render — no operator to serve it"
  else
    # PROVENANCE BINDING. 200 alone is liveness; this makes it provenance.
    case "$OPEXE" in
      /Applications/Papercusp*)
        pass "operator UP on :$OPPORT and OWNED BY THE INSTALLED BUNDLE ($OPEXE)"
        ;;
      *)
        fail "port :$OPPORT answers 200 but its owner is NOT the installed bundle: '${OPEXE:-unknown}'"
        note "liveness without provenance — exactly the false-OK this binding exists to catch"
        ;;
    esac

    HTML=$(curl -s --max-time 6 "http://127.0.0.1:$OPPORT/" 2>/dev/null)
    ERRCARD=$(echo "$HTML" | grep -ciE 'RouteErrorBoundary|hit an error|Importing a module script failed')
    ROOTDIV=$(echo "$HTML" | grep -c '<div id')
    if [ "$ERRCARD" -gt 0 ]; then
      fail "SPA rendered an error card (RouteErrorBoundary / module import failure)"
    elif [ "$ROOTDIV" -eq 0 ]; then
      fail "SPA root markup missing — served HTML has no app shell"
    else
      pass "SPA renders the app shell (no error card)"
    fi
  fi

  echo
  echo "=== 6b. gateway auto-supervised on :8788 ==="
  GW=""
  for i in $(seq 1 20); do
    GW=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8788/healthz 2>/dev/null)
    [ "$GW" = "200" ] && break
    sleep 2
  done
  if [ "$GW" = "200" ]; then
    pass "gateway answers :8788/healthz"
  else
    fail "gateway did not answer :8788/healthz (last code='${GW:-none}')"
  fi
fi

# ── 7. embedded PG ──────────────────────────────────────────────────────────
echo
echo "=== 7. embedded PG ==="
PGLINE=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -i postgres | head -1)
if [ -n "$PGLINE" ]; then
  pass "embedded PG is listening ($(echo "$PGLINE" | awk '{print $1, $9}'))"
else
  if [ "$GK_BLOCKED" = "1" ]; then
    notreached "embedded PG — Gatekeeper blocked launch"
  else
    fail "no embedded PG listener found"
  fi
fi

# ── VERDICT ─────────────────────────────────────────────────────────────────
emit_verdict
