#!/usr/bin/env python3
"""Drop gitleaks findings that exist only because a scan fragment ended mid-token.

gitleaks reads a large file in fragments (about 100KB plus a bounded peek for a
safe boundary). A multi-megabyte minified line has no safe boundary, so a
fragment can end in the middle of an identifier. Detectors whose terminator
group ends in ``|$`` (generic-api-key and others) then match the truncated
identifier as if the file ended there, and the release gate fails on bytes that
do not exist in that shape (WI-6554700010030306; first seen in the desktop
0.0.32 cut, WI-6554700010030304).

For each reported finding this script re-asks gitleaks the same question over
the TRUE bytes: it rescans the flagged file alone without redaction (same
config, same relative path, so the same fragments and coordinates), takes the
finding's matched text, and rescans a small window of real bytes around every
occurrence of that text in the file. A real credential is followed by its real
terminator and reproduces in at least one window; a fragment artifact is
followed by more identifier bytes and reproduces in none. Only findings that
reproduce nowhere are dropped.

Every uncertain case fails closed (the finding is kept): an unmatched redacted
entry, a missing file, no occurrence of the matched text, too many occurrences,
no word-boundary-aligned window edge, or any gitleaks error.

Usage:
  gitleaks-fragment-recheck.py REPORT.json CONFIG.toml

Run from the directory the original ``gitleaks dir`` ran in, so report paths
resolve. REPORT.json is rewritten in place to the kept findings (redaction is
preserved: kept entries are copied from the original report). The dropped
entries are recorded, without matched text, in REPORT.json.fragment-artifacts.json.

Exit 0: no finding remains. Exit 1: at least one finding remains. Exit 2: the
recheck could not run; REPORT.json is left untouched.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GITLEAKS = os.environ.get('GITLEAKS_BIN', 'gitleaks')
# Context kept on each side of an occurrence. Matches of every default rule's
# keyword/assignment/terminator context fit well inside this.
WINDOW_CONTEXT = 512
# How far an edge may move outward to land beside a non-word byte, so `\b` and
# line-target allowlist regexes see the same boundary in the window as in the file.
EDGE_SLACK = 4096
# Occurrences with byte-identical windows (repeated bundled code) are scanned
# once; more distinct windows than this keeps the finding.
MAX_OCCURRENCES = 100_000
MAX_DISTINCT_WINDOWS = 64
COORDS = ('RuleID', 'StartLine', 'EndLine', 'StartColumn', 'EndColumn')
_WORD = re.compile(rb'[A-Za-z0-9_]')


class RecheckError(Exception):
    pass


def _gitleaks(cwd: Path, target: str, config: Path, report: Path, timeout: int) -> list[dict]:
    args = [GITLEAKS, 'dir', target, '--config', str(config), '--no-banner', '--log-level=error',
            '--redact=0', '--report-format=json', '--report-path', str(report)]
    try:
        result = subprocess.run(args, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RecheckError(f'gitleaks could not run ({type(error).__name__})') from None
    if result.returncode not in (0, 1):
        raise RecheckError(f'gitleaks exited {result.returncode}')
    try:
        text = report.read_text(encoding='utf-8')
    except OSError:
        raise RecheckError('gitleaks wrote no report') from None
    findings = json.loads(text) if text.strip() else []
    if not isinstance(findings, list):
        raise RecheckError('gitleaks report is not a list')
    return findings


def _is_word(data: bytes, index: int) -> bool:
    return 0 <= index < len(data) and bool(_WORD.fullmatch(data[index:index + 1]))


def _aligned_start(data: bytes, start: int) -> int | None:
    floor = max(0, start - EDGE_SLACK)
    while start > floor and _is_word(data, start - 1) and _is_word(data, start):
        start -= 1
    if start > 0 and _is_word(data, start - 1) and _is_word(data, start):
        return None
    return start


def _aligned_end(data: bytes, end: int) -> int | None:
    ceiling = min(len(data), end + EDGE_SLACK)
    while end < ceiling and _is_word(data, end - 1) and _is_word(data, end):
        end += 1
    if end < len(data) and _is_word(data, end - 1) and _is_word(data, end):
        return None
    return end


def _occurrences(data: bytes, needle: bytes) -> list[int]:
    found = []
    index = data.find(needle)
    while index != -1:
        found.append(index)
        if len(found) > MAX_OCCURRENCES:
            break
        index = data.find(needle, index + 1)
    return found


def _window(data: bytes, offset: int, length: int) -> tuple[bytes, int, int] | None:
    """The true bytes around one occurrence, edges aligned beside non-word bytes."""
    start = _aligned_start(data, max(0, offset - WINDOW_CONTEXT))
    end = _aligned_end(data, min(len(data), offset + length + WINDOW_CONTEXT))
    if start is None or end is None:
        return None
    return data[start:end], offset - start, offset - start + length


def _window_reproduces(work: Path, relative: str, window: tuple[bytes, int, int],
                       rule: str, config: Path, serial: int) -> bool:
    window_data, lo, hi = window
    window_root = work / f'w{serial}'
    window_file = window_root / relative
    window_file.parent.mkdir(parents=True, exist_ok=True)
    window_file.write_bytes(window_data)
    report = work / f'w{serial}.json'
    try:
        findings = _gitleaks(window_root, relative, config, report, timeout=120)
    finally:
        shutil.rmtree(window_root, ignore_errors=True)
        report.unlink(missing_ok=True)
    for finding in findings:
        if finding.get('RuleID') != rule:
            continue
        match = str(finding.get('Match', '')).encode('utf-8')
        # Any same-rule match over the occurrence's bytes is a real finding.
        position = window_data.find(match) if match else -1
        while position != -1:
            if position < hi and position + len(match) > lo:
                return True
            position = window_data.find(match, position + 1)
    return False


def _relative_target(file_name: str) -> str:
    path = Path(file_name)
    if path.is_absolute():
        return str(path.relative_to(path.anchor))
    if '..' in path.parts:
        raise RecheckError('report path escapes the scan directory')
    return str(path)


def recheck(report_path: Path, config: Path) -> tuple[list[dict], list[dict]]:
    original = json.loads(report_path.read_text(encoding='utf-8') or '[]')
    if not isinstance(original, list):
        raise RecheckError('report is not a list')
    kept: list[dict] = []
    audit: list[dict] = []
    by_file: dict[str, list[dict]] = {}
    for finding in original:
        by_file.setdefault(str(finding.get('File', '')), []).append(finding)

    work = Path(tempfile.mkdtemp(prefix='gitleaks-fragment-recheck.'))
    os.chmod(work, 0o700)
    try:
        serial = 0
        for file_name, findings in by_file.items():
            source = Path(file_name)
            if not file_name or not source.is_file():
                kept.extend(findings)
                audit.extend(_audit(f, 'kept', 'file-not-found') for f in findings)
                continue
            # Same file, same relative path, same config: same fragments, same coordinates.
            rescan = _gitleaks(Path.cwd(), file_name, config, work / 'file.json', timeout=1800)
            (work / 'file.json').unlink(missing_ok=True)
            unredacted = {tuple(f.get(k) for k in COORDS): f for f in rescan}
            data = source.read_bytes()
            relative = _relative_target(file_name)
            for finding in findings:
                twin = unredacted.get(tuple(finding.get(k) for k in COORDS))
                match = str(twin.get('Match', '')).encode('utf-8') if twin else b''
                if not match:
                    kept.append(finding)
                    audit.append(_audit(finding, 'kept', 'not-reproduced-by-file-rescan'))
                    continue
                offsets = _occurrences(data, match)
                windows = [_window(data, offset, len(match)) for offset in offsets]
                distinct = list(dict.fromkeys(w for w in windows if w is not None))
                if not offsets or len(offsets) > MAX_OCCURRENCES or None in windows \
                        or len(distinct) > MAX_DISTINCT_WINDOWS:
                    kept.append(finding)
                    reason = ('match-not-found' if not offsets else
                              'too-many-occurrences' if len(offsets) > MAX_OCCURRENCES else
                              'unaligned-window' if None in windows else 'too-many-distinct-windows')
                    audit.append(_audit(finding, 'kept', reason, len(offsets)))
                    continue
                reproduced = False
                for window in distinct:
                    serial += 1
                    if _window_reproduces(work, relative, window, str(finding.get('RuleID')),
                                          config, serial):
                        reproduced = True
                        break
                if reproduced:
                    kept.append(finding)
                    audit.append(_audit(finding, 'kept', 'reproduced-in-true-bytes', len(offsets)))
                else:
                    audit.append(_audit(finding, 'dropped', 'fragment-artifact', len(offsets),
                                        len(distinct)))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return kept, audit


def _audit(finding: dict, decision: str, reason: str, occurrences: int | None = None,
           windows: int | None = None) -> dict:
    entry = {key: finding.get(key) for key in ('File', *COORDS, 'Fingerprint')}
    entry.update(decision=decision, reason=reason)
    if occurrences is not None:
        entry['occurrences'] = occurrences
    if windows is not None:
        entry['distinctWindows'] = windows
    return entry


def _write_json(path: Path, value: object) -> None:
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=1) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.split('Usage:')[1].split('Exit 0')[0].strip(), file=sys.stderr)
        return 2
    report_path, config = Path(argv[1]), Path(argv[2])
    try:
        kept, audit = recheck(report_path, config)
    except (RecheckError, OSError, ValueError, UnicodeError) as error:
        print(f'gitleaks fragment recheck could not run: {error}; findings stand.', file=sys.stderr)
        return 2
    dropped = [entry for entry in audit if entry['decision'] == 'dropped']
    _write_json(report_path.with_name(report_path.name + '.fragment-artifacts.json'), audit)
    _write_json(report_path, kept)
    for entry in dropped:
        print(f"       fragment artifact dropped: {entry['File']} {entry['RuleID']} "
              f"line {entry['StartLine']} col {entry['StartColumn']}-{entry['EndColumn']} "
              f"(none of its {entry['occurrences']} occurrence(s), {entry['distinctWindows']} "
              f"distinct window(s), reproduces in the true bytes)", file=sys.stderr)
    print(f'gitleaks fragment recheck: {len(audit)} finding(s), {len(dropped)} fragment artifact(s) '
          f'dropped, {len(kept)} kept.', file=sys.stderr)
    return 1 if kept else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
