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
# Bases are env-overridable (VM_SSH_BASE / VM_SPICE_BASE / VM_OP_BASE) — set
# VM_OP_BASE to move the whole op-forward range if it ever collides with a live
# host listener again. (EI-495: the default base USED to be 3072, which put
# fed-a's op-forward at 3073 — exactly the green release operator's secondary
# listener (the operator binds BOTH :3070 and :3073). That FATAL'd every
# `vm-federation.sh --vms=1` run while the green operator was up. Moved the
# default base to 3090+, clear of the operator's :3070/:3073 neighborhood and
# staging's :3170, so this collision can't recur by default.)
ports_for() {
  local name="$1" idx
  case "$name" in
    clean) idx=0 ;;
    fed-a) idx=1 ;;
    fed-b) idx=2 ;;
    updater) idx=3 ;;
    *)     idx=9 ;;   # ad-hoc instances share a high slot; override via env if needed
  esac
  echo "$(( ${VM_SSH_BASE:-2224} + idx )) $(( ${VM_SPICE_BASE:-5932} + idx )) $(( ${VM_OP_BASE:-3090} + idx ))"
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

vm_run() {  # vm_run <name> [VAR=VALUE ...]  — run a script supplied on stdin inside the VM
  # ⚠ THIS FUNCTION FORWARDS NO ENVIRONMENT. The script arrives on the guest's
  # stdin for `bash -s`, and _ssh_opts sets no SendEnv/SetEnv, so the shell-prefix
  # form does NOT work and fails SILENTLY:
  #
  #     WIPE=0 vm_run "$name" <<'EOF'      # ✗ guest sees WIPE UNSET
  #
  # That sets the variable only in the LOCAL ssh process. It cost WI-6176: the
  # federation driver's entire preserve-the-data-dir boot-retry was inert for its
  # whole life because `${WIPE:-1}` defaulted to 1 in the guest on every relaunch,
  # while the log line printed from the same guest affirmatively claimed otherwise.
  #
  # Pass guest environment as VAR=VALUE ARGUMENTS instead — they are prepended to
  # the script stream as real assignments, so the guest genuinely sees them:
  #
  #     vm_run "$name" "WIPE=$wipe" <<'EOF'   # ✓
  #
  local name="$1"; shift
  local ssh_port; ssh_port="$(ports_for "$name" | awk '{print $1}')"
  local pre="" kv
  for kv in "$@"; do
    case "$kv" in
      [A-Za-z_]*=*) pre+="$(printf '%s=%q\n' "${kv%%=*}" "${kv#*=}")"$'\n' ;;
      *) echo "vm_run: ignoring non-assignment argument '$kv' (expected VAR=VALUE)" >&2 ;;
    esac
  done
  # shellcheck disable=SC2046
  { printf '%s' "$pre"; cat; } | ssh $(_ssh_opts) -p "$ssh_port" "$VM_USER@127.0.0.1" 'bash -s'
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
# Two path/name generations (2026-07-03, P-002 shared-hive-p2p-release-readiness):
# cargo redirects builds to CARGO_TARGET_DIR (~/.cargo-target on the dev box) and
# the productName rename emits "Papercusp GUI_*.deb" (space included) — the old
# in-tree "Papercusp_*" glob silently kept resolving an 18-day-stale artifact.
# Search BOTH locations + BOTH name shapes, newest wins.
default_deb() {
  local deb
  # This is the GUI desktop VM. The same bundle directory also contains a
  # newer-looking "Papercusp Server_*.deb" on some release cuts; a broad
  # newest-file glob silently installed that different product here.
  deb="$(ls -t "$DESKTOP_REPO"/src-tauri/target/release/bundle/deb/Papercusp*_amd64.deb \
               "${CARGO_TARGET_DIR:-$HOME/.cargo-target}"/release/bundle/deb/Papercusp*_amd64.deb \
               2>/dev/null | grep -v '/Papercusp Server_' | head -1)"
  [ -n "$deb" ] && _warn_if_deb_stale "$deb"
  printf '%s\n' "$deb"
}

# _warn_if_deb_stale <deb-path> — default_deb() just auto-picks the NEWEST FILE in
# the bundle dir, which silently predates any fix landed after the last full .deb
# build (WI-1334/Brief-8, 2026-07-02: a live Hetzner NAT/geo run burned ~40min
# reproducing the ALREADY-FIXED WI-1378 roster-empty bug because the only .deb
# present was built 16 DAYS before the fix commit — nothing told the caller, and
# per-script "default_deb may resolve an older bundle, pass --deb explicitly"
# comments on several rigs went unread). Compares the .deb's mtime against the
# newest commit touching the code that actually feeds the bundle (this repo's
# HEAD, the outer monorepo's apps/operator, and the libs/papercusp submodule).
#
# EI-18160721229588594 (2026-07-20): a WARN alone was never enough — an agent/human
# skimming a long boot log (dozens of setup lines) reliably misses one yellow WARN
# and burns a full run (soak: 20+ min) silently verifying the WRONG artifact. So
# this now HARD-FAILS (exit 1) by default on a stale IMPLICIT pick — the caller
# must either rebuild, pass an explicit --deb=PATH (bypasses this check entirely —
# an explicit choice is always respected), or set PCUSP_ALLOW_STALE_DEB=1 for a
# genuinely deliberate regression test against an older build (the legitimate case
# this check must not block, just no longer silently satisfy by default).
_warn_if_deb_stale() {
  local deb="$1" deb_ts newest_ts t outer desktop_ts outer_ts papercusp_ts
  deb_ts="$(stat -c %Y "$deb" 2>/dev/null)" || return 0
  desktop_ts="$(git -C "$DESKTOP_REPO" log -1 --format=%ct 2>/dev/null || echo 0)"
  outer="$DESKTOP_REPO/.."
  outer_ts=0; papercusp_ts=0
  if git -C "$outer" rev-parse --show-toplevel >/dev/null 2>&1; then
    outer_ts="$(git -C "$outer" log -1 --format=%ct -- apps/operator 2>/dev/null || echo 0)"
    if [ -d "$outer/libs/papercusp/.git" ] || git -C "$outer/libs/papercusp" rev-parse --show-toplevel >/dev/null 2>&1; then
      papercusp_ts="$(git -C "$outer/libs/papercusp" log -1 --format=%ct 2>/dev/null || echo 0)"
    fi
  fi
  newest_ts="$desktop_ts"
  for t in "$outer_ts" "$papercusp_ts"; do
    [ -n "$t" ] && [ "$t" -gt "$newest_ts" ] 2>/dev/null && newest_ts="$t"
  done
  if [ -n "$newest_ts" ] && [ "$newest_ts" -gt "$deb_ts" ] 2>/dev/null; then
    local age_days=$(( (newest_ts - deb_ts) / 86400 ))
    if [ "${PCUSP_ALLOW_STALE_DEB:-0}" = "1" ]; then
      warn "default_deb() picked '$deb' — its mtime is ~${age_days}d OLDER than the newest" \
           "source commit touching the bundle inputs, so it may be missing a landed fix." \
           "Continuing anyway (PCUSP_ALLOW_STALE_DEB=1 — deliberate regression-test override)." \
           "(WI-1334/Brief-8, 2026-07-02; EI-18160721229588594.)"
    else
      die "default_deb() picked '$deb' — its mtime is ~${age_days}d OLDER than the newest" \
          "source commit touching the bundle inputs, so it may be missing a landed fix." \
          "REFUSING to silently continue on a possibly-stale artifact (EI-18160721229588594 —" \
          "a WARN alone was reliably missed in a long boot log, burning full soak runs on the" \
          "wrong bits). Rebuild (bin/release-local.sh for a full .deb, or" \
          "bin/build-desktop-sidecar.sh + RIG_SERVE_HOTPATCH for a fast live re-verify), pass an" \
          "explicit --deb=PATH to use '$deb' anyway, or set PCUSP_ALLOW_STALE_DEB=1 for a" \
          "deliberate regression test against an older build. (WI-1334/Brief-8, 2026-07-02.)"
    fi
  fi
}

require_golden() {
  [ -f "$GOLDEN" ] || die "golden image not found ($GOLDEN). Run: vmctl provision"
}
