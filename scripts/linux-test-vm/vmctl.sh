#!/usr/bin/env bash
# Compatibility entrypoint for callers that infer a `.sh` suffix.
# Keep the implementation in the canonical `vmctl` executable.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/vmctl" "$@"
