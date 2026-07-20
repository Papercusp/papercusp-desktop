#!/usr/bin/env bash
# P-016 (desktop-build-hardening-tri-platform-2026-07-11): parity REGRESSION GATE
# for build provenance. Locks the invariants the plan's Phase 1 established so a
# future edit to ANY leg cannot silently re-fork provenance emission or the
# centralized sha derivation:
#
#   • ONE emitter, ONE schema (P-001/P-002): linux, mac AND windows all emit via
#     bin/emit-build-provenance.sh — none re-inlines its own printf emitter.
#   • ONE honest sha (P-003): release-local.sh derives BUILD_SHA with the -dirty
#     marker in a single place; no leg bakes a bare rev-parse of its own.
#
# CI-style: prints its checks and exits 0 (pass) / 1 (fail). Fast + hermetic
# (runs the emitter against throwaway fixtures; no build, no VM). Wired as a
# fail-fast at the top of release-local.sh AND runnable standalone.
#
# NOTE on the byte-repro acceptance from D-006 ("a second cut from the same
# gitHead reproduces the same packedSrcFingerprint"): that needs a pinned
# toolchain to be truly deterministic and is tracked under P-014 (reproducible-
# build hygiene). This gate delivers the schema + no-re-fork half now.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
EMITTER="$HERE/emit-build-provenance.sh"
RELEASE_LOCAL="$HERE/release-local.sh"
WIN_BUILD="$HERE/build-windows-cross.sh"
ROOT="$(cd "$HERE/.." && pwd)"

fail() { echo "PROVENANCE-PARITY FAIL: $*" >&2; exit 1; }
pass() { echo "  ✓ $*"; }

[[ -f "$EMITTER" ]]       || fail "shared emitter missing at $EMITTER"
[[ -f "$RELEASE_LOCAL" ]] || fail "release-local.sh missing at $RELEASE_LOCAL"
[[ -f "$WIN_BUILD" ]]     || fail "build-windows-cross.sh missing at $WIN_BUILD"

# ── Check 1: schema conformance in BOTH modes ──────────────────────────────
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/lin/deb" "$TMP/win"
# WI-4243 fixtures: a subdir artifact WITH a .sig (names must come out relative
# to OUT_DIR, sig recorded true) + a windows payload slice with NO .sig.
printf 'fixture\n' > "$TMP/lin/deb/App_0.0.0_amd64.deb"
printf 'sigbytes\n' > "$TMP/lin/deb/App_0.0.0_amd64.deb.sig"
printf 'fixture\n' > "$TMP/win/App_0.0.0_x64-setup.exe"
printf 'fixture\n' > "$TMP/win/App_0.0.0_x64-setup-1.bin"

PROVENANCE_GIT_ROOT="$ROOT" \
  bash "$EMITTER" "$TMP/lin" 0.0.0 testsha false "$TMP/lin"/deb/*.deb >/dev/null \
  || fail "emitter (mac/linux mode) exited non-zero"
PROVENANCE_GIT_ROOT="$ROOT" PROVENANCE_PACKED_SRC_FINGERPRINT=testfp PROVENANCE_SIGNED=false \
  bash "$EMITTER" "$TMP/win" 0.0.0 testsha false "$TMP/win"/*-setup.exe "$TMP/win"/*-setup-*.bin >/dev/null \
  || fail "emitter (windows mode) exited non-zero"

python3 - "$TMP/lin/build-provenance.json" "$TMP/win/build-provenance.json" <<'PY' || fail "schema conformance check failed (see above)"
import json, sys
lin = json.load(open(sys.argv[1])); win = json.load(open(sys.argv[2]))
BASE = {"version":str,"buildSha":str,"reused":bool,"gitHead":str,"gitDirty":bool,"builtAtUtc":str,"artifacts":list}
def check(name, d, extra_expected):
    for k,t in BASE.items():
        if k not in d: raise SystemExit(f"  {name}: missing shared-schema key {k!r}")
        if not isinstance(d[k], t): raise SystemExit(f"  {name}: key {k!r} has wrong type ({type(d[k]).__name__})")
    for a in d["artifacts"]:
        if not (isinstance(a.get("sha256"), str) and len(a["sha256"]) == 64):
            raise SystemExit(f"  {name}: artifact sha256 malformed")
        if not isinstance(a.get("bytes"), int):
            raise SystemExit(f"  {name}: artifact bytes not an int")
        if not isinstance(a.get("name"), str):
            raise SystemExit(f"  {name}: artifact name not a string")
        if not isinstance(a.get("sig"), bool):
            raise SystemExit(f"  {name}: artifact sig not a bool (WI-4243 per-artifact sig recording)")
    got_extra = {k for k in ("packedSrcFingerprint","signed") if k in d}
    if got_extra != extra_expected:
        raise SystemExit(f"  {name}: leg-specific fields {got_extra} != expected {extra_expected}")
check("mac/linux", lin, set())
check("windows", win, {"packedSrcFingerprint","signed"})
# WI-4243 invariants: subdir artifacts keep their OUT_DIR-relative subpath name
# (no more symlink stages for verify), sig reflects the co-located .sig, and
# the windows *-setup-*.bin payload slices are enumerated.
lin_by_name = {a["name"]: a for a in lin["artifacts"]}
if "deb/App_0.0.0_amd64.deb" not in lin_by_name:
    raise SystemExit(f"  mac/linux: subdir artifact name not OUT_DIR-relative (got {sorted(lin_by_name)})")
if lin_by_name["deb/App_0.0.0_amd64.deb"]["sig"] is not True:
    raise SystemExit("  mac/linux: co-located .sig not recorded as sig:true")
win_names = {a["name"] for a in win["artifacts"]}
if "App_0.0.0_x64-setup-1.bin" not in win_names:
    raise SystemExit(f"  windows: *-setup-*.bin slice not enumerated (got {sorted(win_names)})")
if next(a for a in win["artifacts"] if a["name"].endswith(".bin"))["sig"] is not False:
    raise SystemExit("  windows: sig-less .bin not recorded as sig:false")
print("  ✓ schema: base keys+types OK; windows adds exactly packedSrcFingerprint+signed; mac/linux adds none")
print("  ✓ WI-4243: subpath names, per-artifact sig recording, .bin slices enumerated")
PY

# ── Check 2: no leg re-forks the shared emitter ────────────────────────────
grep -q 'bin/emit-build-provenance.sh' "$RELEASE_LOCAL" \
  || fail "release-local.sh no longer calls bin/emit-build-provenance.sh (linux/mac leg re-forked?)"
grep -q 'emit-build-provenance.sh' "$WIN_BUILD" \
  || fail "build-windows-cross.sh no longer calls emit-build-provenance.sh (windows leg re-inlined its emitter?)"
pass "all three legs invoke bin/emit-build-provenance.sh"

# The old inline windows emitter was the ONLY place a raw packedSrcFingerprint
# JSON line was printf'd; its reappearance means a leg re-inlined an emitter.
if grep -Eq "printf[^\n]*packedSrcFingerprint" "$WIN_BUILD"; then
  fail "build-windows-cross.sh re-inlined a packedSrcFingerprint printf emitter — P-002 consolidation reverted"
fi
if grep -Eq 'printf[^\n]*"sha256"' "$RELEASE_LOCAL" "$WIN_BUILD"; then
  fail "a release leg re-inlined an artifact-sha256 printf emitter — provenance must delegate to emit-build-provenance.sh"
fi
pass "no leg re-inlines a provenance emitter"

# ── Check 3: centralized honest sha (P-003 single source of truth) ─────────
grep -q -- '-dirty"' "$RELEASE_LOCAL" \
  || fail "release-local.sh no longer carries the honest -dirty BUILD_SHA marker (P-003 single-source-of-truth reverted to a bare rev-parse?)"
pass "centralized honest BUILD_SHA (-dirty) derivation present (P-003)"

echo "PROVENANCE-PARITY OK — one emitter, one schema, no leg re-forked."
