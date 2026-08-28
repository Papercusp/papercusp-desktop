#!/bin/bash
# Papercusp Server — install the macOS LaunchDaemon (WI-475896).
#
# Makes the Server peer start at boot with NO login of any kind, which the
# shipped LaunchAgent cannot do: an agent lives in launchd's gui/<uid> domain,
# and that domain does not exist while the Mac sits at the login window. This is
# the macOS counterpart of the Linux deb postinstall enabling
# papercusp-server.service for the user manager.
#
#   sudo ./install-launchdaemon.sh                 # install for the invoking user
#   sudo ./install-launchdaemon.sh --user alice    # install for a named account
#   sudo ./install-launchdaemon.sh --uninstall     # remove it
#
# Idempotent: re-running replaces the plist and re-bootstraps cleanly.

set -euo pipefail

LABEL="com.papercusp.server"
PLIST_DEST="/Library/LaunchDaemons/${LABEL}.plist"
APP_ROOT="/Applications/Papercusp Server.app"
BINARY="${APP_ROOT}/Contents/MacOS/papercusp-server"
SIDECAR_DIR="${APP_ROOT}/Contents/Resources/sidecar"
TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${LABEL}.plist.template"

SERVICE_USER=""
MODE="install"

while [ $# -gt 0 ]; do
  case "$1" in
    --user) SERVICE_USER="${2:?--user needs an account name}"; shift 2 ;;
    --uninstall) MODE="uninstall"; shift ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "FATAL: this installer is macOS-only; Linux uses papercusp-server.service" >&2
  exit 2
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "FATAL: a LaunchDaemon lives in the system domain — re-run with sudo" >&2
  exit 2
fi

# `launchctl bootout` exits non-zero when the label is not loaded, which is the
# normal first-install case. Never let that abort the script.
unload_if_present() {
  launchctl bootout "system/${LABEL}" 2>/dev/null || true
}

if [ "$MODE" = "uninstall" ]; then
  unload_if_present
  rm -f "$PLIST_DEST"
  echo "removed ${LABEL}"
  exit 0
fi

# Resolve the account that owns the Papercusp state tree. Running the daemon as
# root would create a root-owned state tree the desktop app can no longer read.
if [ -z "$SERVICE_USER" ]; then
  SERVICE_USER="${SUDO_USER:-}"
fi
if [ -z "$SERVICE_USER" ] || [ "$SERVICE_USER" = "root" ]; then
  echo "FATAL: could not determine a non-root service account — pass --user <account>" >&2
  exit 2
fi

SERVICE_HOME="$(dscl . -read "/Users/${SERVICE_USER}" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
if [ -z "$SERVICE_HOME" ] || [ ! -d "$SERVICE_HOME" ]; then
  echo "FATAL: no home directory for '${SERVICE_USER}' — is that account real?" >&2
  exit 2
fi

[ -x "$BINARY" ] || { echo "FATAL: ${BINARY} is missing or not executable — install Papercusp Server first" >&2; exit 1; }
[ -d "$SIDECAR_DIR" ] || { echo "FATAL: ${SIDECAR_DIR} is missing — the app bundle is incomplete" >&2; exit 1; }
[ -f "$TEMPLATE" ] || { echo "FATAL: ${TEMPLATE} is missing" >&2; exit 1; }

# The LaunchAgent and this daemon both start the Server. Leaving both armed
# double-launches on the next GUI login; the singleton guard would close one,
# but only after two embedded-Postgres boots race for the same state tree.
AGENT_PLIST="${SERVICE_HOME}/Library/LaunchAgents/${LABEL}.plist"
if [ -f "$AGENT_PLIST" ]; then
  SERVICE_UID="$(id -u "$SERVICE_USER")"
  launchctl bootout "gui/${SERVICE_UID}/${LABEL}" 2>/dev/null || true
  mv "$AGENT_PLIST" "${AGENT_PLIST}.superseded-by-launchdaemon"
  echo "note: retired the login-scoped LaunchAgent (kept as ${AGENT_PLIST}.superseded-by-launchdaemon)"
fi

TMP_PLIST="$(mktemp -t papercusp-server-plist)"
trap 'rm -f "$TMP_PLIST"' EXIT

# Substitute via a bash replacement rather than sed so a home directory
# containing '/' or '&' cannot corrupt the output.
template_body="$(cat "$TEMPLATE")"
template_body="${template_body//__PAPERCUSP_SERVICE_USER__/$SERVICE_USER}"
template_body="${template_body//__PAPERCUSP_SERVICE_HOME__/$SERVICE_HOME}"
printf '%s\n' "$template_body" > "$TMP_PLIST"

if ! plutil -lint "$TMP_PLIST" >/dev/null; then
  echo "FATAL: rendered plist is not valid — refusing to install" >&2
  exit 1
fi
# A leftover placeholder means the template gained a token this script does not
# substitute. Installing that yields a daemon pointing at a literal path.
if grep -q '__PAPERCUSP_' "$TMP_PLIST"; then
  echo "FATAL: unsubstituted placeholder remains in the rendered plist" >&2
  grep -n '__PAPERCUSP_' "$TMP_PLIST" >&2
  exit 1
fi

unload_if_present
install -m 644 -o root -g wheel "$TMP_PLIST" "$PLIST_DEST"
launchctl bootstrap system "$PLIST_DEST"
launchctl enable "system/${LABEL}"

echo "installed ${PLIST_DEST} (user=${SERVICE_USER} home=${SERVICE_HOME})"
echo
launchctl print "system/${LABEL}" | sed -n '1,12p'
echo
echo "It now starts at boot with no login. Verify across a reboot with:"
echo "  launchctl print system/${LABEL} | grep -E 'state|pid'"
echo "  log show --predicate 'process == \"papercusp-server\"' --last 10m"
