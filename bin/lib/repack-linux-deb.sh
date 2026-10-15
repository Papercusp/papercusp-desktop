# shellcheck shell=bash
# Repack one Linux .deb for release, shedding a seeded Server's offline pot seed first.
#
# p2p-public-release-endgame-2026-09-01#D-236 (WI-6554700010012560): a Debian package is an
# ar archive whose member size field holds 10 digits, so no member may exceed 9,999,999,999
# bytes. The seeded dogfood Server's data member was 11,290,740,252 bytes even under xz -9
# (WI-6554700010012467), so a Server package whose md5sums lists files under the seed root
# is split into itself (seedless) plus `papercusp-server-seed_<ver>_all.deb` beside it, and
# BOTH then go through repack-deb-xz.sh (dedupe, xz -9, scrub check, updater signature).
# The decision reads only the control member, so it also works on an over-cap package.
#
# Every producer that repacks a Linux .deb calls this instead of repack-deb-xz.sh directly:
# build-linux-local.sh (dogfood sweep) and release-local.sh (x86_64 and arm64 legs).
#
#   papercusp_repack_linux_deb <package.deb> [repack-helper]
#
# repack-helper defaults to the repack-deb-xz.sh beside this library; release-local.sh passes
# the one in the tree it is building. The splitter always comes from beside this library.
_PAPERCUSP_LINUX_DEB_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

papercusp_repack_linux_deb() {
  local deb="$1" repack="${2:-$_PAPERCUSP_LINUX_DEB_BIN/repack-deb-xz.sh}"
  local splitter="$_PAPERCUSP_LINUX_DEB_BIN/split-server-seed-deb.py"
  local identity package _version _arch seed_files split_out seed_deb
  if ! identity="$(python3 -I "$splitter" info "$deb")"; then
    # Not a readable Debian package: the repack helper is the validating chokepoint and
    # names the failure itself, so hand it over unsplit instead of failing differently here.
    echo "WARN: could not read the package identity of $deb; repacking it unsplit" >&2
    bash "$repack" "$deb"
    return
  fi
  IFS=$'\t' read -r package _version _arch seed_files <<<"$identity"
  if [[ "$package" == papercusp-server && "${seed_files:-0}" != 0 ]]; then
    echo "==> $deb carries the offline pot seed ($seed_files files): splitting it into a companion package (D-236)"
    split_out="$(python3 -I "$splitter" split "$deb" --in-place)" || return 1
    seed_deb="$(awk -F'\t' '$1 == "seed" { print $2 }' <<<"$split_out")"
    [[ -n "$seed_deb" && -f "$seed_deb" ]] || {
      echo "ERROR: the seed split of $deb reported no seed package" >&2
      return 1
    }
    # Control-only preflight is cheap and catches a D-236 contract mismatch before
    # the multi-hour xz repack. The splitter also checks before publishing either .deb.
    python3 -I "$splitter" verify-control "$deb" "$seed_deb" || return 1
    bash "$repack" "$seed_deb" || return 1
  fi
  bash "$repack" "$deb"
}
