#!/usr/bin/env bash
# Windows 11 Enterprise LTSC 2024 eval — unattended install into windows_hdd.qcow2
# Rebuild of the VM destroyed 2026-08-15 (WI-39356). Bytes live on /mnt/data by
# leader directive; ~/windows-vm is a symlink here so tooling paths still resolve.
set -euo pipefail
cd /mnt/data/offload/windows-vm

# ── EI-20628234494945904: NEVER let this rig inherit the caller's cgroup ────────
# On 2026-08-16T21:41:30Z an automated host-recycle SIGKILLed papercup-dev-api
# and systemd tore down its cgroup, taking this VM (pid 857148, 11.25 GB) with
# it. It was in that cgroup because this script used to end in a bare
# `exec qemu-system-x86_64` — so qemu became a direct child of whichever agent
# session ran it and inherited that session's cgroup.
#
# That inheritance is INVISIBLE and NON-DETERMINISTIC: a desktop psu session sits
# in app-org.gnome.Terminal.slice/vte-spawn-*.scope (such a launch survives),
# while a headless/operator-spawned session sits inside papercup-dev-api.service
# (such a launch dies on the next recycle). Same script, same command, opposite
# outcome depending on who ran it — which is why this guard lives in the LAUNCH
# and not in a "remember to…" note. A warning cannot bind an automated actor.
#
# Preferred way to run the rig:  systemctl --user start papercup-vm-win.service
# This guard is the backstop for a hand-run: re-exec into a transient unit so the
# VM lands in its own cgroup no matter who invoked us. systemd sets INVOCATION_ID
# for units, so a start via the .service above skips this and never loops.
if [ -z "${INVOCATION_ID:-}" ] && [ "${PAPERCUSP_VM_UNCONFINED:-0}" != "1" ]; then
  echo "[launch-install] not under systemd — re-launching into an isolated cgroup" >&2
  if systemd-run --user \
       --unit=papercup-vm-win-adhoc \
       --description="Papercusp Windows rig (ad-hoc launch, auto-confined)" \
       --collect --same-dir \
       --property=KillMode=mixed \
       -- "$0" "$@"; then
    echo "[launch-install] started as papercup-vm-win-adhoc.service" >&2
    echo "[launch-install]   logs: journalctl --user -u papercup-vm-win-adhoc -f" >&2
    echo "[launch-install]   stop: systemctl --user stop papercup-vm-win-adhoc" >&2
    exit 0
  fi
  # Mirrors systemd-scope.ts's SCOPE_LAUNCH_FAILURE_RE policy: if the SCOPE cannot
  # start (no bus, no binary, no permission), run the payload DIRECT rather than
  # refusing to boot the rig — but say so loudly, because the VM is now mortal.
  echo "[launch-install] WARNING: systemd-run failed — running UNCONFINED." >&2
  echo "[launch-install] WARNING: this VM will die with its launcher's cgroup." >&2
fi
# ───────────────────────────────────────────────────────────────────────────────

# software TPM 2.0 — Windows 11 requires it; swtpm provides it without host TPM
# NOTE: swtpm is AppArmor-confined (/etc/apparmor.d/usr.bin.swtpm) and CANNOT open a
# socket under /mnt/data. TPM state is only KB, so it lives in $HOME while the 300G
# disk image stays on /mnt/data per the leader directive.
TPMDIR="${HOME:?HOME must be set}/.swtpm-papercusp-win"
TPMSOCK="$TPMDIR/swtpm-sock"
mkdir -p "$TPMDIR"

tpm_socket_listening() {
  [ -S "$TPMSOCK" ] && ss -xlH | grep -Fq -- "$TPMSOCK"
}

# A crashed swtpm leaves its socket inode behind. Testing only `-S` mistakes that
# dead pathname for a live TPM, so QEMU immediately fails with ECONNREFUSED and
# systemd restart-loops forever. Reconcile the pathname with the kernel listener
# before every boot, then refuse explicitly if the replacement daemon never binds.
if ! tpm_socket_listening; then
  rm -f "$TPMSOCK"
  swtpm socket --tpmstate dir="$TPMDIR" --ctrl type=unixio,path="$TPMSOCK" \
    --tpm2 --daemon --log level=0
fi

for _ in 1 2 3 4 5; do
  tpm_socket_listening && break
  sleep 1
done
tpm_socket_listening || {
  echo "[launch-install] FATAL: swtpm did not bind $TPMSOCK" >&2
  exit 1
}

# DISPLAY TRANSPORTS — read before touching the two -spice/-vnc lines below.
#
# WI-1716951 (2026-08-31): this file began life as an unattended-INSTALL harness
# (siblings drive-0017.sh / keypress-loop.sh / watch-guest.sh), where VNC was the
# automation transport, so it carried only `-vnc 127.0.0.1:9`. On 2026-08-20 it was
# promoted to the PERMANENT rig behind papercup-vm-win.service — and the documented
# SPICE :5931 (internal/docs/build-system/vms.md:11,164) silently died with the
# promotion. Nothing failed loudly: the VM booted, SSH worked, only the owner-facing
# viewer transport was gone. An agent then verified the live rig and recorded
# "VNC 5909, NOT SPICE 5931" as a durable memory (2713b596), so every later agent
# was faithfully steered to the regressed transport. The owner sees the symptom as
# "why did you open TigerVNC" — the cause is right here.
#
# BOTH transports are served concurrently, on purpose:
#   -spice 5931  — the owner-facing viewer. `remote-viewer spice://127.0.0.1:5931`.
#   -vnc   5909  — kept so the install/automation tooling above keeps working.
# `-display none` suppresses only a LOCAL qemu window; it does not disable either
# server. Neither line changes guest-visible hardware, so this is safe to land while
# the guest is installed and running.
#
# Wanted: `-vga qxl` for dynamic resolution + a virtio-serial vdagent channel for
# clipboard. Deliberately NOT enabled here — both change the guest's device tree and
# need in-guest drivers; do that as its own change with the guest available to test.
#
# ⚠ NEVER put a comment INSIDE the backslash-continued arg list below. A comment line
# terminates the continuation, so qemu silently launches with every later arg DROPPED
# — valid syntax, `bash -n` clean, and the exact way -spice/-monitor/-display were
# lost from the linux-test-vm rig on 2026-07-09 (memory 53dba680).
# EI-22689667926628326: memory-residency experiment, not yet release acceptance.
# The Hyper-V IPI-timeout rig had guest memory swapped out and continuing major
# faults in its vCPU threads. Keep CPU features unchanged while testing QEMU's
# existing memory-lock option; verify VmLck/VmSwap on the actual new process.
exec qemu-system-x86_64 \
  -name papercusp-win11 \
  -machine q35,smm=on,accel=kvm \
  -cpu host \
  -smp 8 -m 16384 \
  -overcommit mem-lock=on \
  -global driver=cfi.pflash01,property=secure,value=on \
  -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.ms.fd \
  -drive if=pflash,format=raw,unit=1,file="$PWD/OVMF_VARS.fd" \
  -chardev socket,id=chrtpm,path="$TPMSOCK" \
  -tpmdev emulator,id=tpm0,chardev=chrtpm \
  -device tpm-tis,tpmdev=tpm0 \
  -drive file="$PWD/windows_hdd.qcow2",if=none,id=hd0,format=qcow2,cache=writeback \
  -device ich9-ahci,id=ahci \
  -device ide-hd,drive=hd0,bus=ahci.0 \
  -drive file="$PWD/win11-ltsc-eval.iso",if=none,id=cd0,media=cdrom,readonly=on \
  -device ide-cd,drive=cd0,bus=ahci.1 \
  -drive file="$PWD/seed.iso",if=none,id=cd1,media=cdrom,readonly=on \
  -device ide-cd,drive=cd1,bus=ahci.2 \
  -netdev user,id=net0,hostfwd=tcp::2223-:22 \
  -device e1000e,netdev=net0 \
  -monitor unix:"$PWD/qemu-monitor.sock",server,nowait \
  -spice port=5931,addr=127.0.0.1,disable-ticketing=on \
  -vnc 127.0.0.1:9 \
  -display none \
  -boot order=dc
