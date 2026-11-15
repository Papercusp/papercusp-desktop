#!/usr/bin/env bash
# Host-side liveness probe for papercusp-vm-mac.service. Unlike
# mac-vm-inspect-running.sh, this remains useful when macOS never reaches sshd.
set -uo pipefail

SSH_PORT="${MAC_VM_SSH_PORT:-2222}"
SSH_HOST="${MAC_VM_SSH_HOST:-aviweiss@127.0.0.1}"
SSH_KEY="${MAC_VM_SSH_KEY:-$HOME/.ssh/papercup-vm-mac}"
QMP_SOCK="${MAC_VM_QMP_SOCK:-$HOME/macos-vm/OSX-KVM/qmp.sock}"
DISK_IMAGE="${MAC_VM_DISK_IMAGE:-$HOME/macos-vm/OSX-KVM/mac_hdd_ng.img}"
STALE_SEC="${MAC_VM_STALE_SEC:-900}"
QMP_DIR="$(dirname "$QMP_SOCK")"
QEMU_PIDFILE="${MAC_VM_QEMU_PIDFILE:-$QMP_DIR/qemu.pid}"
QEMU_LOG="${MAC_VM_QEMU_LOG:-$QMP_DIR/logs/qemu-current.log}"
QEMU_LOG_DIR="$(dirname "$QEMU_LOG")"
PROC_ROOT="${MAC_VM_PROC_ROOT:-/proc}"
FD_EXHAUSTION_PCT="${MAC_VM_FD_EXHAUSTION_PCT:-90}"
CLOSE_WAIT_THRESHOLD="${MAC_VM_CLOSE_WAIT_THRESHOLD:-256}"
CLOSE_WAIT_OCCUPANCY_PCT="${MAC_VM_CLOSE_WAIT_OCCUPANCY_PCT:-75}"
QEMU_LOG_MAX_BYTES="${MAC_VM_QEMU_LOG_MAX_BYTES:-67108864}"
QMP_HELPER="${MAC_VM_QMP_HELPER:-$(dirname "$0")/qmp-command.py}"
RECOVER=0
JSON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --recover-picker) RECOVER=1; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,34p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

service_active=false
systemctl --user is-active --quiet papercusp-vm-mac.service 2>/dev/null && service_active=true

# Read QEMU's process state before opening another SSH-forward connection. The
# historical failure filled QEMU's 1024-FD soft limit with CLOSE_WAIT sockets;
# another SSH health check then fed the slirp leak and made the control plane
# less recoverable. /proc is the host-side Linux interface, which is also where
# this systemd-managed VM runs. MAC_VM_PROC_ROOT keeps the probe deterministic
# in the recurrence test without changing the production path.
qemu_pid=""
qemu_process_found=false
qemu_fd_count=-1
qemu_fd_limit=-1
qemu_close_wait_count=0
qemu_fd_exhausted=false
qemu_log_bounded=false
ssh_probe_skipped=false
qmp_probe_skipped=false
operator_probe_ok=false
guest_boot_epoch=-1
operator_started_at_ms=-1
operator_pid=-1
operator_pid_alive=false
operator_port=-1
operator_port_listening=false
operator_lost_after_reboot=false
guest_kernel_panic=false
guest_panic_epoch=0
guest_panic_report=""

disk_basename="$(basename "$DISK_IMAGE")"
qmp_basename="$(basename "$QMP_SOCK")"

qemu_cmdline_for_pid() {
  local pid="$1"
  tr '\0' ' ' < "$PROC_ROOT/$pid/cmdline" 2>/dev/null || true
}

qemu_candidate="${MAC_VM_QEMU_PID:-}"
if [[ -z "$qemu_candidate" && -r "$QEMU_PIDFILE" ]]; then
  qemu_candidate="$(head -n1 "$QEMU_PIDFILE" 2>/dev/null | tr -cd '0-9')"
fi

qemu_cmdline=""
if [[ "$qemu_candidate" =~ ^[0-9]+$ && -r "$PROC_ROOT/$qemu_candidate/cmdline" ]]; then
  candidate_cmdline="$(qemu_cmdline_for_pid "$qemu_candidate")"
  if [[ "$candidate_cmdline" == *qemu-system-* && "$candidate_cmdline" == *"$disk_basename"* ]]; then
    qemu_pid="$qemu_candidate"
    qemu_cmdline="$candidate_cmdline"
  fi
fi

# A missing/stale qemu.pid must not turn a live VM into "service is not active".
# Match both the disk and QMP basename so another QEMU rig on the host cannot be
# mistaken for this VM.
if [[ -z "$qemu_pid" ]]; then
  while IFS= read -r qemu_candidate; do
    [[ "$qemu_candidate" =~ ^[0-9]+$ ]] || continue
    [[ -r "$PROC_ROOT/$qemu_candidate/cmdline" ]] || continue
    candidate_cmdline="$(qemu_cmdline_for_pid "$qemu_candidate")"
    if [[ "$candidate_cmdline" == *qemu-system-* && \
          "$candidate_cmdline" == *"$disk_basename"* && \
          "$candidate_cmdline" == *"$qmp_basename"* ]]; then
      qemu_pid="$qemu_candidate"
      qemu_cmdline="$candidate_cmdline"
      break
    fi
  done < <(pgrep -x qemu-system-x86_64 2>/dev/null || true)
fi

if [[ -n "$qemu_pid" ]]; then
  qemu_process_found=true
  qemu_fd_dir="$PROC_ROOT/$qemu_pid/fd"
  if [[ -d "$qemu_fd_dir" ]]; then
    qemu_fd_count="$(find "$qemu_fd_dir" -mindepth 1 -maxdepth 1 -type l 2>/dev/null | wc -l | tr -d '[:space:]')"
    [[ "$qemu_fd_count" =~ ^[0-9]+$ ]] || qemu_fd_count=-1
  fi

  if [[ -r "$PROC_ROOT/$qemu_pid/limits" ]]; then
    qemu_fd_limit="$(awk '$1 == "Max" && $2 == "open" && $3 == "files" { print $4; exit }' \
      "$PROC_ROOT/$qemu_pid/limits" 2>/dev/null)"
  fi
  [[ "$qemu_fd_limit" =~ ^[0-9]+$ ]] || qemu_fd_limit=-1

  declare -A qemu_socket_inodes=()
  if [[ -d "$qemu_fd_dir" ]]; then
    while IFS= read -r fd_path; do
      fd_target="$(readlink "$fd_path" 2>/dev/null || true)"
      if [[ "$fd_target" =~ ^socket:\[([0-9]+)\]$ ]]; then
        qemu_socket_inodes["${BASH_REMATCH[1]}"]=1
      fi
    done < <(find "$qemu_fd_dir" -mindepth 1 -maxdepth 1 -type l 2>/dev/null)
  fi

  for tcp_table in "$PROC_ROOT/net/tcp" "$PROC_ROOT/net/tcp6"; do
    [[ -r "$tcp_table" ]] || continue
    while read -r tcp_state tcp_inode; do
      [[ "$tcp_state" == "08" && -n "$tcp_inode" ]] || continue
      [[ -n "${qemu_socket_inodes[$tcp_inode]+present}" ]] || continue
      ((qemu_close_wait_count += 1))
    # /proc/net/tcp places inode in field 10; field 11 is the socket refcount.
    done < <(awk 'NR > 1 { print $4, $10 }' "$tcp_table" 2>/dev/null)
  done

  if [[ "$qemu_fd_count" =~ ^[0-9]+$ && "$qemu_fd_limit" =~ ^[0-9]+$ && \
        "$qemu_fd_limit" -gt 0 && "$FD_EXHAUSTION_PCT" =~ ^[0-9]+$ ]]; then
    fd_exhaustion_floor=$((qemu_fd_limit * FD_EXHAUSTION_PCT / 100))
    ((fd_exhaustion_floor < 1)) && fd_exhaustion_floor=1
    ((qemu_fd_count >= fd_exhaustion_floor)) && qemu_fd_exhausted=true
  fi

  # CLOSE_WAIT is the specific leak signature. Require substantial FD
  # occupancy as well, so a short-lived handful of stale sockets is not called
  # exhaustion while still making the observed 675/1024 incident fail closed.
  if [[ "$qemu_close_wait_count" =~ ^[0-9]+$ && "$CLOSE_WAIT_THRESHOLD" =~ ^[0-9]+$ && \
        "$qemu_close_wait_count" -ge "$CLOSE_WAIT_THRESHOLD" && \
        "$qemu_fd_count" =~ ^[0-9]+$ && "$qemu_fd_limit" =~ ^[0-9]+$ && \
        "$qemu_fd_limit" -gt 0 && "$CLOSE_WAIT_OCCUPANCY_PCT" =~ ^[0-9]+$ ]]; then
    close_wait_occupancy_floor=$((qemu_fd_limit * CLOSE_WAIT_OCCUPANCY_PCT / 100))
    ((close_wait_occupancy_floor < 1)) && close_wait_occupancy_floor=1
    ((qemu_fd_count >= close_wait_occupancy_floor)) && qemu_fd_exhausted=true
  fi
fi

# QEMU writes its stderr to the current log through an already-open file
# descriptor. Trim in place (rather than rename) so the running process keeps
# writing to the bounded inode, while retaining the newest diagnostic tail.
#
# The durable launcher rotates by creating qemu-<timestamp>.log and moving the
# qemu-current.log symlink. Bound both the configured current target and every
# rotated qemu log in that directory: limiting only the symlink leaves old
# inodes permanently outside the cap.
bound_qemu_log_file() {
  local log_path="$1"
  local log_size log_tmp
  [[ "$QEMU_LOG_MAX_BYTES" =~ ^[0-9]+$ && "$QEMU_LOG_MAX_BYTES" -gt 0 ]] || return 0
  [[ -f "$log_path" ]] || return 0
  if ! log_size="$(stat -c %s "$log_path" 2>/dev/null)"; then
    return 0
  fi
  [[ "$log_size" =~ ^[0-9]+$ && "$log_size" -gt "$QEMU_LOG_MAX_BYTES" ]] || return 0
  log_tmp="$(mktemp "${log_path}.cap.XXXXXX" 2>/dev/null || true)"
  [[ -n "$log_tmp" ]] || return 0
  if tail -c "$QEMU_LOG_MAX_BYTES" "$log_path" > "$log_tmp" 2>/dev/null && \
     cat "$log_tmp" > "$log_path" 2>/dev/null; then
    qemu_log_bounded=true
  fi
  rm -f "$log_tmp"
}

bound_qemu_log() {
  bound_qemu_log_file "$QEMU_LOG"
  [[ -d "$QEMU_LOG_DIR" ]] || return 0
  while IFS= read -r -d '' log_path; do
    # The configured path may be a symlink to the newest qemu-*.log, so the
    # target can be visited twice. The second pass is already under the cap
    # and is harmless; skip only an exact path match.
    [[ "$log_path" == "$QEMU_LOG" ]] && continue
    bound_qemu_log_file "$log_path"
  done < <(find "$QEMU_LOG_DIR" -maxdepth 1 -type f -name 'qemu-*.log' -print0 2>/dev/null)
}
bound_qemu_log

ssh_ok=false
if [[ "$qemu_fd_exhausted" == true ]]; then
  ssh_probe_skipped=true
else
  # One SSH round-trip proves both guest reachability and operator continuity.
  # A guest reboot keeps QEMU and SSH healthy while killing the sidecar; the
  # persistent operator.json then predates the new boot and points at a dead
  # PID/port. The old SSH-only probe called that exact state healthy
  # (EI-21650884970130146), leaving the staging witness silently dead.
  operator_probe=""
  if operator_probe="$(
    ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes \
      -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$SSH_HOST" '
        # macOS prints `{ sec = 1787873119, usec = 729032 }`. Matching
        # `.*sec` is wrong because it greedily lands on the later `usec` field.
        boot="$(sysctl -n kern.boottime 2>/dev/null \
          | cut -d= -f2 | cut -d, -f1 | tr -cd "0-9")"
        discovery="$HOME/.papercusp/operator.json"
        started=-1
        pid=-1
        port=-1
        pid_alive=0
        port_listening=0
        panic_epoch=0
        panic_file=""
        # Keep the timestamp of the newest kernel panic report across reboots.
        # A reboot can leave SSH healthy while the sidecar is dead; the panic
        # artifact is the only durable terminal-cause evidence in that state.
        # macOS users commonly default to zsh, whose NO_MATCHES option aborts
        # an unmatched glob before the loop body runs.  An empty report
        # directory is normal, so make the expansion produce zero words.
        if [ -n "${ZSH_VERSION:-}" ]; then
          setopt NULL_GLOB
        fi
        for candidate in "$HOME/Library/Logs/DiagnosticReports"/Kernel-*.panic \
                         "$HOME/Library/Logs/DiagnosticReports/Retired"/Kernel-*.panic \
                         "/Library/Logs/DiagnosticReports"/Kernel-*.panic \
                         "/Library/Logs/DiagnosticReports/Retired"/Kernel-*.panic; do
          [ -f "$candidate" ] || continue
          if ! candidate_epoch="$(stat -f %m "$candidate" 2>/dev/null)"; then
            continue
          fi
          case "$candidate_epoch" in ""|*[!0-9]*) continue ;; esac
          if [ "$candidate_epoch" -gt "$panic_epoch" ]; then
            panic_epoch="$candidate_epoch"
            panic_file="$candidate"
          fi
        done
        panic_report="${panic_file##*/}"
        if [ -f "$discovery" ]; then
          started="$(sed -nE "s/.*\"startedAt\"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p" "$discovery" | head -1)"
          pid="$(sed -nE "s/.*\"pid\"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p" "$discovery" | head -1)"
          port="$(sed -nE "s/.*\"port\"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p" "$discovery" | head -1)"
        fi
        case "$started" in ""|*[!0-9]*) started=-1 ;; esac
        case "$pid" in ""|*[!0-9]*) pid=-1 ;; esac
        case "$port" in ""|*[!0-9]*) port=-1 ;; esac
        if [ "$pid" -gt 0 ] 2>/dev/null && kill -0 "$pid" 2>/dev/null; then
          cmd="$(ps -o command= -p "$pid" 2>/dev/null)"
          # operator.json records the sidecar PID after it has started.  The
          # installed Server process may be launched bare (without --ensure),
          # while dev/boot wrappers commonly include that flag; both are the
          # same operator identity and must count as alive.
          case "$cmd" in *serve.mjs*) pid_alive=1 ;; esac
        fi
        if [ "$port" -gt 0 ] 2>/dev/null && \
           lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
          port_listening=1
        fi
        printf "%s|%s|%s|%s|%s|%s|%s|%s\n" \
          "${boot:--1}" "$started" "$pid" "$pid_alive" "$port" "$port_listening" \
          "$panic_epoch" "$panic_report"
      ' 2>/dev/null
  )"; then
    ssh_ok=true
  fi
  if [[ -n "$operator_probe" ]]; then
    IFS='|' read -r probe_boot_epoch probe_started_at_ms probe_pid \
      probe_pid_alive probe_port probe_port_listening probe_panic_epoch \
      probe_panic_report <<< "$operator_probe"
    if [[ "$probe_boot_epoch" =~ ^[0-9]+$ && \
          "$probe_started_at_ms" =~ ^-?[0-9]+$ && \
          "$probe_pid" =~ ^-?[0-9]+$ && \
          "$probe_pid_alive" =~ ^[01]$ && \
          "$probe_port" =~ ^-?[0-9]+$ && \
          "$probe_port_listening" =~ ^[01]$ ]]; then
      operator_probe_ok=true
      guest_boot_epoch="$probe_boot_epoch"
      operator_started_at_ms="$probe_started_at_ms"
      operator_pid="$probe_pid"
      operator_port="$probe_port"
      [[ "$probe_pid_alive" == 1 ]] && operator_pid_alive=true
      [[ "$probe_port_listening" == 1 ]] && operator_port_listening=true
      if [[ "$probe_panic_epoch" =~ ^[0-9]+$ ]]; then
        guest_panic_epoch="$probe_panic_epoch"
        guest_panic_report="$probe_panic_report"
        # When operator.json is absent (or has no valid startedAt), the
        # sidecar cannot provide the old "panic after operator start" ordering.
        # A panic report at/after the current guest boot is still definitive:
        # it belongs to this guest run even when sidecar start metadata is
        # unavailable, while older reports predate this boot epoch. Keep this
        # fail-closed so SSH reachability cannot mask a fresh kernel failure.
        if (( guest_panic_epoch > 0 && \
              ((operator_started_at_ms > 0 && \
                guest_panic_epoch * 1000 >= operator_started_at_ms) || \
               (operator_started_at_ms <= 0 && guest_boot_epoch > 0 && \
                guest_panic_epoch >= guest_boot_epoch)) )); then
          guest_kernel_panic=true
        fi
      fi
      if (( operator_started_at_ms > 0 && \
            operator_started_at_ms < guest_boot_epoch * 1000 )) && \
         [[ "$operator_pid_alive" == false || "$operator_port_listening" == false ]]; then
        operator_lost_after_reboot=true
      fi
    fi
  fi
fi

disk_age=-1
if [[ -e "$DISK_IMAGE" ]]; then
  now=$(date +%s)
  mtime=$(stat -c %Y "$DISK_IMAGE" 2>/dev/null || echo "$now")
  disk_age=$((now - mtime))
fi

qmp_running=false
qmp_probe_status=unavailable
qmp_cmd() {
  local execute="$1"
  if [[ -n "${MAC_VM_QMP_PROBE:-}" ]]; then
    "$MAC_VM_QMP_PROBE" "$execute"
    return
  fi
  python3 "$QMP_HELPER" "$QMP_SOCK" "$execute"
}
if [[ "$qemu_fd_exhausted" == true ]]; then
  qmp_probe_skipped=true
  qmp_probe_status=skipped
else
  if qmp_cmd query-status >/dev/null; then
    qmp_running=true
    qmp_probe_status=ok
  else
    qmp_rc=$?
    if [[ "$qmp_rc" == 75 ]]; then qmp_probe_status=slot-contended; fi
  fi
fi

status=unhealthy
detail="service is not active"
if [[ "$qemu_fd_exhausted" == true ]]; then
  status=fd-exhausted
  detail="QEMU FD capacity exhausted (${qemu_fd_count}/${qemu_fd_limit}) with ${qemu_close_wait_count} CLOSE_WAIT sockets; SSH/QMP probes skipped"
elif [[ "$ssh_ok" == true && "$guest_kernel_panic" == true ]]; then
  status=guest-kernel-panic
  if (( operator_started_at_ms > 0 )); then
    detail="guest kernel panic report ${guest_panic_report:-unknown} was written at epoch ${guest_panic_epoch} after operator start; preserve the report before recovery"
  else
    detail="guest kernel panic report ${guest_panic_report:-unknown} was written at/after guest boot epoch ${guest_boot_epoch}; operator metadata is unavailable, preserve the report before recovery"
  fi
elif [[ "$ssh_ok" == true && "$operator_lost_after_reboot" == true ]]; then
  status=operator-lost-after-reboot
  detail="guest rebooted after operator start; stale discovery pid=${operator_pid} port=${operator_port} is not backed by both its operator process (alive=${operator_pid_alive}) and listener (listening=${operator_port_listening})"
elif [[ "$ssh_ok" == true ]]; then
  status=healthy; detail="macOS guest SSH is reachable"
elif [[ "$qmp_probe_status" == slot-contended ]]; then
  status=qmp-slot-contended
  detail="QMP socket accepted a client but sent no greeting; another client may hold the single-client slot (QEMU main loop is not proven wedged)"
elif [[ "$service_active" == true && "$qmp_running" == true && "$disk_age" -ge "$STALE_SEC" ]]; then
  status=picker-suspect
  detail="QEMU is running but guest SSH is unreachable and disk writes are stale"
elif [[ "$service_active" == true && "$qmp_running" == true ]]; then
  status=booting
  detail="QEMU is running but guest SSH is not reachable yet"
elif [[ "$qemu_process_found" == true || "$service_active" == true ]]; then
  status=control-plane-unavailable
  detail="QEMU/SSH control plane is unavailable (service_active=${service_active} qemu_pid=${qemu_pid:-none})"
fi

recovery=not-requested
if [[ "$RECOVER" == 1 ]]; then
  if [[ "$status" != picker-suspect ]]; then
    echo "refusing recovery: status is $status, not picker-suspect" >&2
    exit 2
  fi
  # Liveness cannot identify the selected OpenCore entry. A real picker can
  # contain only Reset NVRAM and Toggle SIP, with Reset NVRAM selected. Never
  # turn this deliberately weak diagnosis into a destructive firmware action.
  echo "refusing recovery: picker-suspect does not verify the selected boot entry; capture the console with mac-vm-screenshot.sh and verify a macOS volume before navigating it" >&2
  exit 2
fi

if [[ "$JSON" == 1 ]]; then
  if [[ "$qemu_pid" =~ ^[0-9]+$ ]]; then qemu_pid_json="$qemu_pid"; else qemu_pid_json=null; fi
  printf '{"status":"%s","service_active":%s,"qemu_process_found":%s,"qemu_pid":%s,"qemu_fd_count":%s,"qemu_fd_limit":%s,"qemu_close_wait_count":%s,"qemu_fd_exhausted":%s,"ssh_ok":%s,"ssh_probe_skipped":%s,"operator_probe_ok":%s,"guest_boot_epoch":%s,"operator_started_at_ms":%s,"operator_pid":%s,"operator_pid_alive":%s,"operator_port":%s,"operator_port_listening":%s,"operator_lost_after_reboot":%s,"guest_kernel_panic":%s,"guest_panic_epoch":%s,"guest_panic_report":"%s","qmp_running":%s,"qmp_probe_status":"%s","qmp_probe_skipped":%s,"disk_age_sec":%s,"qemu_log_bounded":%s,"recovery":"%s","detail":"%s"}\n' \
    "$status" "$service_active" "$qemu_process_found" "$qemu_pid_json" \
    "$qemu_fd_count" "$qemu_fd_limit" "$qemu_close_wait_count" "$qemu_fd_exhausted" \
    "$ssh_ok" "$ssh_probe_skipped" "$operator_probe_ok" "$guest_boot_epoch" \
    "$operator_started_at_ms" "$operator_pid" "$operator_pid_alive" "$operator_port" \
    "$operator_port_listening" "$operator_lost_after_reboot" \
    "$guest_kernel_panic" "$guest_panic_epoch" "$guest_panic_report" \
    "$qmp_running" "$qmp_probe_status" "$qmp_probe_skipped" "$disk_age" \
    "$qemu_log_bounded" "$recovery" "$detail"
else
  printf 'mac-vm-health: %s — %s (service=%s ssh=%s operator_reboot=%s qmp=%s/%s fd=%s/%s close_wait=%s log_bounded=%s disk_age=%ss recovery=%s)\n' \
    "$status" "$detail" "$service_active" "$ssh_ok" "$operator_lost_after_reboot" \
    "$qmp_running" "$qmp_probe_status" \
    "$qemu_fd_count" "$qemu_fd_limit" "$qemu_close_wait_count" "$qemu_log_bounded" \
    "$disk_age" "$recovery"
fi

[[ "$status" == healthy || "$status" == booting ]]
