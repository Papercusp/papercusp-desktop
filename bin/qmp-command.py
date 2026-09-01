#!/usr/bin/env python3
"""Run one QMP command with an explicit single-client greeting diagnostic.

QEMU's unix QMP chardev accepts a second client but sends it no greeting while
the first client owns the slot.  Exit 10 reserves that case so callers can
report socket contention instead of misdiagnosing a wedged QEMU main loop.
"""

from __future__ import annotations

import json
import os
import socket
import sys
from typing import NoReturn


GREETING_TIMEOUT_EXIT = 75  # sysexits.h EX_TEMPFAIL: another client may release the slot


def fail(message: str, code: int = 1) -> NoReturn:
    print(f"qmp-command: {message}", file=sys.stderr)
    raise SystemExit(code)


def main() -> int:
    if len(sys.argv) < 3:
        fail("usage: qmp-command.py SOCKET COMMAND [SCREENDUMP_PATH]")

    qmp_sock, execute = sys.argv[1:3]
    timeout = float(os.environ.get("PAPERCUSP_QMP_TIMEOUT_SEC", "4"))
    if timeout <= 0:
        fail("PAPERCUSP_QMP_TIMEOUT_SEC must be positive")

    payload: dict[str, object] = {"execute": execute}
    if execute == "send-key":
        payload["arguments"] = {"keys": [{"type": "qcode", "data": "ret"}]}
    elif execute == "screendump":
        if len(sys.argv) != 4 or not sys.argv[3]:
            fail("screendump requires an output PPM path")
        payload["arguments"] = {"filename": sys.argv[3]}
    elif len(sys.argv) != 3:
        fail(f"unexpected argument for {execute}")

    sock = socket.socket(socket.AF_UNIX)
    try:
        sock.settimeout(timeout)
        try:
            sock.connect(qmp_sock)
        except OSError as exc:
            fail(f"unable to connect to {qmp_sock}: {exc}")

        stream = sock.makefile("rwb", buffering=0)
        try:
            try:
                greeting = stream.readline()
            except socket.timeout:
                fail(
                    "QMP greeting timed out after connection; another client may hold "
                    "the single-client socket (QEMU main loop is not proven wedged)",
                    GREETING_TIMEOUT_EXIT,
                )
            if not greeting:
                fail("QMP socket closed before greeting")

            try:
                stream.write(b'{"execute":"qmp_capabilities"}\n')
                capabilities = stream.readline()
            except socket.timeout:
                fail("QMP capabilities response timed out")
            if not capabilities:
                fail("QMP socket closed during capabilities negotiation")
            try:
                capabilities_reply = json.loads(capabilities)
            except json.JSONDecodeError as exc:
                fail(f"invalid QMP capabilities response: {exc}")
            if "error" in capabilities_reply:
                fail(f"QMP capabilities error: {capabilities_reply['error']}")

            try:
                stream.write((json.dumps(payload) + "\n").encode())
                reply = stream.readline()
            except socket.timeout:
                fail(f"QMP {execute} response timed out")
            if not reply:
                fail(f"QMP socket closed before {execute} response")
            try:
                parsed = json.loads(reply)
            except json.JSONDecodeError as exc:
                fail(f"invalid QMP {execute} response: {exc}")
            if "error" in parsed:
                fail(f"QMP {execute} error: {parsed['error']}")
            if execute == "query-status" and parsed.get("return", {}).get("running") is not True:
                fail("VM is not running")
        finally:
            stream.close()
    finally:
        sock.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
