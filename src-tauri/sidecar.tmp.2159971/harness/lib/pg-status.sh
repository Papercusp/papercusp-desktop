# PHASE3-WRITE-STATUS — keep
# Sourced from run.sh. All Phase-3 PG writes go through this file.
# Future paperclip edits to run.sh's main flow won't clobber this;
# re-applying after a clobber is one find-and-replace, not three
# scattered patches.
#
# All functions are best-effort: failures log to stderr and continue.
# run.sh must never fail because of a status-write hiccup.
#
# Operator endpoint base: PAPERCUSP_OPERATOR_BASE (default :3055 for dev,
# injected by Tauri on the desktop sidecar with the dynamically-picked port).

_phase3_op_base() {
    echo "${PAPERCUSP_OPERATOR_BASE:-http://localhost:3055}"
}

_phase3_curl_post() {
    local url="$1" body="$2"
    curl -sf -X POST -H 'content-type: application/json' --max-time 5 \
        -H 'x-actor: run.sh' \
        -d "$body" "$url" >/dev/null 2>&1 \
        || echo "[pg-status.sh] POST $url failed (best-effort)" >&2
}

_phase3_curl_delete() {
    local url="$1"
    curl -sf -X DELETE --max-time 5 -H 'x-actor: run.sh' "$url" >/dev/null 2>&1 \
        || echo "[pg-status.sh] DELETE $url failed (best-effort)" >&2
}

# pg_write_status — write/update a harness_status row.
#
# Args (all required, but missing numeric args default to 0):
#   $1 slug
#   $2 phase (staging|testing|production)
#   $3 status (idle|running|stalled|paused|error)
#   $4 iteration (int)
#   $5 total_features (int)
#   $6 passed_count (int)
#   $7 todo_count (int)
#   $8 blocked_count (int)
#   $9 cost_usd (float, optional — passed as null if empty)
pg_write_status() {
    local slug="$1" phase="$2" status="$3"
    local iteration="${4:-0}"
    local total="${5:-0}" passed="${6:-0}" todo="${7:-0}" blocked="${8:-0}"
    local cost="${9:-}"
    local body
    body=$(PHASE="$phase" STATUS="$status" ITERATION="$iteration" \
           TOTAL="$total" PASSED="$passed" TODO="$todo" BLOCKED="$blocked" \
           COST="$cost" python3 -c "
import json, sys, os
out = {
    'phase': os.environ['PHASE'],
    'status': os.environ['STATUS'],
    'iteration': int(os.environ['ITERATION'] or 0),
    'totalFeatures': int(os.environ['TOTAL'] or 0),
    'passedCount': int(os.environ['PASSED'] or 0),
    'todoCount': int(os.environ['TODO'] or 0),
    'blockedCount': int(os.environ['BLOCKED'] or 0),
    'lastActiveTs': int(__import__('time').time() * 1000),
}
cost = os.environ.get('COST', '').strip()
if cost:
    try: out['costUsd'] = float(cost)
    except ValueError: pass
print(json.dumps(out))
" 2>/dev/null) || return 0
    _phase3_curl_post "$(_phase3_op_base)/api/harness/$slug/orchestrator/status" "$body"
}

# pg_write_lane — upsert one harness_lanes row.
#
# Args:
#   $1 slug
#   $2 phase
#   $3 role
#   $4 feature_id (optional)
#   $5 pid (optional — defaults to caller's $, i.e. the harness's bash pid)
#
# WHY explicit pid: the harness-status-sweep deletes lane rows whose
# recorded PID is gone (`kill -0 <pid>` fails). Earlier this function
# recorded `os.getpid()` of the python helper that builds the JSON
# body — python exits in <1s, so within ~30s the sweeper would always
# delete the lane. Symptom: dashboard ActiveAgentsBar showed "No
# agents in flight" while the harness was actively iterating.
#
# Pass the harness's bash pid ($ in the caller, or $BASHPID for a
# subshell) so liveness == "harness still running this iteration".
pg_write_lane() {
    local slug="$1" phase="$2" role="$3" feature_id="${4:-}" pid="${5:-$}"
    local body
    body=$(PHASE="$phase" ROLE="$role" FID="$feature_id" PID="$pid" python3 -c "
import json, os
out = { 'phase': os.environ['PHASE'], 'role': os.environ['ROLE'], 'pid': int(os.environ['PID']) }
fid = os.environ.get('FID', '').strip()
if fid: out['featureId'] = fid
print(json.dumps(out))
" 2>/dev/null) || return 0
    _phase3_curl_post "$(_phase3_op_base)/api/harness/$slug/orchestrator/lane" "$body"
}

# pg_clear_lanes — drop all lane rows for (slug, phase). Called at iteration end.
pg_clear_lanes() {
    local slug="$1" phase="$2"
    _phase3_curl_delete "$(_phase3_op_base)/api/harness/$slug/orchestrator/lanes?phase=$phase"
}

# pg_clear_running — clear the agent_runs.running flag for the harness.
# Called from a `trap EXIT` so graceful exits flush stale runs immediately
# (the sweeper would catch SIGKILL'd processes within ~30s anyway).
pg_clear_running() {
    local slug="$1"
    _phase3_curl_post "$(_phase3_op_base)/api/harness/$slug/orchestrator/clear-running" '{}'
}
