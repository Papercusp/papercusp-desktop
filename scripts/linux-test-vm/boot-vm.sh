#!/usr/bin/env bash
# boot-vm.sh — launch one Papercusp test VM under qemu/KVM (headless, daemonized).
#
# Usage:  boot-vm.sh <name>
# Env:
#   BOOT_DISK   disk image to boot        (default: the instance's overlay.qcow2)
#   BOOT_SEED   cloud-init seed.iso       (default: none — only used at provision)
#   FED_NIC     extra `-netdev … -device …` args for a 2nd NIC (Phase 2 bridge)
#   SLIRP_NET   user-net subnet for NIC 1 (default 10.0.2.0/24). Federation runs
#               give each VM a DISTINCT subnet: with the default, every VM is
#               10.0.2.15, and hyperswarm holepunching exchanges local-address
#               candidates — a peer dialing another's 10.0.2.15 reaches ITSELF.
#
# Matches the box convention (raw qemu, slirp hostfwd for SSH, SPICE for display)
# used by the Mac/Windows build VMs. See build-system/vms.md.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

NAME="${1:?usage: boot-vm.sh <name>}"
read -r SSH_PORT SPICE_PORT OP_PORT <<<"$(ports_for "$NAME")"

RUNDIR="$(vm_rundir "$NAME")"; mkdir -p "$RUNDIR"
DISK="${BOOT_DISK:-$(vm_overlay "$NAME")}"
[ -f "$DISK" ] || die "boot disk not found: $DISK"

if vm_running "$NAME"; then
  log "$NAME already running (pid $(vm_pid "$NAME")) — nothing to do"; exit 0
fi
rm -f "$(vm_monitor "$NAME")" "$(vm_pidfile "$NAME")"

seed_args=()
[ -n "${BOOT_SEED:-}" ] && seed_args=(-drive "if=virtio,format=raw,file=$BOOT_SEED,readonly=on")

# shellcheck disable=SC2206
fed_nic=( ${FED_NIC:-} )

log "boot $NAME — ssh:$SSH_PORT spice:127.0.0.1:$SPICE_PORT op:$OP_PORT disk=$(basename "$DISK")"
qemu-system-x86_64 \
  -name "papercusp-testvm-$NAME" \
  -enable-kvm -machine q35,accel=kvm -cpu host \
  -m "$VM_RAM_MB" -smp "$VM_CPUS" \
  -drive "if=virtio,format=qcow2,file=$DISK,cache=writeback,discard=unmap" \
  "${seed_args[@]}" \
  -netdev "user,id=net0,net=${SLIRP_NET:-10.0.2.0/24},hostfwd=tcp::${SSH_PORT}-:22,hostfwd=tcp::${OP_PORT}-:3070" \
  -device virtio-net-pci,netdev=net0 \
  "${fed_nic[@]}" \
  -vga "${VM_VGA:-qxl}" -spice "port=${SPICE_PORT},addr=127.0.0.1,disable-ticketing=on" \
  -device virtio-serial-pci \
  -chardev spicevmc,id=spicechannel0,name=vdagent \
  -device virtserialport,chardev=spicechannel0,name=com.redhat.spice.0 \
  -monitor "unix:$(vm_monitor "$NAME"),server,nowait" \
  -serial "file:$(vm_serial "$NAME")" \
  -display none \
  -pidfile "$(vm_pidfile "$NAME")" \
  -daemonize

log "$NAME booted (pid $(vm_pid "$NAME")). serial → $(vm_serial "$NAME")"
