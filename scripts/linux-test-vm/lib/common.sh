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
vm_deployed_sidecar_id() {
  vm_ssh "$1" 'p="$(ls -1 "/usr/lib/Papercusp GUI/sidecar/serve.mjs" /usr/lib/Papercusp*/sidecar/serve.mjs 2>/dev/null | head -1)"; [ -n "$p" ] && printf "%s %s\n" "$(sha256sum "$p" | cut -c1-12)" "$(stat -c%s "$p")"' 2>/dev/null | tr -d '\r' | head -1
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
vm_assert_build_provenance() {
  local vm rec sha ver
  for vm in "$@"; do
    rec="$(vm_build_provenance "$vm")"
    if [ -z "$rec" ]; then
      die "no operator answered /api/health on '$vm' — cannot establish which build this" \
        "VM is running. REFUSING: a rig that cannot identify its build produces confident" \
        "wrong answers (WI-6209/WI-6212)."
    fi
    sha="${rec%%|*}"; ver="${rec#*|}"
    echo "  $vm build: sha=${sha:-<null>} version=${ver:-<none>}"
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
        "FIX: rebuild the .deb with bin/build-linux-local.sh (it sets PAPERCUSP_BUILD_SHA and" \
        "PAPERCUSP_BUILD_VERSION; a bare 'npx tauri build' does NOT) and reinstall on both VMs." \
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
