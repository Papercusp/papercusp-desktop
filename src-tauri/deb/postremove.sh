#!/bin/sh
# Remove the psu/ptool launchers the postinst wrote to /usr/bin (they are NOT
# dpkg-tracked files, so dpkg won't reap them on its own). ghostty is left
# installed — it's a normal apt package the user may want independently.
set -e

# The GUI inherits this maintainer script from the base Tauri config, but the
# manual launchers and tutorial entry are Server-owned. Removing or purging the
# GUI must be a no-op here so it cannot corrupt a still-installed Server.
[ "${DPKG_MAINTSCRIPT_PACKAGE:-}" = "papercusp-server" ] || exit 0

# Match dh_installsystemduser's purge semantics for the Server-only user unit.
# `remove` intentionally preserves the administrator's enable/disable choice so
# a later reinstall restores it; `purge` removes the helper state and global
# graphical-session.target.wants link. The package-name gate matters because
# this postrm is shared with the independently installed GUI product.
if [ "$1" = "purge" ] \
  && [ -z "${DPKG_ROOT:-}" ] \
  && command -v deb-systemd-helper >/dev/null 2>&1; then
  deb-systemd-helper --user purge papercusp-server.service >/dev/null || true
fi

case "$1" in
  remove|purge)
    rm -f /usr/bin/psu /usr/bin/ptool /usr/bin/papercusp
    rm -f /usr/share/applications/papercusp-tutorial.desktop
    command -v update-desktop-database >/dev/null 2>&1 && \
      update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
    ;;
esac
exit 0
