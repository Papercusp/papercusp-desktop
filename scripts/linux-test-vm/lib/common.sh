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

run_testvm_scoped() {  # <name> <guest-ram-mib> <qemu> [args...]
  local name="$1" ram_mb="$2"; shift 2
  local systemd_run="${PAPERCUSP_TESTVM_SYSTEMD_RUN:-systemd-run}"
  local systemd_escape="${PAPERCUSP_TESTVM_SYSTEMD_ESCAPE:-systemd-escape}"
  command -v "$systemd_run" >/dev/null 2>&1 \
    || die "systemd-run is required to start a resource-bounded test VM"
  command -v "$systemd_escape" >/dev/null 2>&1 \
    || die "systemd-escape is required to name the test VM resource scope"

  local high_mb max_mb swap_max_mb unit
  read -r high_mb max_mb swap_max_mb <<<"$(testvm_memory_envelope "$ram_mb")"
  unit="$("$systemd_escape" --template=papercup-testvm@.scope "$name")" \
    || die "could not derive a systemd scope name for test VM '$name'"

  log "resource envelope $unit — memory high:${high_mb}MiB max:${max_mb}MiB swap-max:${swap_max_mb}MiB"
  "$systemd_run" --user --scope --quiet --collect --unit "$unit" \
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
  printf 'R=%q; p="$(ls -1 "$R/Papercusp GUI/sidecar/serve.mjs" "$R"/Papercusp*/sidecar/serve.mjs 2>/dev/null | head -1)"; SIDE=""; [ -n "$p" ] && SIDE="$(dirname "$p")"' "$root"
}

vm_deployed_sidecar_id() {
  vm_ssh "$1" "$(_vm_side_dir_sh)"'; [ -n "$SIDE" ] && printf "%s %s\n" "$(sha256sum "$SIDE/serve.mjs" | cut -c1-12)" "$(stat -c%s "$SIDE/serve.mjs")"' 2>/dev/null | tr -d '\r' | head -1
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
# Does NOT restart the app — the caller relaunches (vmctl hotpatch, or
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
  log "hotpatch $vm OK — verified $check  (relaunch the app for it to take effect)"
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
