#!/bin/sh
# Remove the psu/ptool launchers the postinst wrote to /usr/bin (they are NOT
# dpkg-tracked files, so dpkg won't reap them on its own). ghostty is left
# installed — it's a normal apt package the user may want independently.
set -e
case "$1" in
  remove|purge)
    rm -f /usr/bin/psu /usr/bin/ptool /usr/bin/papercusp
    rm -f /usr/share/applications/papercusp-tutorial.desktop
    command -v update-desktop-database >/dev/null 2>&1 && \
      update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
    ;;
esac
exit 0
