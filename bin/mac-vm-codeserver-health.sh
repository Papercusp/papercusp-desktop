#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-vm-verify-build.sh does this rsync). Idempotent / re-runnable,
# read-only, non-disruptive.
#
# WI-3133 backlog dimension 8: "code-server bundled IDE health". Verifies the app's bundled
# code-server sidecar (spawned by spawn_code_server() in src-tauri/src/main.rs, consumed by the
# optional @papercupai/vscode-server dashboard plugin via PAPERCUSP_CODE_SERVER_URL) is actually
# alive, listening, serving the workbench HTML, and free of startup errors — NOT just that its
# process exists.
set +e

echo "=== code-server process ==="
ps aux | grep -iE 'code-server' | grep -v grep | sed -E 's/  +/ /g' | cut -c1-220

echo; echo "=== code-server listening port (bind-addr arg) ==="
CS_PORT=$(ps aux | grep -E 'code-server --bind-addr' | grep -v grep | grep -oE 'bind-addr [0-9.]+:[0-9]+' | grep -oE '[0-9]+$' | head -1)
echo "port=${CS_PORT:-<not found>}"

if [ -n "$CS_PORT" ]; then
  echo; echo "=== HTTP root (expect 200 + vscode workbench HTML) ==="
  ROOT_CODE=$(curl -s -o /tmp/mac_vm_cs_root.html -w '%{http_code}' --max-time 5 "http://127.0.0.1:${CS_PORT}/")
  echo "http_code=$ROOT_CODE bytes=$(wc -c < /tmp/mac_vm_cs_root.html 2>/dev/null)"
  grep -qi 'vscode-workbench' /tmp/mac_vm_cs_root.html && echo "workbench_html=present" || echo "workbench_html=MISSING"

  echo; echo "=== /healthz ==="
  HZ_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${CS_PORT}/healthz")
  echo "healthz_http_code=$HZ_CODE"
else
  echo "SKIP http checks — no code-server process/port found (bundled binary may be absent on this platform, e.g. Windows — see spawn_code_server() None-safety in main.rs)"
fi

echo; echo "=== PAPERCUSP_CODE_SERVER_URL env wired into the running serve.mjs (consumed by the vscode-server plugin's iframeUrlConfigKey) ==="
SERVE_PID=$(ps aux | grep 'serve.mjs --ensure' | grep -v grep | awk '{print $2}' | head -1)
if [ -n "$SERVE_PID" ]; then
  ps eww -p "$SERVE_PID" 2>/dev/null | tr ' ' '\n' | grep CODE_SERVER || echo "PAPERCUSP_CODE_SERVER_URL not found in env of pid $SERVE_PID"
else
  echo "serve.mjs process not found"
fi

echo; echo "=== code-server.log (last 30 lines, scanning for error/panic/EADDRINUSE) ==="
CS_LOG="$HOME/.papercusp/logs/code-server.log"
if [ -f "$CS_LOG" ]; then
  tail -n 30 "$CS_LOG"
  echo "--- error/panic grep ---"
  grep -iE 'error|panic|EADDRINUSE|ECONNREFUSED|fatal' "$CS_LOG" | grep -viE 'errorTelemetry|"error":\s*false' | tail -10
else
  echo "no log at $CS_LOG"
fi

echo; echo "=== extensions dir (populated only if the user has installed VS Code extensions) ==="
find "$HOME/.papercusp-workspaces/.shared/code-server/extensions" -maxdepth 1 2>/dev/null | head -10
