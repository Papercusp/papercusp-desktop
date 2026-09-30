#!/usr/bin/env bash
# same-box-deploy.sh — the same-box rig's counterpart of bin/vm-rig/deploy.sh
# (plan physical-drill-iteration-speed-2026-09-29 D-003).
#
# deploy.sh installs the VM-side driver (vmcall.sh + mcp-call.mjs) on the macOS rig VM.
# The same-box "VM" lives on this box, so the driver goes into the rig directory, which is
# where rig-profile.sh points VM_CALL and VM_MCP_CALL. The scenario's
# ensure_vm_driver_current then checks the same digests it checks on the physical rig.
#
# Usage: same-box-deploy.sh same-box-vm   (any other host is refused)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
want_host="${SAME_BOX_HOST:-same-box-vm}"
[ "${1:-}" = "$want_host" ] \
  || { echo "same-box-deploy: refusing host '${1:-<none>}' — only '$want_host' is a same-box VM" >&2; exit 2; }
dir="${SAME_BOX_RIG_DIR:-${HIVE_GIT_SAME_BOX_RIG:-}}"
[ -n "$dir" ] && [ -d "$dir" ] \
  || { echo "same-box-deploy: no rig directory (SAME_BOX_RIG_DIR / HIVE_GIT_SAME_BOX_RIG)" >&2; exit 2; }
install -m 0755 "$HERE/../vmcall.sh" "$dir/vmcall.sh"
install -m 0644 "$ROOT/scripts/mcp-call.mjs" "$dir/mcp-call.mjs"
echo "same-box-deploy: installed vmcall.sh + mcp-call.mjs into $dir"
