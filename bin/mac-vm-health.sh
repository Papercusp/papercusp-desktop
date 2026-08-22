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

ssh_ok=false
ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$SSH_HOST" true 2>/dev/null && ssh_ok=true

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
qmp_cmd query-status >/dev/null 2>&1 && qmp_running=true

status=unhealthy
if [[ "$service_active" == true ]]; then
  detail="service is active but QEMU/QMP is unavailable"
else
  detail="service is not active"
fi
if [[ "$ssh_ok" == true ]]; then
  status=healthy; detail="macOS guest SSH is reachable"
elif [[ "$service_active" == true && "$qmp_running" == true && "$disk_age" -ge "$STALE_SEC" ]]; then
  status=picker-suspect
  detail="QEMU is running but guest SSH is unreachable and disk writes are stale"
elif [[ "$service_active" == true && "$qmp_running" == true ]]; then
  status=booting
  detail="QEMU is running but guest SSH is not reachable yet"
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
  printf '{"status":"%s","service_active":%s,"ssh_ok":%s,"qmp_running":%s,"disk_age_sec":%s,"recovery":"%s","detail":"%s"}\n' \
    "$status" "$service_active" "$ssh_ok" "$qmp_running" "$disk_age" "$recovery" "$detail"
else
  printf 'mac-vm-health: %s — %s (service=%s ssh=%s qmp=%s disk_age=%ss recovery=%s)\n' \
    "$status" "$detail" "$service_active" "$ssh_ok" "$qmp_running" "$disk_age" "$recovery"
fi

[[ "$status" == healthy || "$status" == booting ]]
