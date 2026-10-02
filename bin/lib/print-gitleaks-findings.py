#!/usr/bin/env python3
"""Print safe gitleaks finding locators without printing matched values.

Gitleaks reports are written with --redact=100. This formatter deliberately
does not deserialize or print Match/Secret, so a release refusal can carry the
rule, file, line range, and rule description without putting the finding value
in the release log.
"""

from __future__ import annotations

import base64
import hashlib
import json
import mmap
import re
import sys
from collections import Counter
from pathlib import Path

MAX_LOCATORS = 50

_SEED_FIELDS = re.compile(rb'"(?P<field>__rekey|hbKey|writer_key)":"(?P<value>[^"\\]*)"')
_MATCH_FIELD = re.compile(r'^"?([A-Za-z_][A-Za-z_0-9]*)"\s*:')
_MESSAGE_ID = re.compile(rb'[a-z0-9]{8}-[0-9]{4}-[0-9a-f]{32}')
_UUID = re.compile(rb'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}')


def _seed_field_kind(field: str, value: bytes) -> str:
    if field == "__rekey":
        try:
            decoded = base64.b64decode(value, validate=True)
            if len(decoded) >= 40 and base64.b64encode(decoded) == value:
                return "ciphertext-envelope-framing"
        except ValueError:
            pass
    elif field == "hbKey" and _MESSAGE_ID.fullmatch(value):
        return "public-message-id"
    elif field == "writer_key":
        if value.startswith(b"su-") and _UUID.fullmatch(value[3:]):
            return "public-agent-id"
        if _UUID.fullmatch(value):
            return "public-session-id"
    return "unclassified"


def classify_seed_findings(blob_path: Path, findings: list[object]) -> dict[str, object]:
    """Diagnostic only: classify exact fields, never grant a release exception.

    A raw private report is required. Values stay in memory; the result contains
    only constant class names, offsets and counts. Index the source ONCE instead
    of searching a hundreds-of-MB blob once per finding. Only fragmented field
    names need a source search, cached by match digest for repeated findings.
    Canonical ciphertext framing is not a claim of cryptographic authentication.
    """
    counts: Counter[str] = Counter()
    residuals: list[dict[str, object]] = []
    searches = 0
    with blob_path.open("rb") as handle:
        if blob_path.stat().st_size == 0:
            return {"findings": len(findings), "classes": {"unclassified": len(findings)},
                    "indexPasses": 1, "fullBlobSearches": 0, "residuals": []}
        with mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as source:
            index: dict[tuple[str, bytes], str] = {}
            for match in _SEED_FIELDS.finditer(source):
                field = match.group("field").decode("ascii")
                value = match.group("value")
                index[(field, hashlib.sha256(value).digest())] = _seed_field_kind(field, value)
            fragments: dict[bytes, tuple[str, int]] = {}
            for finding in findings:
                if not isinstance(finding, dict) or finding.get("RuleID") != "generic-api-key":
                    counts["unclassified"] += 1
                    continue
                secret, text = finding.get("Secret"), finding.get("Match")
                if not isinstance(secret, str) or not isinstance(text, str) or secret == "REDACTED":
                    counts["unclassified"] += 1
                    continue
                field_match = _MATCH_FIELD.match(text)
                field = field_match.group(1) if field_match else ""
                digest = hashlib.sha256(secret.encode()).digest()
                kind = index.get((field, digest), "unclassified")
                if field not in {"__rekey", "hbKey", "writer_key"}:
                    # The scanner can split in the middle of a serialized field
                    # name. Recover context only for suffixes of our known fields.
                    if field and any(name.endswith(field) for name in ("__rekey", "hbKey", "writer_key")):
                        encoded = text.encode()
                        match_digest = hashlib.sha256(encoded).digest()
                        if match_digest not in fragments:
                            searches += 1
                            offset = source.find(encoded)
                            original = ""
                            if offset >= 0:
                                before = source[max(0, offset - 80):offset] + field.encode()
                                complete = re.search(rb'"(__rekey|hbKey|writer_key)$', before)
                                if complete:
                                    original = complete.group(1).decode("ascii")
                            fragments[match_digest] = (original, offset)
                        original, offset = fragments[match_digest]
                        kind = index.get((original, digest), "unclassified")
                        if len(residuals) < MAX_LOCATORS:
                            residuals.append({"originalField": original or "unclassified",
                                              "offset": offset, "class": kind})
                counts[kind] += 1
    return {"findings": len(findings), "classes": dict(counts), "indexPasses": 1,
            "fullBlobSearches": searches, "residuals": residuals}


def _single_line(value: object, fallback: str) -> str:
    text = " ".join(str(value or fallback).split())
    return text or fallback


def _safe_locator(raw_file: object, scan_root: str) -> str:
    """Return a scan-relative locator, never an absolute build-box path."""

    value = _single_line(raw_file, "<unknown-file>").replace("\\", "/")
    root = scan_root.strip("/").replace("\\", "/")
    root_prefix = f"{root.rstrip('/')}/" if root else ""
    if value.startswith(root_prefix):
        return value[len(root_prefix) :]
    if value.startswith("/"):
        absolute_marker = f"/{root_prefix}" if root_prefix else ""
        if absolute_marker and absolute_marker in value:
            return value.split(absolute_marker, 1)[1]
        # An unexpected path outside the scan root is still useful as a
        # basename, but must never disclose the build machine's directories.
        return Path(value).name or "<unknown-file>"
    return value.lstrip("./") or "<unknown-file>"


def main(argv: list[str]) -> int:
    if len(argv) == 4 and argv[1] == "--classify-seed":
        try:
            findings = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
            if not isinstance(findings, list):
                raise ValueError("report shape")
            result = classify_seed_findings(Path(argv[3]), findings)
        except (OSError, UnicodeError, ValueError):
            print("Seed finding classification could not be completed (values omitted).", file=sys.stderr)
            return 2
        print(json.dumps(result))
        return 0
    if len(argv) != 3:
        print("usage: print-gitleaks-findings.py REPORT_JSON SCAN_ROOT", file=sys.stderr)
        return 2

    report_path = Path(argv[1])
    scan_root = argv[2]
    try:
        findings = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        # Do not echo the path or parser exception: either could carry a host
        # path or scanner output into a release log.
        print("       Redacted gitleaks report could not be read.", file=sys.stderr)
        return 2

    if not isinstance(findings, list):
        print("       Redacted gitleaks report had an unexpected shape.", file=sys.stderr)
        return 2

    if not findings:
        print("       No structured finding details were recorded.", file=sys.stderr)
        return 0

    locators: Counter[tuple[str, str, str, str, str]] = Counter()
    malformed = 0
    for finding in findings:
        if not isinstance(finding, dict):
            malformed += 1
            continue
        rule_id = _single_line(finding.get("RuleID"), "<unknown-rule>")
        locator = _safe_locator(finding.get("File"), scan_root)
        start_line = _single_line(finding.get("StartLine"), "?")
        end_line = _single_line(finding.get("EndLine"), start_line)
        description = _single_line(finding.get("Description"), "<no-description>")
        locators[(rule_id, locator, start_line, end_line, description)] += 1
    print(
        f"       {len(findings)} finding records; {len(locators)} unique locators; "
        f"showing at most {MAX_LOCATORS} (matched values omitted).",
        file=sys.stderr,
    )
    for (rule_id, locator, start_line, end_line, description), count in list(locators.items())[:MAX_LOCATORS]:
        print(
            f"       - RuleID={rule_id} File={locator} "
            f"Lines={start_line}-{end_line} Occurrences={count} Description={description}",
            file=sys.stderr,
        )
    if len(locators) > MAX_LOCATORS:
        print(f"       {len(locators) - MAX_LOCATORS} additional locators retained in the private report.", file=sys.stderr)
    if malformed:
        print(f"       {malformed} malformed finding records (values omitted).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
