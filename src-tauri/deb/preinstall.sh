#!/bin/sh
# Stop the running Papercusp Server user unit before dpkg unpacks its
# replacement (EI-27105381385516766).
#
# On upgrade dpkg runs the OLD package's prerm, then THIS (the new package's)
# preinst, then unpacks. Releases through 0.0.31 shipped a prerm that, on
# upgrade, killed the Server process tree directly but left the package-owned
# unit running. systemd recorded the kill as a crash, and Restart=on-failure
# relaunched the Server every five seconds while dpkg was mid-unpack. The
# half-unpacked tree's serve.mjs refuses to start beside *.dpkg-new files (the
# immutable runtime policy), so the unit exhausted StartLimitBurst and was left
# dead (start-limit-hit) after the upgrade completed. This preinst is the only
# script of the NEW package that runs before unpack, so it is the only place a
# fix can reach an upgrade FROM an already-shipped release.
#
# An explicit stop leaves the unit inactive, and systemd never auto-restarts a
# unit stopped on request, so nothing starts against the half-unpacked tree.
# postinst (configure) clears any failed state and restarts the unit for every
# live user manager where it is enabled.
set -u

# Both Tauri products inherit the base maintainer scripts. Only the Server
# owns the user unit.
[ "${DPKG_MAINTSCRIPT_PACKAGE:-}" = "papercusp-server" ] || exit 0

case "${1:-}" in
  upgrade) ;;
  *) exit 0 ;;
esac

SERVER_USER_UNIT=papercusp-server.service
if [ -z "${DPKG_ROOT:-}" ] \
  && command -v deb-systemd-invoke >/dev/null 2>&1; then
  deb-systemd-invoke --user stop "$SERVER_USER_UNIT" >/dev/null || true
fi

exit 0
