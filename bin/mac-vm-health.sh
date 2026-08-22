#!/usr/bin/env bash
# Host-side liveness probe for papercup-vm-mac.service. Unlike
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
PROC_ROOT="${MAC_VM_PROC_ROOT:-/proc}"
FD_EXHAUSTION_PCT="${MAC_VM_FD_EXHAUSTION_PCT:-90}"
CLOSE_WAIT_THRESHOLD="${MAC_VM_CLOSE_WAIT_THRESHOLD:-256}"
CLOSE_WAIT_OCCUPANCY_PCT="${MAC_VM_CLOSE_WAIT_OCCUPANCY_PCT:-75}"
QEMU_LOG_MAX_BYTES="${MAC_VM_QEMU_LOG_MAX_BYTES:-67108864}"
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
systemctl --user is-active --quiet papercup-vm-mac.service 2>/dev/null && service_active=true

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
    done < <(awk 'NR > 1 { print $4, $11 }' "$tcp_table" 2>/dev/null)
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
bound_qemu_log() {
  [[ "$QEMU_LOG_MAX_BYTES" =~ ^[0-9]+$ && "$QEMU_LOG_MAX_BYTES" -gt 0 ]] || return 0
  [[ -f "$QEMU_LOG" ]] || return 0
  log_size="$(stat -c %s "$QEMU_LOG" 2>/dev/null || echo 0)"
  [[ "$log_size" =~ ^[0-9]+$ && "$log_size" -gt "$QEMU_LOG_MAX_BYTES" ]] || return 0
  log_tmp="$(mktemp "${QEMU_LOG}.cap.XXXXXX" 2>/dev/null || true)"
  [[ -n "$log_tmp" ]] || return 0
  if tail -c "$QEMU_LOG_MAX_BYTES" "$QEMU_LOG" > "$log_tmp" 2>/dev/null && \
     cat "$log_tmp" > "$QEMU_LOG" 2>/dev/null; then
    qemu_log_bounded=true
  fi
  rm -f "$log_tmp"
}
bound_qemu_log

ssh_ok=false
if [[ "$qemu_fd_exhausted" == true ]]; then
  ssh_probe_skipped=true
else
  ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$SSH_HOST" true 2>/dev/null && ssh_ok=true
fi

disk_age=-1
if [[ -e "$DISK_IMAGE" ]]; then
  now=$(date +%s)
  mtime=$(stat -c %Y "$DISK_IMAGE" 2>/dev/null || echo "$now")
  disk_age=$((now - mtime))
fi

qmp_running=false
qmp_cmd() {
  local execute="$1"
  if [[ -n "${MAC_VM_QMP_PROBE:-}" ]]; then
    "$MAC_VM_QMP_PROBE" "$execute"
    return
  fi
  python3 - "$QMP_SOCK" "$execute" <<'PY'
import json, socket, sys
sock, execute = sys.argv[1:]
s = socket.socket(socket.AF_UNIX); s.settimeout(4); s.connect(sock)
f = s.makefile('rwb', buffering=0)
if not f.readline(): raise RuntimeError('QMP greeting missing (another client may hold the single-client socket)')
f.write(b'{"execute":"qmp_capabilities"}\n'); json.loads(f.readline())
payload = {"execute": execute}
if execute == "send-key":
    payload["arguments"] = {"keys":[{"type":"qcode","data":"ret"}]}
f.write((json.dumps(payload)+'\n').encode())
reply = json.loads(f.readline())
if 'error' in reply: raise RuntimeError(reply['error'])
if execute == 'query-status' and reply.get('return',{}).get('running') is not True: raise RuntimeError('VM is not running')
PY
}
if [[ "$qemu_fd_exhausted" == true ]]; then
  qmp_probe_skipped=true
else
  qmp_cmd query-status >/dev/null 2>&1 && qmp_running=true
fi

status=unhealthy
detail="service is not active"
if [[ "$qemu_fd_exhausted" == true ]]; then
  status=fd-exhausted
  detail="QEMU FD capacity exhausted (${qemu_fd_count}/${qemu_fd_limit}) with ${qemu_close_wait_count} CLOSE_WAIT sockets; SSH/QMP probes skipped"
elif [[ "$ssh_ok" == true ]]; then
  status=healthy; detail="macOS guest SSH is reachable"
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
  qmp_cmd send-key
  recovery=return-key-sent
fi

if [[ "$JSON" == 1 ]]; then
  if [[ "$qemu_pid" =~ ^[0-9]+$ ]]; then qemu_pid_json="$qemu_pid"; else qemu_pid_json=null; fi
  printf '{"status":"%s","service_active":%s,"qemu_process_found":%s,"qemu_pid":%s,"qemu_fd_count":%s,"qemu_fd_limit":%s,"qemu_close_wait_count":%s,"qemu_fd_exhausted":%s,"ssh_ok":%s,"ssh_probe_skipped":%s,"qmp_running":%s,"qmp_probe_skipped":%s,"disk_age_sec":%s,"qemu_log_bounded":%s,"recovery":"%s","detail":"%s"}\n' \
    "$status" "$service_active" "$qemu_process_found" "$qemu_pid_json" \
    "$qemu_fd_count" "$qemu_fd_limit" "$qemu_close_wait_count" "$qemu_fd_exhausted" \
    "$ssh_ok" "$ssh_probe_skipped" "$qmp_running" "$qmp_probe_skipped" "$disk_age" \
    "$qemu_log_bounded" "$recovery" "$detail"
else
  printf 'mac-vm-health: %s — %s (service=%s ssh=%s qmp=%s fd=%s/%s close_wait=%s log_bounded=%s disk_age=%ss recovery=%s)\n' \
    "$status" "$detail" "$service_active" "$ssh_ok" "$qmp_running" \
    "$qemu_fd_count" "$qemu_fd_limit" "$qemu_close_wait_count" "$qemu_log_bounded" \
    "$disk_age" "$recovery"
fi

[[ "$status" == healthy || "$status" == booting ]]
