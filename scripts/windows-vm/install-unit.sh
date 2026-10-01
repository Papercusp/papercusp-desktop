#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
vm_dir="${PAPERCUP_VM_DIRECTORY:-${HOME:?HOME must be set}/windows-vm}"
unit_dir="${PAPERCUP_VM_UNIT_DIRECTORY:-${XDG_CONFIG_HOME:-${HOME:?HOME must be set}/.config}/systemd/user}"

if [[ ! -x "$vm_dir/launch-install.sh" ]]; then
  printf 'Windows VM launcher is missing or not executable: %s/launch-install.sh\n' "$vm_dir" >&2
  exit 1
fi

install -D -m 0755 "$script_dir/stop-guest.sh" "$vm_dir/stop-guest.sh"
install -D -m 0644 "$script_dir/papercup-vm-win.service" "$unit_dir/papercup-vm-win.service"

# Reload unit definitions only. Deliberately do not start, stop, or restart the VM.
systemctl --user daemon-reload
printf 'Installed papercup-vm-win.service and stop helper; systemd definitions reloaded.\n'
