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

# A test VM is disposable infrastructure, not an entitlement to unbounded host
# memory. QEMU's guest RAM is only the baseline charge: device state, page
# cache, and dirty qcow2 buffers add several GiB during a desktop run. Keep a
# reclaim-first cushion above guest RAM and a second hard-stop cushion above
# that. Swap is bounded separately so one abandoned test VM cannot recreate a
# host-wide swap storm during the reaper's deliberate safety window.
testvm_memory_envelope() {  # <guest-ram-mib> -> "high max swap-max" (all MiB)
  local ram_mb="${1:-}"
  [[ "$ram_mb" =~ ^[1-9][0-9]*$ ]] \
    || die "PAPERCUSP_TESTVM_RAM_MB must be a positive integer (got '$ram_mb')"

  local cushion_mb=4096
  local high_mb=$((ram_mb + cushion_mb))
  local max_mb=$((ram_mb + 2 * cushion_mb))
  local swap_max_mb=$((ram_mb / 2))
  [ "$swap_max_mb" -lt 4096 ] && swap_max_mb=4096
  [ "$swap_max_mb" -gt 16384 ] && swap_max_mb=16384
  printf '%s %s %s\n' "$high_mb" "$max_mb" "$swap_max_mb"
}

testvm_scope_unit() {  # <name> -> regular (non-template) escaped *.scope unit
  local name="$1"
  local systemd_escape="${PAPERCUSP_TESTVM_SYSTEMD_ESCAPE:-systemd-escape}"
  command -v "$systemd_escape" >/dev/null 2>&1 \
    || die "systemd-escape is required to name the test VM resource scope"
  "$systemd_escape" --mangle "papercup-testvm-$name.scope"
}

run_testvm_scoped() {  # <name> <guest-ram-mib> <qemu> [args...]
  local name="$1" ram_mb="$2"; shift 2
  local systemd_run="${PAPERCUSP_TESTVM_SYSTEMD_RUN:-systemd-run}"
  command -v "$systemd_run" >/dev/null 2>&1 \
    || die "systemd-run is required to start a resource-bounded test VM"

  local high_mb max_mb swap_max_mb unit
  read -r high_mb max_mb swap_max_mb <<<"$(testvm_memory_envelope "$ram_mb")"
  unit="$(testvm_scope_unit "$name")" \
    || die "could not derive a systemd scope name for test VM '$name'"

  log "resource envelope $unit — memory high:${high_mb}MiB max:${max_mb}MiB swap-max:${swap_max_mb}MiB"
  "$systemd_run" --user --scope --quiet --collect \
    --property=CollectMode=inactive-or-failed --unit "$unit" \
    -p MemoryAccounting=yes \
    -p "MemoryHigh=${high_mb}M" \
    -p "MemoryMax=${max_mb}M" \
    -p "MemorySwapMax=${swap_max_mb}M" \
    -- "$@"
}

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
#
# AD-HOC NAMES (WI-10004354). Every name outside the four fixed ones below USED to
# share ONE slot (idx 9 → ssh 2233), so `vmctl ssh|endpoint <a>` silently reached
# whichever ad-hoc VM <b> another agent had booted there, and a mutating driver could
# run against the wrong machine. Two rules now close that:
#   1. A RUNNING instance's ports are READ from its own qemu argv (vm_live_ports), never
#      recomputed. That is the truth even when the VM was booted with VM_*_BASE
#      overrides the caller doesn't know about, and it rejects a recycled pid by name.
#   2. An ad-hoc instance gets its OWN slot at boot (vm_ports_allocate, 10+), chosen
#      under a lock among ports nobody holds. A STOPPED ad-hoc name has no ports, and
#      ports_for says so loudly instead of guessing a slot that may be someone else's.
_testvm_fixed_slot() {
  case "$1" in
    clean) echo 0 ;;
    fed-a) echo 1 ;;
    fed-b) echo 2 ;;
    updater) echo 3 ;;
    *) return 1 ;;
  esac
}
_testvm_ports_at() {  # _testvm_ports_at <slot>
  echo "$(( ${VM_SSH_BASE:-2224} + $1 )) $(( ${VM_SPICE_BASE:-5932} + $1 )) $(( ${VM_OP_BASE:-3090} + $1 ))"
}
vm_portsfile() { echo "$RUN_DIR/$1/ports"; }   # an in-flight boot's slot claim

# vm_live_ports <name> → "<ssh> <spice> <op|->" for a RUNNING instance, read from its
# qemu argv; returns 1 when it is not running or the pid is not this instance's qemu.
vm_live_ports() {
  local name="$1" pid argv line prev="" ssh="" spice="" op=""
  pid="$(vm_pid "$name")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && [ -r "/proc/$pid/cmdline" ] || return 1
  argv="$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null)" || return 1
  case $'\n'"$argv"$'\n' in
    *$'\n'"papercusp-testvm-$name"$'\n'*) ;;
    *) return 1 ;;   # a recycled pid, or not a vmctl-booted qemu
  esac
  local re_ssh='hostfwd=tcp::([0-9]+)-:22(,|$)' re_op='hostfwd=tcp::([0-9]+)-:3070(,|$)' re_spice='(^|,)port=([0-9]+)(,|$)'
  while IFS= read -r line; do
    [[ $line =~ $re_ssh ]] && ssh="${BASH_REMATCH[1]}"
    [[ $line =~ $re_op ]] && op="${BASH_REMATCH[1]}"
    [ "$prev" = "-spice" ] && [[ $line =~ $re_spice ]] && spice="${BASH_REMATCH[2]}"
    prev="$line"
  done <<<"$argv"
  [ -n "$ssh" ] || return 1
  echo "$ssh ${spice:--} ${op:--}"
}

ports_for() {
  local name="$1" idx
  vm_live_ports "$name" && return 0
  if idx="$(_testvm_fixed_slot "$name")"; then _testvm_ports_at "$idx"; return 0; fi
  echo "[testvm] ports_for: '$name' is an ad-hoc test VM that is not running, so it has no ports." \
       "Ad-hoc names get their own slot when booted (WI-10004354); run: vmctl up $name" >&2
  return 1
}

# vm_ports_allocate <name> → "<ssh> <spice> <op>" for a boot. Fixed names keep their
# slot. An ad-hoc name takes the first slot (starting from a hash of its name) whose
# three ports are not listening on the host and not claimed by another boot still in
# flight, and records the claim in its ports file before qemu binds them.
vm_ports_allocate() {
  local name="$1" idx
  if idx="$(_testvm_fixed_slot "$name")"; then _testvm_ports_at "$idx"; return 0; fi
  mkdir -p "$(vm_rundir "$name")" || return 1
  (
    command -v flock >/dev/null 2>&1 && { flock -w 60 9 || { echo "[testvm] port-allocation lock busy for 60s" >&2; exit 1; }; }
    local taken="" f other now mtime h n i s p o
    taken=" $(ss -Hltn 2>/dev/null | awk '{sub(/.*:/, "", $4); print $4}' | tr '\n' ' ') "
    now="$(date +%s)"
    for f in "$RUN_DIR"/*/ports; do
      [ -f "$f" ] || continue
      other="$(basename "$(dirname "$f")")"
      [ "$other" = "$name" ] && continue
      mtime="$(stat -c %Y "$f" 2>/dev/null || echo 0)"
      # A claim counts while its boot may still be binding; a booted VM's ports are
      # already in `taken` because qemu is listening on them.
      [ $(( now - mtime )) -lt "${VM_PORT_CLAIM_TTL_SEC:-300}" ] && taken+="$(tr '\n' ' ' < "$f") "
    done
    h="$(printf '%s' "$name" | cksum | awk '{print $1}')"
    n="${VM_ADHOC_SLOTS:-40}"
    for (( i = 0; i < n; i++ )); do
      idx=$(( 10 + (h + i) % n ))
      read -r s p o <<<"$(_testvm_ports_at "$idx")"
      case "$taken" in *" $s "*|*" $p "*|*" $o "*) continue ;; esac
      echo "$s $p $o" > "$(vm_portsfile "$name")"
      echo "$s $p $o"
      exit 0
    done
    echo "[testvm] no free ad-hoc test-VM port slot among $n (set VM_SSH_BASE/VM_SPICE_BASE/VM_OP_BASE or VM_ADHOC_SLOTS)" >&2
    exit 1
  ) 9>"$RUN_DIR/.port-alloc.lock"
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
  # ⚠ The trailing `|| true` is LOAD-BEARING — do not "tidy" it away. This file runs
  # under `set -euo pipefail` (top of common.sh), and EVERY stage of this pipeline has
  # a normal, non-error way to exit non-zero. pipefail propagates it and `set -e` then
  # kills the shell AT THIS ASSIGNMENT — before the printf below — so the function
  # returns nothing at all, not even the empty line callers expect:
  #   • `ls` exits 2 when EITHER directory is absent (the usual state on a box that
  #     pins CARGO_TARGET_DIR, where the in-tree src-tauri/target/ never exists) —
  #     even though it still prints the file it DID find on the other path;
  #   • `grep -v` exits 1 when it filters out every line (only a Server_ deb present);
  #   • `head -1` can SIGPIPE the producer (141) once it has its line.
  # The contract here is "print the newest matching deb, or empty" — all three of the
  # above are EMPTY, not FAILED, and every caller tests `[ -n "$DEB" ]` accordingly.
  # Measured 2026-08-22: this silently broke bin/local-matrix.sh's preflight, which
  # reports the bare exit code as "no usable .deb — default_deb() refused (exit 2)"
  # while a perfectly good GUI .deb sat in ~/.cargo-target. ~13 rig scripts call this.
  deb="$(ls -t "$DESKTOP_REPO"/src-tauri/target/release/bundle/deb/Papercusp*_amd64.deb \
               "${CARGO_TARGET_DIR:-$HOME/.cargo-target}"/release/bundle/deb/Papercusp*_amd64.deb \
               2>/dev/null | grep -v '/Papercusp Server_' | head -1 || true)"
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
    # Render the delta in a unit that can never round to zero. This used to be a
    # bare `/ 86400`, which printed the self-refuting "~0d OLDER than the newest
    # source commit" for every sub-day staleness — i.e. exactly the common case
    # (a .deb built this morning against an afternoon commit), and precisely when
    # the reader most needs to know HOW stale. `newest_ts -gt deb_ts` already
    # holds here, so age_secs >= 1 and the cascade always yields a non-zero unit.
    local age_secs=$(( newest_ts - deb_ts )) age_human
    if [ "$age_secs" -ge 86400 ]; then
      age_human="$(( age_secs / 86400 ))d$(( (age_secs % 86400) / 3600 ))h"
    elif [ "$age_secs" -ge 3600 ]; then
      age_human="$(( age_secs / 3600 ))h$(( (age_secs % 3600) / 60 ))m"
    elif [ "$age_secs" -ge 60 ]; then
      age_human="$(( age_secs / 60 ))m"
    else
      age_human="${age_secs}s"
    fi
    if [ "${PCUSP_ALLOW_STALE_DEB:-0}" = "1" ]; then
      warn "default_deb() picked '$deb' — its mtime is ~${age_human} OLDER than the newest" \
           "source commit touching the bundle inputs, so it may be missing a landed fix." \
           "Continuing anyway (PCUSP_ALLOW_STALE_DEB=1 — deliberate regression-test override)." \
           "(WI-1334/Brief-8, 2026-07-02; EI-18160721229588594.)"
    else
      die "default_deb() picked '$deb' — its mtime is ~${age_human} OLDER than the newest" \
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

# ── deployed-state provenance (WI-6212) ─────────────────────────────────────
# _warn_if_deb_stale (above) guards the ARTIFACT PICK — it only runs when a rig
# INSTALLS a .deb via default_deb(), and it compares a FILE's mtime to source
# commits. It therefore cannot see the case that burned WI-6209: a long-lived rig
# whose VMs were installed by EARLIER runs, at DIFFERENT times, and are now
# running DIFFERENT builds. Measured there:
#     fed-a  sidecar 2026-07-26 15:37Z  — HAD the holepunch fix under test
#     fed-b  sidecar 2026-07-26 09:26Z  — did NOT (cut 37 min before it landed)
# Nothing anywhere compared them, so the rig produced a confident, reproducible,
# and completely wrong bug report: the one direction that failed was exactly the
# one dialed by the stale VM. This is the THIRD instance of the class already
# recorded on _warn_if_deb_stale (WI-1334, EI-18160721229588594) — each previous
# fix hardened artifact SELECTION and left DEPLOYED STATE unchecked.
#
# So: assert what is actually ON THE VM, not what we think we installed.

# vm_deployed_sidecar_id <vmname> — echo "<sha256-12> <bytes>" for the sidecar
# bundle actually installed on that VM, or empty when it cannot be read. The
# bundle is the real unit of behaviour here: serve.mjs is an esbuild bundle that
# INLINES the operator, its deps, and the patched hyperdht, so its hash is a
# faithful identity for "which code is this VM running".
# Emit the in-VM shell that sets $SIDE to the installed sidecar DIRECTORY (empty
# when the app is not installed). ONE definition, shared by every function that
# has to find the deployed bundle — the install path has already changed shape
# once (the "Papercusp GUI" productName rename), and a second copy of this glob
# is a second thing to forget to update.
#
# VM_SIDE_ROOT is a TEST seam, not a runtime knob: it lets the self-test point
# this logic at a real fixture directory and exercise the marker/hash comparison
# for real, instead of asserting by eye that the code "looks right". The value is
# baked into the emitted script text because ssh forwards no environment.
_vm_side_dir_sh() {
  local root="${VM_SIDE_ROOT:-/usr/lib}"
  printf 'R=%q; SIDE=""; if [ -f "$R/Papercusp Server/sidecar/serve.mjs" ]; then SIDE="$R/Papercusp Server/sidecar"; else p="$(ls -1 "$R/Papercusp GUI/sidecar/serve.mjs" "$R"/Papercusp*/sidecar/serve.mjs 2>/dev/null | head -1)"; [ -z "$p" ] || SIDE="$(dirname "$p")"; fi' "$root"
}

vm_deployed_sidecar_id() {
  vm_ssh "$1" "$(_vm_side_dir_sh)"'; [ -n "$SIDE" ] && printf "%s %s\n" "$(sha256sum "$SIDE/serve.mjs" | cut -c1-12)" "$(stat -c%s "$SIDE/serve.mjs")"' 2>/dev/null | tr -d '\r' | head -1
}

# vm_server_loaded_identity <vm> [ownership] -> processIdentity|digest|InvocationID
# Reuse the installed user-service lifecycle and operator.json birth identity
# contract (vmctl updater-e2e), with runtime-vintage's conservative entry pin:
# the file must predate the Node process and remain unchanged across hashing.
# A disk marker alone says nothing about bytes already loaded by an old Server.
# ownership preflights service/birth/path only (digest=unverified), permitting a
# retry after a failed reload left new disk bytes under an old process. It NEVER
# qualifies provenance; only the default loaded mode establishes the digest.
# VM_PROC_ROOT, like VM_SIDE_ROOT, is solely a hermetic procfs-fixture seam.
vm_server_loaded_identity() {
  vm_run "$1" "SIDE_ROOT=${VM_SIDE_ROOT:-/usr/lib}" "PROC_ROOT=${VM_PROC_ROOT:-/proc}" "IDENTITY_PHASE=${2:-loaded}" <<'EOF'
set -euo pipefail
timeout 15s systemctl --user is-active --quiet papercusp-server.service
group="$(timeout 15s systemctl --user show -p ControlGroup --value papercusp-server.service)"
invocation="$(timeout 15s systemctl --user show -p InvocationID --value papercusp-server.service)"
if [ -f "$HOME/fed.env" ]; then set -a; . "$HOME/fed.env"; set +a; fi
timeout 15s python3 - "$SIDE_ROOT" "$PROC_ROOT" "$group" "$invocation" "$IDENTITY_PHASE" <<'PY'
import hashlib, json, os, pathlib, re, sys, time, urllib.request
side = pathlib.Path(sys.argv[1]) / "Papercusp Server/sidecar"
proc = pathlib.Path(sys.argv[2])
group, invocation, phase = sys.argv[3:6]
def require(ok, message):
    if not ok: raise RuntimeError(message)
require(group.startswith("/") and len(group) > 1, "Server service has no control group")
require(re.fullmatch(r"[a-f0-9]{32}", invocation), "Server service has no invocation identity")
require(phase in ("loaded", "ownership"), "unknown Server identity phase")
record = json.loads((pathlib.Path.home() / ".papercusp/operator.json").read_text())
pid = int(record["pid"])
require(pid > 0, "invalid operator pid")
base = proc / str(pid)
def identity():
    stat = (base / "stat").read_text()
    fields = stat[stat.rfind(")") + 1:].split()
    require(fields[0] != "Z", "operator is a zombie")
    ticks = int(fields[19])
    boot = (proc / "sys/kernel/random/boot_id").read_text().strip()
    return f"linux:{boot}:{ticks}", ticks
birth, ticks = identity()
require(record.get("processIdentity") == birth, "operator birth identity mismatch")
groups = [line.split(":", 2)[2] for line in (base / "cgroup").read_text().splitlines()]
require(any(g == group or g.startswith(group + "/") for g in groups), "operator is outside Server service")
require(re.fullmatch(r"node(?:js)?", (base / "exe").resolve().name), "operator is not Node")
argv = (base / "cmdline").read_bytes().rstrip(b"\0").decode().split("\0")
entry = (side / "serve.mjs").resolve(strict=True)
preload = str((side / "sidecar-preload.js").resolve())
require(argv[1:] == ["--require", preload, str(entry), "--ensure"], "unsupported Server Node entry")
env = dict(part.split("=", 1) for part in (base / "environ").read_bytes().rstrip(b"\0").decode().split("\0") if "=" in part)
for key in ("GH_TOKEN", "PAPERCUSP_DHT_BOOTSTRAP", "PAPERCUSP_FED_DHT_MODE"):
    if os.environ.get(key): require(env.get(key) == os.environ[key], "Server federation environment mismatch: " + key)
before = entry.stat()
def signature(stat):
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns
uptime = float((proc / "uptime").read_text().split()[0])
started = time.time() - uptime + ticks / os.sysconf("SC_CLK_TCK")
if phase == "loaded":
    require(0 < ticks / os.sysconf("SC_CLK_TCK") <= uptime and max(before.st_mtime, before.st_ctime) < started - .025, "bundle changed after Server started")
digest = hashlib.sha256(entry.read_bytes()).hexdigest() if phase == "loaded" else "unverified"
require(signature(entry.stat()) == signature(before) and identity()[0] == birth, "Server entry changed during identity read")
port = int(record["port"])
require(0 < port < 65536, "invalid operator port")
with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=3) as response:
    health = json.load(response)
require(health.get("service") == "papercusp-operator" and health.get("ok") is True, "operator is not healthy")
require(identity()[0] == birth and signature(entry.stat()) == signature(before), "Server changed during health read")
print(f"{birth}|{digest}|{invocation}")
PY
EOF
}

# vm_assert_uniform_sidecar <vmname>... — die unless EVERY named VM runs the same
# sidecar bundle. A heterogeneous rig makes every cross-VM result uninterpretable:
# a difference between the two ends is then indistinguishable from a difference
# between the two BUILDS, which is precisely how WI-6209 was misdiagnosed.
vm_assert_uniform_sidecar() {
  local first="" first_vm="" vm id
  for vm in "$@"; do
    id="$(vm_deployed_sidecar_id "$vm")"
    [ -n "$id" ] || die "cannot read the deployed sidecar bundle on '$vm'." \
      "REFUSING to run: an unidentifiable build cannot be verified against, and a rig" \
      "that measures unknown bytes produces confident wrong answers (WI-6209/WI-6212)."
    echo "  $vm sidecar: $id"
    if [ -z "$first" ]; then first="$id"; first_vm="$vm"; continue; fi
    [ "$id" = "$first" ] || die "rig is HETEROGENEOUS — '$first_vm' runs sidecar [$first]" \
      "but '$vm' runs [$id]. Every cross-VM result would be uninterpretable (a difference" \
      "between the ends is indistinguishable from a difference between the BUILDS — exactly" \
      "the WI-6209 misdiagnosis). Reinstall/hotpatch both from ONE artifact and re-run."
  done
}

# ── fast sidecar swap: the hotpatch path (WI-6212) ──────────────────────────
# Rebuilding the .deb to test a JS change is ~3.5GB of cargo work for a bundle
# that bin/build-desktop-sidecar.sh can rebuild by itself in minutes — and in
# every federation bug so far the unit under test WAS that bundle (serve.mjs
# inlines the operator, its deps, and the patched hyperdht). The Hetzner rig has
# had this fast path for a long time (RIG_SERVE_HOTPATCH, bin/lib/deb-hetzner-rig.sh
# :734); the local VM rig never did, which is why the WI-6209 investigation ended
# up hand-rolling an scp — untracked, unrecorded, and invisible to every guard.
# Same env var name as the Hetzner rig on purpose: one lever, two rigs.
#
# ⚠ THE TRAP THIS MUST NOT SPRING. A hotpatch DIVORCES the running JS from the
# .deb's identity, and the .deb's identity is the only one /api/health knows:
# `sha` comes from the RUST binary (option_env!("PAPERCUSP_BUILD_SHA"), forwarded
# to the sidecar's env by main.rs:4657), so swapping serve.mjs cannot change it —
# verified, not assumed. A naive port of the Hetzner lever would therefore leave
# a VM confidently self-reporting a build whose JS it is no longer running: WI-6212's
# exact failure class, re-created by the tool built to fix it. So every hotpatch
# WRITES A MARKER beside the bundle, and vm_hotpatch_provenance re-verifies that
# marker against the bundle actually on disk before believing a word of it.

# vm_hotpatch_sidecar <vmname> [serve.mjs] — replace the installed sidecar bundle
# (and its db-sql) with a locally-built one, and record what was installed.
# Source precedence: $2 > $RIG_SERVE_HOTPATCH > the tree's built sidecar.
# Does NOT restart the Server — the caller owns its explicit lifecycle (vmctl hotpatch, or
# vm-federation.sh's launch_vm_instance). Overwriting the file a running node
# process already read is harmless; it simply has no effect until the relaunch.
vm_hotpatch_sidecar() {
  local vm="$1" src="${2:-${RIG_SERVE_HOTPATCH:-$DESKTOP_REPO/src-tauri/sidecar/serve.mjs}}"
  [ -f "$src" ] || die "no sidecar bundle to hotpatch at '$src'." \
    "Build one first:  cd $DESKTOP_REPO && bin/build-desktop-sidecar.sh" \
    "(or pass a path / set RIG_SERVE_HOTPATCH)."

  # Deliberately NOT an mtime-vs-newest-commit staleness check like the .deb path's
  # _warn_if_deb_stale. On this shared tree git-sync commits every few minutes, so
  # EVERY bundle is "older than the newest commit" within moments of being built:
  # the check would fire on essentially every invocation, and a guard that always
  # fires trains its users to set the override permanently — which would also
  # disable the .deb check that shares it. It is also the wrong instrument: the gap
  # that produced WI-6209 was 37 MINUTES, which no usable mtime threshold catches.
  # Identity, not recency, is the real property — RIG_EXPECT_SHA and the marker
  # below answer it exactly. What IS checked here is the mistake this loop actually
  # invites, and it is checked precisely: pushing a bundle you forgot to rebuild.
  local bsha installed
  bsha="$(sha256sum "$src" | cut -c1-12)"
  installed="$(vm_deployed_sidecar_id "$vm")"; installed="${installed%% *}"
  if [ -n "$installed" ] && [ "$installed" = "$bsha" ] && [ "${RIG_HOTPATCH_ALLOW_NOOP:-0}" != "1" ]; then
    die "'$vm' ALREADY runs this exact bundle ($bsha) — hotpatching it changes nothing." \
      "If you just edited code, the edit is not in '$src': rebuild it first." \
      "  cd $DESKTOP_REPO && bin/build-desktop-sidecar.sh" \
      "Believing an unchanged bundle carries your fix is precisely the WI-6209 failure." \
      "To re-push identical bytes anyway (e.g. to re-establish the marker): RIG_HOTPATCH_ALLOW_NOOP=1."
  fi

  local side; side="$(vm_ssh "$vm" "$(_vm_side_dir_sh)"'; printf "%s\n" "$SIDE"' 2>/dev/null | tr -d '\r' | head -1)"
  [ -n "$side" ] || die "no installed Papercusp sidecar found on '$vm' — a hotpatch REPLACES an" \
    "installed bundle, it cannot create one. Install first:  vmctl install $vm"

  # Identity recorded at patch time. The bundle sha256 is the load-bearing field
  # (it is re-checkable against the file itself); the tree shas are labels for
  # RIG_EXPECT_SHA. `dirty` is recorded, not rejected: this shared tree is
  # continuously dirty by design (git-sync commits every few minutes), so failing
  # on it would make the lever unusable and push people to the escape hatch.
  local desktop_sha outer_sha dirty="clean" now built
  desktop_sha="$(git -C "$DESKTOP_REPO" rev-parse --short HEAD 2>/dev/null || echo none)"
  outer_sha="$(git -C "$DESKTOP_REPO/.." rev-parse --short HEAD 2>/dev/null || echo none)"
  [ -n "$(git -C "$DESKTOP_REPO" status --porcelain 2>/dev/null)" ] && dirty="dirty"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  built="$(date -u -d "@$(stat -c %Y "$src")" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"

  # Print the bundle's BUILD time, not just its hash: "is this the bundle I just
  # built?" is the question a human asks at this moment, and a timestamp answers
  # it at a glance where a hash does not.
  log "hotpatch $vm: $side/serve.mjs ← $src"
  log "  bundle $bsha built $built · desktop $desktop_sha · outer $outer_sha · tree $dirty"
  vm_scp "$vm" "$src" /tmp/serve.mjs.hotpatch >/dev/null \
    || die "could not copy '$src' to '$vm'"
  vm_ssh "$vm" "sudo install -m 0644 /tmp/serve.mjs.hotpatch '$side/serve.mjs' && rm -f /tmp/serve.mjs.hotpatch" \
    || die "could not install the hotpatched bundle on '$vm'"

  # WI-1544 schema-drift guard, same as the Hetzner rig: a hotpatched serve.mjs
  # runs CURRENT-tree code against the .deb's FROZEN migrations (the sidecar's
  # db-sql is what the launch pins), so any migration added since the .deb build
  # silently never applies. Ship the tree's top-level *.sql alongside the bundle.
  local dbsql="${RIG_DBSQL_HOTPATCH:-$DESKTOP_REPO/../libs/papercusp/libs/db/sql}"
  if [ -d "$dbsql" ] && [ -n "$(ls "$dbsql"/*.sql 2>/dev/null)" ]; then
    log "hotpatch $vm: $side/db-sql ← $dbsql"
    (cd "$dbsql" && tar -cf - ./*.sql) | vm_ssh "$vm" "sudo tar -C '$side/db-sql' -xf -" \
      || die "could not sync db-sql to '$vm' — a hotpatched bundle against frozen migrations" \
             "fails in ways that look like product bugs (WI-1544)."
  else
    warn "db-sql hotpatch SKIPPED on $vm — '$dbsql' has no *.sql. The bundle now runs current" \
         "code against the .deb's frozen migrations (WI-1544); expect schema-drift failures."
  fi

  # The marker. Read back and VERIFIED below — a guard whose own write is never
  # checked is how this whole class starts.
  printf 'hotpatch %s %s %s %s %s built=%s %s\n' \
      "$bsha" "$desktop_sha" "$outer_sha" "$dirty" "$now" "$built" "$(basename "$src")" \
    | vm_ssh "$vm" "sudo tee '$side/.hotpatch-provenance' >/dev/null" \
    || die "could not write the hotpatch provenance marker on '$vm'"

  local check; check="$(vm_hotpatch_provenance "$vm")"
  [ -n "$check" ] || die "hotpatched '$vm' but the provenance marker does NOT verify against the" \
    "bundle now on disk. The rig would run unidentifiable code — refusing to leave it in that" \
    "state. Investigate before re-running (did the install land? is $side writable?)."
  log "hotpatch $vm disk copy verified $check (Server reload/loaded identity still required)"
}

# vm_hotpatch_provenance <vmname> — echo "<bundle-sha12>|<desktop-sha>|<outer-sha>|<clean|dirty>"
# for a hotpatch that is STILL IN FORCE on that VM, else empty.
#
# "Still in force" is the whole point: the marker is only believed when its
# recorded bundle hash equals the hash of the bundle actually on disk RIGHT NOW.
# A later `vmctl install` (or a second hotpatch that failed halfway) replaces the
# bundle and leaves the old marker behind — and a marker outliving the bytes it
# describes is a provenance system that lies, which is worse than none.
vm_hotpatch_provenance() {
  vm_ssh "$1" "$(_vm_side_dir_sh)"'
    [ -n "$SIDE" ] || exit 0
    m="$SIDE/.hotpatch-provenance"
    [ -f "$m" ] || exit 0
    read -r tag b d o dirty rest < "$m" || exit 0
    [ "$tag" = hotpatch ] || exit 0
    live="$(sha256sum "$SIDE/serve.mjs" 2>/dev/null | cut -c1-12)"
    [ -n "$live" ] && [ "$live" = "$b" ] && printf "%s|%s|%s|%s\n" "$b" "$d" "$o" "$dirty"
  ' 2>/dev/null | tr -d '\r' | head -1
}

# vm_build_provenance <vmname> — echo "<sha>|<version>" as reported by the app's
# OWN GET /api/health, or empty when no operator answers.
#
# Discovers the operator port in-VM (the packaged app binds a DYNAMIC loopback
# port each boot, and other listeners exist) by probing each listening 127.0.0.1
# port and keeping the one whose /api/health identifies as papercusp-operator.
vm_build_provenance() {
  vm_ssh "$1" '
    for p in $(ss -ltnH 2>/dev/null | grep -o "127\.0\.0\.1:[0-9]*" | cut -d: -f2 | sort -u); do
      r="$(curl -s --max-time 3 "http://127.0.0.1:$p/api/health" 2>/dev/null)" || continue
      case "$r" in
        *papercusp-operator*)
          s="$(printf "%s" "$r" | sed -n "s/.*\"sha\":\"\([^\"]*\)\".*/\1/p")"
          v="$(printf "%s" "$r" | sed -n "s/.*\"version\":\"\([^\"]*\)\".*/\1/p")"
          printf "%s|%s\n" "$s" "$v"
          exit 0 ;;
      esac
    done' 2>/dev/null | tr -d '\r' | head -1
}

# vm_assert_build_provenance <vmname>... — die unless every named VM runs a build
# that can IDENTIFY ITSELF (and, when RIG_EXPECT_SHA is set, identifies as the
# commit under test).
#
# WI-6212: vm_assert_uniform_sidecar above proves the VMs match EACH OTHER. It
# cannot see the case where they match and are BOTH stale — a uniformly-wrong rig
# reports confident, reproducible, wrong answers with nothing anywhere disagreeing.
#
# The signal is free and unambiguous: PAPERCUSP_BUILD_VERSION is baked FROM
# src-tauri/tauri.conf.json's version by bin/build-linux-local.sh and
# bin/release-local.sh, and forwarded into the sidecar's env by main.rs, so a
# provenance-setting build ALWAYS reports that real version. version=="0.0.0"
# (build-info.ts's last-resort fallback) therefore means the artifact was built by
# a path that set neither var — a bare `npx tauri build` rather than the build
# scripts. That is exactly the state the WI-6209 rig was in: version 0.0.0 and
# sha null while the .deb on disk was 0.0.13.
#
# Deliberately NOT a byte-grep of the binary for the short sha: a 7-char hex
# string can occur incidentally in a 23MB binary, and that failure direction is a
# FALSE PASS — the dangerous one for a guard.
#
# ESCAPE HATCH: RIG_ALLOW_UNPROVENANCED=1 downgrades this to a warning, for a peer
# mid-investigation who must not be hard-blocked on a multi-GB rebuild. Precedent:
# PAPERCUSP_ALLOW_DIRTY in bin/release-local.sh. Using it INVALIDATES any
# "the rig ran the code under test" claim from that run — say so in the report.
#
# HOTPATCH. A VM whose sidecar was swapped by vm_hotpatch_sidecar reports the
# .deb's provenance (or none) while running entirely different JS, so this guard
# consults the hotpatch marker FIRST. A marker still in force is ACCEPTED as
# provenance — and is in fact a stronger identity than the .deb's baked sha,
# because it is re-verified against the bundle's own hash rather than trusted —
# but the divergence is always PRINTED: nothing here may quietly imply that the
# self-reported build describes the code actually running.
vm_assert_build_provenance() {
  local vm rec sha ver hp hp_bundle hp_desktop hp_outer hp_dirty
  for vm in "$@"; do
    rec="$(vm_build_provenance "$vm")"
    if [ -z "$rec" ]; then
      die "no operator answered /api/health on '$vm' — cannot establish which build this" \
        "VM is running. REFUSING: a rig that cannot identify its build produces confident" \
        "wrong answers (WI-6209/WI-6212)."
    fi
    sha="${rec%%|*}"; ver="${rec#*|}"
    echo "  $vm build: sha=${sha:-<null>} version=${ver:-<none>}"

    hp="$(vm_hotpatch_provenance "$vm")"
    if [ -n "$hp" ]; then
      hp_bundle="${hp%%|*}"; hp="${hp#*|}"
      local loaded loaded_hash
      loaded="$(vm_server_loaded_identity "$vm")" \
        || die "'$vm' has a hotpatch on disk but no verified service-owned loaded identity"
      loaded_hash="${loaded#*|}"; loaded_hash="${loaded_hash%%|*}"
      [ "${loaded_hash:0:12}" = "$hp_bundle" ] \
        || die "'$vm' hotpatch disk marker differs from Server-loaded identity"
      hp_desktop="${hp%%|*}"; hp="${hp#*|}"
      hp_outer="${hp%%|*}"; hp_dirty="${hp#*|}"
      echo "  $vm HOTPATCHED: sidecar bundle $hp_bundle from desktop=$hp_desktop outer=$hp_outer ($hp_dirty)"
      echo "    ↳ the running JS is NOT the .deb's build — the sha above describes the native shell only."
      if [ -n "${RIG_EXPECT_SHA:-}" ] \
         && [ "$hp_desktop" != "$RIG_EXPECT_SHA" ] && [ "$hp_outer" != "$RIG_EXPECT_SHA" ]; then
        die "'$vm' runs a sidecar hotpatched from desktop=$hp_desktop / outer=$hp_outer, but this" \
          "run expects '$RIG_EXPECT_SHA'. Re-hotpatch from a tree at $RIG_EXPECT_SHA and re-run."
      fi
      continue
    fi

    if [ -z "$sha" ] || [ "$ver" = "0.0.0" ] || [ -z "$ver" ]; then
      if [ "${RIG_ALLOW_UNPROVENANCED:-0}" = "1" ]; then
        warn "'$vm' reports sha=${sha:-<null>} version=${ver:-<none>} — an UNPROVENANCED build." \
          "Continuing only because RIG_ALLOW_UNPROVENANCED=1. This run CANNOT support any claim" \
          "that the rig ran the code under test."
        continue
      fi
      die "'$vm' reports sha=${sha:-<null>} version=${ver:-<none>} — this artifact carries NO" \
        "build provenance, so it is impossible to tell whether it contains the code under test." \
        "Both VMs being uniformly stale looks IDENTICAL to both being current (WI-6212)." \
        "FIX (full): rebuild the .deb with bin/build-linux-local.sh (it sets PAPERCUSP_BUILD_SHA" \
        "and PAPERCUSP_BUILD_VERSION; a bare 'npx tauri build' does NOT) and reinstall on both VMs." \
        "FIX (fast, minutes not GB): if the code under test is JS — which it is for anything" \
        "federation, sync, or operator — rebuild ONLY the sidecar and hotpatch it:" \
        "  cd $DESKTOP_REPO && bin/build-desktop-sidecar.sh && vmctl hotpatch <vm>" \
        "That records a VERIFIED bundle identity, which this guard accepts in place of the .deb's." \
        "Override for an unrelated investigation: RIG_ALLOW_UNPROVENANCED=1."
    fi
    if [ -n "${RIG_EXPECT_SHA:-}" ] && [ "$sha" != "$RIG_EXPECT_SHA" ]; then
      die "'$vm' runs build sha '$sha' but this run expects '$RIG_EXPECT_SHA' — the rig is" \
        "STALE relative to the commit under test. Reinstall both VMs from an artifact built" \
        "at $RIG_EXPECT_SHA and re-run."
    fi
  done
}

# vm_assert_dht_isolated <vmname> — die when the app on that VM joined the PUBLIC
# DHT while this run intended an isolated testnet.
#
# WI-6209: launching the app WITHOUT sourcing ~/fed.env (which carries
# PAPERCUSP_DHT_BOOTSTRAP) silently falls back to the public DHT. Nothing fails —
# the app boots, peers, and logs normally — it just quietly pulls unrelated outside
# peers into the rig and invalidates every federation measurement. Step 8 printed
# "isolated by construction (separate VMs)", which is PROCESS isolation and says
# nothing about which DHT the app joined. Assert the app's own verdict instead.
vm_assert_dht_isolated() {
  local vm="$1" line
  line="$(vm_ssh "$vm" 'grep -ah "DHT bootstrap" ~/.papercusp/logs/serve.log 2>/dev/null | tail -1' 2>/dev/null | tr -d '\r')"
  [ -n "$line" ] || die "no '[swarm] DHT bootstrap' line in the app log on '$vm' — cannot" \
    "confirm which DHT it joined, so no federation result from this rig is trustworthy."
  case "$line" in
    *ISOLATED*) echo "  $vm DHT: ${line#*DHT bootstrap = }" ;;
    *) die "'$vm' joined the PUBLIC DHT: ${line#*DHT bootstrap = }" \
         "This rig is supposed to be isolated. Outside peers can join, and every" \
         "peering/merge result becomes meaningless (WI-764 class; hit again in WI-6209" \
         "when a relaunch omitted ~/fed.env). Relaunch WITH the bootstrap env:" \
         "  set -a; . ~/fed.env; set +a; setsid bash -c 'exec /usr/bin/papercusp-desktop'" ;;
  esac
}

require_golden() {
  [ -f "$GOLDEN" ] || die "golden image not found ($GOLDEN). Run: vmctl provision"
}
