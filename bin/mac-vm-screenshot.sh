#!/bin/bash
# Run on the HOST (not the VM). Host-side QMP screendump — the canonical way to
# see the Mac VM's actual composited framebuffer with ZERO in-VM permissions.
#
# Why this exists (EI-9931 / see agent-insights/mac-vm-qmp-recovery.mdx):
# in-VM `screencapture -x` over ssh returns a white/blank image (Screen
# Recording TCC isn't granted to the ssh context, and there's no GPU-backed
# framebuffer for VirtIO to grab from); `screencapture -l <win>` fails
# ("could not create image from window"); osascript System Events is denied
# assistive access; and a JXA ObjC CGWindowListCopyWindowInfo probe SEGFAULTs
# (RC=139) over ssh. QMP screendump reads the actual emulated display straight
# from qemu and needs none of that.
#
# Usage:
#   mac-vm-screenshot.sh [output.png] [qmp-socket]
#
#   output.png   default: /tmp/mac-vm-screenshot-<timestamp>.png
#   qmp-socket   default: ~/macos-vm/OSX-KVM/qmp.sock (the durable launcher's
#                control socket — boot-sonoma-durable.sh only; the old
#                boot-sonoma.sh foreground launcher has no QMP socket)
#
# Exits non-zero with a clear message if the socket is missing/unreachable
# (VM not up under the durable launcher) or the conversion tool is absent.

set -euo pipefail

QMP_SOCK="${2:-$HOME/macos-vm/OSX-KVM/qmp.sock}"
QMP_HELPER="${MAC_VM_QMP_HELPER:-$(dirname "$0")/qmp-command.py}"
OUT_PNG="${1:-/tmp/mac-vm-screenshot-$(date +%Y%m%d-%H%M%S).png}"
TMP_PPM="$(mktemp /tmp/mac-vm-screendump-XXXXXX.ppm)"
trap 'rm -f "$TMP_PPM"' EXIT

if [ ! -S "$QMP_SOCK" ]; then
  echo "mac-vm-screenshot.sh: no QMP socket at $QMP_SOCK" >&2
  echo "  (the VM must be running under boot-sonoma-durable.sh — the old" >&2
  echo "  boot-sonoma.sh foreground launcher exposes no QMP control socket)" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "mac-vm-screenshot.sh: python3 not found (needed to speak QMP)" >&2
  exit 1
fi

if ! command -v convert >/dev/null 2>&1; then
  echo "mac-vm-screenshot.sh: ImageMagick 'convert' not found (needed for ppm->png)" >&2
  exit 1
fi

# The helper gives a connected-but-silent greeting its own exit code and
# message, avoiding the historical "wedged main loop" inference.
PAPERCUSP_QMP_TIMEOUT_SEC="${PAPERCUSP_QMP_TIMEOUT_SEC:-10}" \
  python3 "$QMP_HELPER" "$QMP_SOCK" screendump "$TMP_PPM"

convert "$TMP_PPM" "$OUT_PNG"

echo "mac-vm-screenshot.sh: wrote $OUT_PNG"
