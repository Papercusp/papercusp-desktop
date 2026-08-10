#!/usr/bin/env bash
# rust-path-remap.selftest.sh — regression test for the 2026-08-10 AppImage
# identity-gate failure (EI-20075266271803900's rebuild leg).
#
# THE BUG THIS GUARDS
# -------------------
# The `--remap-path-prefix` flag that strips the build box's $HOME out of a
# shipped Rust binary's embedded source paths lived as an inline `export` in the
# CALLERS (release-local.sh, mac-vm-build.sh, build-mac-cross.sh), and
# build-appimage.sh deliberately owned no copy — it inherited RUSTFLAGS from
# release-local.sh as a child process. So the SAME script produced a shippable
# binary under a release cut and a LEAKY one when run directly (measured: 691
# build-box-$HOME strings vs 0), failing the identity gate ~10 min into the
# build with a message that points at the sidecar, not at the missing flag.
#
# The two properties that fix stays fixed by, and that this test pins:
#
#   1. EVERY script that compiles a shipped Rust binary sets the remap itself,
#      so shippability does not depend on which entry point was used. Asserted
#      structurally (does the script wire up the shared lib?) — a new build
#      script that forgets it fails here rather than at the release gate.
#   2. The helper is IDEMPOTENT. A child that already inherited a remapped
#      RUSTFLAGS must not append a second copy: a differing RUSTFLAGS string is
#      a distinct cargo fingerprint, so a double-append silently busts the
#      incremental cache and forces a full rebuild. This is the property that
#      makes it safe to source everywhere, so it is the one most worth pinning.
#
# Pure-local: sources the real lib in a subshell with a synthetic $HOME and
# inspects the RUSTFLAGS it exports. No cargo, no network, no build. <1s.
#
#   bash bin/lib/rust-path-remap.selftest.sh   # exit 0 = PASS, 1 = FAIL
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$DIR/rust-path-remap.sh"
[ -f "$LIB" ] || { echo "FAIL: $LIB not found"; exit 1; }

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

# Run the helper in a subshell under a controlled env, echo resulting RUSTFLAGS.
remap_under() { # $1=HOME  $2=preset RUSTFLAGS  $3=CARGO_HOME (optional)
  (
    export HOME="$1"
    if [ -n "${2:-}" ]; then export RUSTFLAGS="$2"; else unset RUSTFLAGS; fi
    if [ -n "${3:-}" ]; then export CARGO_HOME="$3"; else unset CARGO_HOME; fi
    # shellcheck disable=SC1090
    . "$LIB" || exit 9
    papercusp_export_rust_path_remap || exit 9
    printf '%s' "${RUSTFLAGS:-}"
  )
}

echo "rust-path-remap.selftest"

# 1. From a clean env it remaps $HOME.
OUT="$(remap_under /home/buildbot '' '')"
case "$OUT" in
  *"--remap-path-prefix=/home/buildbot=/build-home"*) ok "remaps \$HOME from a clean env" ;;
  *) bad "clean env did not remap \$HOME (got: $OUT)" ;;
esac

# 2. CARGO_HOME defaults under $HOME, and an explicitly relocated one is honored.
case "$OUT" in
  *"--remap-path-prefix=/home/buildbot/.cargo=/build-cargo"*) ok "defaults CARGO_HOME to \$HOME/.cargo" ;;
  *) bad "did not remap the default CARGO_HOME (got: $OUT)" ;;
esac
OUT_CH="$(remap_under /home/buildbot '' /mnt/data/cargo)"
case "$OUT_CH" in
  *"--remap-path-prefix=/mnt/data/cargo=/build-cargo"*) ok "honors a relocated CARGO_HOME" ;;
  *) bad "ignored relocated CARGO_HOME (got: $OUT_CH)" ;;
esac

# 3. IDEMPOTENT — the cache-busting property. Sourcing under an already-remapped
#    RUSTFLAGS (the release-cut parent→child case) must change nothing at all.
PRESET="-C target-cpu=native --remap-path-prefix=/home/other=/build-home"
OUT_IDEM="$(remap_under /home/buildbot "$PRESET" '')"
if [ "$OUT_IDEM" = "$PRESET" ]; then
  ok "idempotent: inherited remap left byte-identical (no cargo cache bust)"
else
  bad "appended a second remap onto an inherited one (got: $OUT_IDEM)"
fi

# 4. Pre-existing unrelated RUSTFLAGS are PRESERVED, not clobbered.
OUT_KEEP="$(remap_under /home/buildbot '-C target-cpu=native' '')"
case "$OUT_KEEP" in
  *"-C target-cpu=native"*)
    case "$OUT_KEEP" in
      *"--remap-path-prefix=/home/buildbot=/build-home"*) ok "preserves unrelated RUSTFLAGS while adding the remap" ;;
      *) bad "kept unrelated flags but did not add the remap (got: $OUT_KEEP)" ;;
    esac ;;
  *) bad "clobbered pre-existing RUSTFLAGS (got: $OUT_KEEP)" ;;
esac

# 5. THE STRUCTURAL GUARD — every script that compiles a shipped Rust binary
#    must set the remap itself rather than trust an ambient export. A new build
#    script that forgets it fails HERE, in <1s, instead of at the identity gate
#    ~10 min into a real build (or, worse, shipping a leaky artifact).
#
#    Accepts EITHER wiring: sourcing this lib (preferred), or a self-contained
#    inline `--remap-path-prefix` export (what the mac legs still carry). The
#    point is that the script does not depend on a caller.
for SCRIPT in build-appimage.sh release-local.sh mac-vm-build.sh build-mac-cross.sh; do
  P="$DIR/../$SCRIPT"
  if [ ! -f "$P" ]; then
    bad "$SCRIPT missing — update this list if it was renamed/removed"
    continue
  fi
  if grep -q 'papercusp_export_rust_path_remap' "$P"; then
    ok "$SCRIPT sources the shared remap lib"
  elif grep -q -- '--remap-path-prefix' "$P"; then
    ok "$SCRIPT carries its own inline remap export"
  else
    bad "$SCRIPT compiles a shipped binary but sets NO path remap — it would inherit one only by luck (see lib/rust-path-remap.sh)"
  fi
done

if [ "$FAILS" -eq 0 ]; then echo "PASS"; exit 0; fi
echo "FAIL ($FAILS)"; exit 1
