#!/bin/sh
# linux-chat-dock-parity-2026-06-27 — auto-provision the chat dock's host terminal.
#
# The desktop chat dock runs `pui chat` inside ghostty (a GPU terminal). ghostty is
# NOT in Ubuntu's apt (it ships from a maintainer PPA) and is impractical to bundle
# (~108 shared-lib deps + a resource dir). So on install we add the PPA and install
# ghostty for the user — otherwise the dock pane is blank (the symptom that started
# this).
#
# A postinst CANNOT call apt directly: dpkg holds the apt/dpkg lock for the duration
# of THIS transaction, so an in-postinst `apt-get install` would deadlock. We instead
# DEFER everything to a detached worker that waits for the lock to free, then sets up
# the PPA + installs ghostty. Every step is guarded (`|| true`) so a failure (offline,
# missing tooling, no PPA access) can NEVER fail the package install — the app still
# works; only the chat dock needs ghostty.
set -e

# Only on a real install/upgrade configure (not abort-remove etc.).
[ "$1" = "configure" ] || exit 0
# Already present (or a re-install) → nothing to do.
command -v ghostty >/dev/null 2>&1 && exit 0

# Detached, lock-waiting, best-effort provisioner. Runs AFTER this dpkg transaction
# releases the apt lock; never blocks or fails the install.
setsid sh -c '
  # Wait up to ~3 min for the current dpkg/apt transaction to release the lock.
  i=0
  while [ "$i" -lt 90 ]; do
    command -v fuser >/dev/null 2>&1 || break
    fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break
    i=$((i + 1)); sleep 2
  done
  export DEBIAN_FRONTEND=noninteractive
  # add-apt-repository lives in software-properties-common; pull it if missing.
  command -v add-apt-repository >/dev/null 2>&1 || \
    apt-get install -y software-properties-common >/dev/null 2>&1 || true
  add-apt-repository -y ppa:mkasberg/ghostty-ubuntu >/dev/null 2>&1 || true
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y ghostty >/dev/null 2>&1 || true
' </dev/null >/dev/null 2>&1 &

exit 0
