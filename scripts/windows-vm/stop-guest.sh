#!/usr/bin/env bash
set -u

monitor_socket="${1:?usage: stop-guest.sh <qemu-monitor-socket>}"

if ! printf 'system_powerdown\n' | socat - "UNIX-CONNECT:${monitor_socket}"; then
  printf '[papercup-vm-win] QMP powerdown request failed; systemd will terminate QEMU.\n' >&2
  exit 0
fi

# systemd supplies MAINPID to ExecStop. It may be empty if QEMU already exited.
main_pid="${MAINPID:-}"
if [[ ! "$main_pid" =~ ^[1-9][0-9]*$ ]]; then
  exit 0
fi

# ExecStop must not return until QEMU exits: with KillMode=mixed, systemd sends
# SIGTERM as soon as ExecStop completes. TimeoutStopSec bounds this wait and lets
# systemd escalate only when the guest did not shut down in time.
while kill -0 "$main_pid" 2>/dev/null; do
  sleep 1
done
