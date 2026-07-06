#!/bin/bash
# Run ON the Mac VM directly:
#   ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < papercusp-desktop/bin/mac-vm-working-set-roundtrip.sh
# or from a checkout already rsynced there (mac-vm-verify-build.sh does this rsync).
#
# WI-3133 dimension 7: functional data write -> Hyperbee projection -> read -> clear
# roundtrip through the packaged operator API. Non-destructive: it writes a synthetic
# working-set row for a synthetic feature/user id, then clears it before exit.
set -euo pipefail

HARNESS="${HARNESS:-papercusp}"
FEATURE_ID="${FEATURE_ID:-F-AUDIT-001}"
GITHUB_USER_ID="${GITHUB_USER_ID:-999999}"
POLL_ATTEMPTS="${POLL_ATTEMPTS:-12}"
POLL_SLEEP_SEC="${POLL_SLEEP_SEC:-2}"

json_body="{\"github_user_id\":${GITHUB_USER_ID}}"
set_done=0

discover_operator_port() {
  if [ -n "${OPERATOR_PORT:-}" ]; then
    echo "$OPERATOR_PORT"
    return 0
  fi

  local ports port code
  ports=$(lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null \
    | grep node \
    | grep -oE '127.0.0.1:[0-9]+|:[0-9]{4,5}' \
    | grep -oE '[0-9]{4,5}' \
    | sort -u)
  for port in $ports; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://127.0.0.1:${port}/api/health" 2>/dev/null || true)
    if [ "$code" = "200" ]; then
      echo "$port"
      return 0
    fi
  done
  return 1
}

working_set_url() {
  local action="${1:-}"
  if [ -n "$action" ]; then
    printf 'http://127.0.0.1:%s/api/harness/%s/working-set/%s/%s' "$PORT" "$HARNESS" "$FEATURE_ID" "$action"
  else
    printf 'http://127.0.0.1:%s/api/harness/%s/working-set' "$PORT" "$HARNESS"
  fi
}

get_working_set() {
  curl -fsS --max-time 5 "$(working_set_url)"
}

contains_active_row() {
  local body="$1"
  printf '%s' "$body" | grep -Fq "$FEATURE_ID" \
    && printf '%s' "$body" | grep -Eq "\"github_user_id\"[[:space:]]*:[[:space:]]*\"?${GITHUB_USER_ID}\"?"
}

post_action() {
  local action="$1"
  curl -fsS --max-time 10 \
    -H 'content-type: application/json' \
    -d "$json_body" \
    "$(working_set_url "$action")"
}

cleanup() {
  if [ "$set_done" = "1" ]; then
    post_action clear-active >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

PORT=$(discover_operator_port) || {
  echo "FAIL: could not discover packaged operator /api/health port" >&2
  exit 1
}

echo "=== Mac VM working-set roundtrip ==="
echo "operator_port=$PORT harness=$HARNESS feature=$FEATURE_ID github_user_id=$GITHUB_USER_ID"

echo
echo "=== baseline read ==="
baseline=$(get_working_set)
printf '%s\n' "$baseline" | head -c 500
echo

echo
echo "=== set-active ==="
post_action set-active
set_done=1
echo

echo
echo "=== poll for projected active row ==="
active_seen=0
for i in $(seq 1 "$POLL_ATTEMPTS"); do
  body=$(get_working_set)
  if contains_active_row "$body"; then
    active_seen=1
    echo "active_row_seen=1 attempt=$i"
    break
  fi
  echo "active_row_seen=0 attempt=$i"
  sleep "$POLL_SLEEP_SEC"
done
if [ "$active_seen" != "1" ]; then
  echo "FAIL: active row was not readable after set-active" >&2
  exit 1
fi

echo
echo "=== clear-active ==="
post_action clear-active
set_done=0
echo

echo
echo "=== poll for cleared row ==="
cleared_seen=0
for i in $(seq 1 "$POLL_ATTEMPTS"); do
  body=$(get_working_set)
  if ! contains_active_row "$body"; then
    cleared_seen=1
    echo "cleared_row_seen=1 attempt=$i"
    break
  fi
  echo "cleared_row_seen=0 attempt=$i"
  sleep "$POLL_SLEEP_SEC"
done
if [ "$cleared_seen" != "1" ]; then
  echo "FAIL: active row was still readable after clear-active" >&2
  exit 1
fi

echo
echo "PASS: working-set write/read/clear roundtrip succeeded"
