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

# Guard the reset→up (and down→up) race + host port collisions: qemu treats a SPICE
# bind failure OR a hostfwd bind failure as FATAL — it exits and NO VM boots, so a
# `vmctl reset clean && vmctl up clean` silently produced a dead VM (WI-2902, seen
# 2026-07-06). Two distinct causes, two fixes:
port_free() { ! ss -Hltn 2>/dev/null | awk '{print $4}' | grep -q ":${1}\$"; }
wait_port_free() {  # bounded wait for a JUST-KILLED VM to release a port it still holds
  local port="$1" label="$2" i
  for i in $(seq 1 30); do
    port_free "$port" && return 0
    [ "$i" -eq 1 ] && log "port $port ($label) still held by a prior VM — waiting for release…"
    sleep 1
  done
  warn "port $port ($label) still in use after 30s — booting anyway (qemu may abort)"
}
# (1) SSH + SPICE must stay the deterministic per-instance values (vm_ssh / `vmctl gui`
#     look them up via ports_for); if held it's a just-killed VM that will free shortly.
wait_port_free "$SSH_PORT"   ssh
wait_port_free "$SPICE_PORT" spice
# (2) The operator hostfwd (host:$OP_PORT → guest:3070) is a CONVENIENCE for host-side
#     access only — the in-guest tests (vmctl verify: SSH + in-guest curl + qemu
#     screendump) never use it. On a busy host the op-fwd range (default base 3090,
#     EI-495 — moved off 3072 which sat in the green release operator's own
#     :3070/:3073 neighborhood) can still collide with LIVE host services — a
#     persistent holder a wait can't clear. So DROP just that one hostfwd rule when
#     its port is taken (the VM still boots) instead of letting qemu abort; set
#     VM_OP_BASE to a free base to reclaim it.
op_hostfwd=",hostfwd=tcp::${OP_PORT}-:3070"
if ! port_free "$OP_PORT"; then
  warn "op-fwd port $OP_PORT in use on host — booting WITHOUT the host→guest operator forward (set VM_OP_BASE to a free base to reclaim it; in-guest tests are unaffected)"
  op_hostfwd=""
fi

log "boot $NAME — ssh:$SSH_PORT spice:127.0.0.1:$SPICE_PORT op:${OP_PORT}${op_hostfwd:+ (fwd)} disk=$(basename "$DISK")"
# VM_VGA default virtio (was qxl until 2026-07-09): Ubuntu 24.04's qxl X DDX
# (xserver-xorg-video-qxl) segfaults Xorg in xf86ProbeOutputModes on any
# client RandR re-probe — tao/GTK monitor enumeration at Papercusp GUI
# startup crash-looped the whole X session (desktop-auto-update-operational
# -2026-07-09 P-006 investigation; Xorg.0.log.old backtrace: RRGetInfo →
# xf86ProbeOutputModes → xf86DuplicateMode SIGSEGV). virtio-vga uses the
# stable in-tree modesetting driver; spice still works. Set VM_VGA=qxl to
# reproduce the old behavior (or when a guest lacks virtio_gpu).
# ⚠ Keep comments OUTSIDE the qemu arg list: a comment line inside a
# backslash-continued command ENDS the continuation, silently truncating the
# args (this exact block, when placed mid-command, dropped -vga/-spice/
# -monitor/-serial/-display/-pidfile/-daemonize — no SPICE, no pidfile, qemu
# in the foreground; found 2026-07-10).
qemu-system-x86_64 \
  -name "papercusp-testvm-$NAME" \
  -enable-kvm -machine q35,accel=kvm -cpu host \
  -m "$VM_RAM_MB" -smp "$VM_CPUS" \
  -drive "if=virtio,format=qcow2,file=$DISK,cache=writeback,discard=unmap" \
  "${seed_args[@]}" \
  -netdev "user,id=net0,net=${SLIRP_NET:-10.0.2.0/24},hostfwd=tcp::${SSH_PORT}-:22${op_hostfwd}" \
  -device virtio-net-pci,netdev=net0 \
  "${fed_nic[@]}" \
  -vga "${VM_VGA:-virtio}" -spice "port=${SPICE_PORT},addr=127.0.0.1,disable-ticketing=on" \
  -device virtio-serial-pci \
  -chardev spicevmc,id=spicechannel0,name=vdagent \
  -device virtserialport,chardev=spicechannel0,name=com.redhat.spice.0 \
  -monitor "unix:$(vm_monitor "$NAME"),server,nowait" \
  -serial "file:$(vm_serial "$NAME")" \
  -display none \
  -pidfile "$(vm_pidfile "$NAME")" \
  -daemonize

log "$NAME booted (pid $(vm_pid "$NAME")). serial → $(vm_serial "$NAME")"
