#!/usr/bin/env bash
# common.sh — shared config + helpers for the Papercusp Linux clean-room test VM.
#
# Sourced by vmctl and boot-vm.sh. Versioned in the repo; the heavy disk images
# it points at live OUTSIDE the repo under ~/papercup-linux-test-vm (never
# committed). See plan linux-test-vm-and-federation-2026-06-04 (D-005).

set -euo pipefail

# ── Paths ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # scripts/linux-test-vm
DESKTOP_REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"                  # papercusp-desktop

VM_HOME="${PAPERCUSP_TESTVM_HOME:-$HOME/papercup-linux-test-vm}"
IMAGES_DIR="$VM_HOME/images"
RUN_DIR="$VM_HOME/run"
BASE_IMG="$IMAGES_DIR/ubuntu-24.04-base.img"
GOLDEN="$IMAGES_DIR/golden.qcow2"

SSH_KEY="${PAPERCUSP_TESTVM_SSH_KEY:-$HOME/.ssh/papercup-vm-linux}"

# ── Image / sizing ─────────────────────────────────────────────────────────
UBUNTU_IMG_URL="${PAPERCUSP_TESTVM_IMG_URL:-https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img}"
DISK_SIZE="${PAPERCUSP_TESTVM_DISK:-40G}"
VM_RAM_MB="${PAPERCUSP_TESTVM_RAM_MB:-16384}"
VM_CPUS="${PAPERCUSP_TESTVM_CPUS:-8}"
VM_USER="${PAPERCUSP_TESTVM_USER:-tester}"

# ── Per-instance port map ──────────────────────────────────────────────────
# Existing box VMs use SSH 2222/2223, SPICE 5930/5931 — we start past them.
# Returns "<ssh_port> <spice_port> <operator_fwd_port>" for an instance name.
ports_for() {
  local name="$1" idx
  case "$name" in
    clean) idx=0 ;;
    fed-a) idx=1 ;;
    fed-b) idx=2 ;;
    *)     idx=9 ;;   # ad-hoc instances share a high slot; override via env if needed
  esac
  echo "$((2224 + idx)) $((5932 + idx)) $((3072 + idx))"
}

# ── Per-instance file paths ────────────────────────────────────────────────
vm_rundir()  { echo "$RUN_DIR/$1"; }
vm_overlay() { echo "$RUN_DIR/$1/overlay.qcow2"; }
vm_seed()    { echo "$RUN_DIR/$1/seed.iso"; }
vm_monitor() { echo "$RUN_DIR/$1/qemu-monitor.sock"; }
vm_pidfile() { echo "$RUN_DIR/$1/qemu.pid"; }
vm_serial()  { echo "$RUN_DIR/$1/serial.log"; }

# ── Logging ────────────────────────────────────────────────────────────────
log()  { printf '\033[1;36m[testvm]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[testvm] WARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[testvm] FATAL:\033[0m %s\n' "$*" >&2; exit 1; }

# ── SSH helpers ────────────────────────────────────────────────────────────
# Host keys are intentionally not pinned: a fresh overlay re-presents golden's
# key, and reprovisioning rotates it — pinning would just cause MITM warnings on
# a throwaway loopback VM.
_ssh_opts() {
  echo "-i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
-o LogLevel=ERROR -o ConnectTimeout=10 -o ServerAliveInterval=15"
}

vm_ssh() {  # vm_ssh <name> [cmd...]
  local name="$1"; shift
  local ssh_port; ssh_port="$(ports_for "$name" | awk '{print $1}')"
  # shellcheck disable=SC2046
  ssh $(_ssh_opts) -p "$ssh_port" "$VM_USER@127.0.0.1" "$@"
}

vm_scp() {  # vm_scp <name> <local-src> <remote-dst>
  local name="$1" src="$2" dst="$3"
  local ssh_port; ssh_port="$(ports_for "$name" | awk '{print $1}')"
  # shellcheck disable=SC2046
  scp $(_ssh_opts) -P "$ssh_port" "$src" "$VM_USER@127.0.0.1:$dst"
}

vm_run() {  # vm_run <name>   — run a script supplied on stdin inside the VM
  local name="$1"
  local ssh_port; ssh_port="$(ports_for "$name" | awk '{print $1}')"
  # shellcheck disable=SC2046
  ssh $(_ssh_opts) -p "$ssh_port" "$VM_USER@127.0.0.1" 'bash -s'
}

wait_ssh() {  # wait_ssh <name> [timeout_sec]
  local name="$1" timeout="${2:-300}" waited=0
  log "waiting for SSH on $name (timeout ${timeout}s)…"
  while ! vm_ssh "$name" true 2>/dev/null; do
    sleep 5; waited=$((waited + 5))
    [ "$waited" -ge "$timeout" ] && return 1
  done
  log "SSH up on $name after ${waited}s"
}

# ── Process state ──────────────────────────────────────────────────────────
vm_pid() { local f; f="$(vm_pidfile "$1")"; [ -f "$f" ] && cat "$f" 2>/dev/null || true; }

vm_running() {  # vm_running <name>
  local pid; pid="$(vm_pid "$1")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Resolve the newest packaged .deb in the desktop bundle output.
default_deb() {
  ls -t "$DESKTOP_REPO"/src-tauri/target/release/bundle/deb/Papercusp_*_amd64.deb 2>/dev/null | head -1
}

require_golden() {
  [ -f "$GOLDEN" ] || die "golden image not found ($GOLDEN). Run: vmctl provision"
}
