#!/usr/bin/env python3
"""Print safe gitleaks finding locators without printing matched values.

Gitleaks reports are written with --redact=100. This formatter deliberately
does not deserialize or print Match/Secret, so a release refusal can carry the
rule, file, line range, and rule description without putting the finding value
in the release log.
"""

from __future__ import annotations

import base64
import ctypes
import ctypes.util
import fnmatch
import hashlib
import json
import mmap
import os
import re
import subprocess
import sys
import tempfile
import tarfile
from collections import Counter
from pathlib import Path

MAX_LOCATORS = 50

_SEED_FIELDS = re.compile(rb'"(?P<field>__rekey|hbKey|writer_key)":"(?P<value>[^"\\]*)"')
_MATCH_FIELD = re.compile(r'^"?([A-Za-z_][A-Za-z_0-9]*)"\s*:')
_MESSAGE_ID = re.compile(rb'[a-z0-9]{8}-[0-9]{4}-[0-9a-f]{32}')
_UUID = re.compile(rb'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}')
_PROOF_SCHEMA = "papercusp-seed-finding-proof-v1"
_SEED_CLASSES = {
    "authenticated-ciphertext-with-classified-plaintext", "public-agent-or-session-id",
    "public-coord-or-issue-id", "public-sender-verified-in-decrypted-source",
    "public-announced-event-reference",
}
_PLAIN_CLASSES = {
    "public-coord-sender-identifier", "descriptive-doc-part-category-list",
    "deliberately-invalid-localhost-auth-probe", "documented-minified-source-expression",
    "public-hypercore-log-key", "public-standing-fact-reference",
    "scanner-truncated-public-coord-sender",
}
_MECHANICAL_SEED_CLASSES = {"public-projection-row-key", "public-hypercore-log-key",
                            "recipient-sealed-epoch-key-envelope"}
_MECHANICAL_PLAIN_CLASSES = {
    "public-git-object-reference", "public-hash-or-log-reference",
    "public-condition-reference", "public-opaque-operation-reference",
    "public-schema-bound-reference", "reviewed-public-source-literal",
    "public-cryptographic-key", "reviewed-descriptive-source-text",
    "public-generated-agent-identifier",
    "public-non-bearer-field-reference",
}
_SEED_CLASSES |= _MECHANICAL_SEED_CLASSES
_PLAIN_CLASSES |= _MECHANICAL_PLAIN_CLASSES
_CREDENTIAL_FIELD = re.compile(r"token|secret|key|auth|password", re.IGNORECASE)
_ID_FIELDS = {"id", "issue_id", "msg_id", "condition_id", "operation_id", "request_id",
              "receipt_id", "event_id", "rubric_id", "rule_id", "task_id", "ref"}
_FROZEN_TREES = {"superproject": "d740fc3802877d1c8c3b1068768681ee32ef0025",
                 "desktop": "c864f7a1d1b62721a21dc8b0a576d51ff4edb345"}
_RESPAWN_MAKERS = {
    "packages/operator-core/lib/agent-tools/fleet_registry/respawn-member.ts":
        ("6662117f86f55049c335e7cf9f9c89882aaca298", {"hex16", "uuid4"}),
    "packages/operator-core/lib/fleet/member-recovery.ts":
        ("6d22fc28a9124ce58c5312d058c47813a3b0080c", {"hex16"}),
}
_RESPAWN_FIELDS = {"writer_key", "sender", "sender_id"}
_NON_BEARER_FIELDS = {"idempotencyKey", "conditionKey", "watchdogKey", "credentialSha256"}
_CREDENTIAL_DIGEST_VERIFIER = {
    "tree": "superproject",
    "path": "packages/operator-core/lib/work-item-admission-authority.ts",
    "blob": "f64c9f76696d7b28659345cad4441ec80675dad8",
}
_RUNTIME_SOURCE_PATHS = (
    "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs", "*.py", "*.rs",
    ":!*.test.*", ":!*.spec.*", ":!*/__tests__/*", ":!*/test/*", ":!*/tests/*",
)
_PROOF_FILES = (
    "ciphertext-auth-safe.json", "plaintext-classification-safe.json",
    "plaintext-exact-finding-digests.json", "seed-classification-verified-safe.json",
    "seed-exact-finding-digests.json", "seed-000080.plaintext.private.meta.json",
    "seed-000080.plaintext.private.json", "seed-000080.plaintext.jsonl",
    "seed-000080.private.meta.json", "seed-000080.private.json",
    "forbidden-literals.private.json",
)
_BASE_PROOF_FILES = _PROOF_FILES
_PROOF_FILES += ("mechanical-class-proof.private.json", "sealed-envelope-proof-safe.json",
                 "identity-secret-scan-safe.json")

# D-148: scanner findings alone missed a credential inside an issue body.
# The literal remains private; only its identity is part of the release contract.
_REQUIRED_FORBIDDEN_DIGESTS = {
    "4e77512c313a47d2e6f84c040beb7bf4ace649adc83be6bbd7ec26ff3a3fe912",
}


def verify_literal_absence(inputs: list[Path], literals: list[dict[str, str]],
                          required: set[str]) -> dict[str, object]:
    """Check actual bytes independently of scanner rules or finding digests."""
    if not inputs or not literals:
        raise ValueError("complete literal guard inputs required")
    values = []
    for entry in literals:
        value = entry.get("literal")
        if (not isinstance(value, str) or not value
                or hashlib.sha256(value.encode()).hexdigest() != entry.get("sha256")):
            raise ValueError("forbidden literal identity mismatch")
        values.append(value.encode())
    identities = {entry["sha256"] for entry in literals}
    if not required.issubset(identities):
        raise ValueError("required literal guard missing")
    inventory = []
    overlap = max(map(len, values)) - 1
    for path in inputs:
        if path.is_symlink() or not path.is_file():
            raise ValueError("invalid literal guard input")
        before = _sha256(path)
        previous = b""
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                if any(value in previous + chunk for value in values):
                    raise ValueError("forbidden literal remains")
                previous = chunk[-overlap:] if overlap else b""
        if _sha256(path) != before:
            raise ValueError("literal guard input changed")
        inventory.append({"path": str(path), "sha256": before})
    return {"schema": "papercusp-known-literal-absence-v1", "inputs": inventory,
            "literalDigests": sorted(identities), "rawLiteralHits": 0}


def _public_id(value: str) -> bool:
    raw = value.encode()
    return bool(_UUID.fullmatch(raw) or _MESSAGE_ID.fullmatch(raw)
                or (value.startswith("su-") and _UUID.fullmatch(raw[3:]))
                or re.fullmatch(r"(?:[a-z][a-z0-9-]*/)?(?:WI|EI|F|P)-[0-9]+", value)
                or re.fullmatch(r"0mu[a-z0-9]{16}", value))


def _canonical_base64(value: str, size: int) -> bytes:
    decoded = base64.b64decode(value, validate=True)
    if len(decoded) != size or base64.b64encode(decoded).decode() != value:
        raise ValueError("invalid public value encoding")
    return decoded


def _at_path(value: object, path: list[object]) -> object:
    if not isinstance(path, list) or not path:
        raise ValueError("exact field locator required")
    for part in path:
        if isinstance(value, dict) and isinstance(part, str):
            value = value[part]
        elif isinstance(value, list) and type(part) is int and 0 <= part < len(value):
            value = value[part]
        else:
            raise ValueError("invalid field locator")
    return value


def _embedded_reference(value: object, pointer: object) -> tuple[object, str]:
    """D-150 V4: exactly one JSON parse and an exact RFC 6901 pointer."""
    if (not isinstance(value, str) or not isinstance(pointer, str)
            or not pointer.startswith("/") or re.search(r"~(?![01])", pointer)):
        raise ValueError("typed embedded JSON locator required")
    value = json.loads(value)
    parts = [part.replace("~1", "/").replace("~0", "~")
             for part in pointer[1:].split("/")]
    for part in parts:
        if isinstance(value, dict):
            value = value[part]
        elif (isinstance(value, list) and re.fullmatch(r"0|[1-9][0-9]*", part)
              and int(part) < len(value)):
            value = value[int(part)]
        else:
            # A nested JSON string is not parsed a second time.
            raise ValueError("invalid embedded JSON pointer")
    return value, parts[-1]


def _manifest_publics(manifest: dict[str, object]) -> set[bytes]:
    result = set()
    for store in manifest.get("stores", []):
        meta = store.get("meta", {})
        values = list(meta.get("coreKeys", [])) + list(meta.get("coreLengths", {}))
        values += list(meta.get("coreProjectedFrom", {})) + list(meta.get("coreProjectedFrom", {}).values())
        for name in ("coreKey", "discoveryKey", "writerKey"):
            if name in meta:
                values.append(meta[name])
        for value in values:
            if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value):
                result.add(bytes.fromhex(value))
    return result


def _source_tree(ref: dict[str, object], trees: dict[str, object]) -> tuple[Path, str]:
    kind = ref.get("tree")
    tree = trees[kind]
    sha = tree["sha"]
    path = Path(tree["path"])
    if sha != _FROZEN_TREES.get(kind):
        raise ValueError("source tree is not the admitted release source")
    found = subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"], check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode().strip()
    if found != sha:
        raise ValueError("source tree changed")
    return path, sha


def validate_non_bearer_sources(field: str, witness: dict[str, object],
                                context: dict[str, object]) -> None:
    """D-149: exact frozen reader/writer citations, with a complete source census.

    This checks the citations themselves. Independent GO still reviews their
    meaning; a source witness alone never admits an occurrence.
    """
    if (field not in _NON_BEARER_FIELDS or witness.get("field") != field
            or witness.get("toolingSha256") != _sha256(Path(__file__))
            or witness.get("reviewRef") != "p2p-public-release-endgame-2026-09-01#D-149"):
        raise ValueError("closed non-bearer field source proof required")
    writers, readers = witness.get("writers", []), witness.get("readers", [])
    if not writers or not readers:
        raise ValueError("non-bearer writer and reader proofs required")
    refs = {(ref["tree"], ref["path"], ref["blob"]): ref for ref in [*writers, *readers]}
    cache = context.setdefault("_nonBearerSourceCache", {})
    identity = hashlib.sha256(json.dumps(witness, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if identity in cache:
        return
    observed = set()
    for tree in _FROZEN_TREES:
        path, sha = _source_tree({"tree": tree}, context["trees"])
        result = subprocess.run(["git", "-C", str(path), "grep", "-l", "-w", "-F", field,
                                 sha, "--", *_RUNTIME_SOURCE_PATHS],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if result.returncode not in (0, 1):
            raise ValueError("non-bearer source census failed")
        for line in result.stdout.decode().splitlines():
            prefix = sha + ":"
            if not line.startswith(prefix):
                raise ValueError("invalid frozen source census")
            relative = line[len(prefix):]
            matching = [key for key in refs if key[:2] == (tree, relative)]
            if len(matching) != 1:
                raise ValueError("non-bearer reader/writer census incomplete")
            observed.add(matching[0])
    if observed != set(refs):
        raise ValueError("non-bearer source census mismatch")
    for ref in refs.values():
        if not re.search(rb"\b" + field.encode() + rb"\b", _frozen_source_bytes(ref, context["trees"])):
            raise ValueError("field absent from cited source")
    if field == "credentialSha256":
        if witness.get("verifier") != _CREDENTIAL_DIGEST_VERIFIER:
            raise ValueError("credential digest verifier mismatch")
        content = _frozen_source_bytes(witness["verifier"], context["trees"])
        if any(snippet not in content for snippet in (
                b"createHash('sha256').update(bytes).digest('hex')",
                b"admissionCredentialDigest(token) !== authority.credentialSha256",
                b"admissionCredentialDigest(decodeOperatorSecretKey(key.value_b64, 'spawn-signing-key')) !== authority.credentialSha256")):
            raise ValueError("credential verifier does not hash the presented credential")
    cache[identity] = list(refs.values())


def non_bearer_reference_valid(field: str, value: str, witness: dict[str, object],
                               context: dict[str, object]) -> bool:
    validate_non_bearer_sources(field, witness, context)
    shape = witness.get("shape")
    if field == "credentialSha256":
        clearance = context.get("credentialDigestScan", {})
        return (shape == "hex64" and re.fullmatch(r"[0-9a-f]{64}", value) is not None
                and context.get("identityScanValidated") is True
                and value in clearance.get("digests", [])
                and clearance.get("digestOfCredentialHits") == 0
                and clearance.get("rawCredentialHits") == 0
                and clearance.get("hashControlDetected") is True
                and clearance.get("rawControlDetected") is True)
    if shape == "uuid":
        return _UUID.fullmatch(value.encode()) is not None and value in context.get("publicIds", set())
    if shape == "projection-id":
        parts = value.split("::", 1)
        return (len(parts) == 2 and re.fullmatch(r"[a-z][a-z0-9-]*", parts[0]) is not None
                and _public_id(parts[1]) and parts[1] in context.get("publicIds", set()))
    if shape in {"hex40", "hex64"}:
        return (re.fullmatch(r"[0-9a-f]{" + shape[3:] + r"}", value) is not None
                and value in context["publicReferences"])
    return False


def mechanical_class_valid(entry: dict[str, object], finding: dict[str, object],
                           context: dict[str, object], *, seed: bool) -> bool:
    """D-147 predicates re-derived from exact private findings and bound inputs."""
    kind = entry["class"]
    value = finding.get("Secret")
    match = finding.get("Match")
    if (entry.get("digest") != finding_digest(finding) or entry.get("rule") != finding.get("RuleID")
            or not isinstance(value, str) or not isinstance(match, str)):
        return False
    if seed:
        fields = context["seedFields"]
        if kind == "public-projection-row-key":
            parts = value.split("::", 1)
            field_match = _MATCH_FIELD.match(match)
            field = field_match.group(1) if field_match else ""
            return (finding["RuleID"] == "generic-api-key" and len(parts) == 2
                    and re.fullmatch(r"[a-z][a-z0-9-]*", parts[0]) is not None
                    and _public_id(parts[1])
                    and field in {"hbKey", "__rekey", "writer_key"} and (field, value) in fields)
        if kind == "public-hypercore-log-key":
            return (re.fullmatch(r"[0-9a-f]{64}", value) is not None
                    and bytes.fromhex(value) in context["publicKeys"])
        if kind == "recipient-sealed-epoch-key-envelope":
            return entry["digest"] in context.get("envelopeDigests", set())
        return False
    if kind == "reviewed-public-source-literal":
        ref = entry["sourceRef"]
        path, sha = _source_tree(ref, context["trees"])
        relative = ref["path"]
        if Path(relative).is_absolute() or ".." in Path(relative).parts:
            return False
        blob = subprocess.run(["git", "-C", str(path), "rev-parse", sha + ":" + relative], check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode().strip()
        if blob != ref["blob"]:
            return False
        content = subprocess.run(["git", "-C", str(path), "cat-file", "blob", blob], check=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
        return match.encode() in content and value.encode() in content
    if kind == "public-git-object-reference":
        if not re.fullmatch(r"[0-9a-f]{40}", value):
            return False
        path, _ = _source_tree(entry["sourceRef"], context["trees"])
        return subprocess.run(["git", "-C", str(path), "cat-file", "-e", value],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    row = context["plainRows"][int(finding["StartLine"])]
    locator = entry["fieldPath"]
    field = str(locator[-1])
    actual = _at_path(row, locator)
    if "embeddedJsonPointer" in entry:
        if kind not in {"public-hash-or-log-reference", "public-condition-reference",
                        "public-opaque-operation-reference", "public-schema-bound-reference",
                        "public-non-bearer-field-reference"}:
            return False
        actual, field = _embedded_reference(actual, entry["embeddedJsonPointer"])
    if kind == "public-non-bearer-field-reference":
        if (actual != value or field not in _NON_BEARER_FIELDS
                or finding["RuleID"] != "generic-api-key"
                or entry.get("line") != finding["StartLine"]
                or entry.get("rowSha256") != context["plainRowDigests"][int(finding["StartLine"])]):
            return False
        return non_bearer_reference_valid(field, value, context["nonBearerFields"][field], context)
    if kind == "public-cryptographic-key":
        return actual == value and _canonical_base64(value, 32) in context["publicKeys"]
    if kind == "reviewed-descriptive-source-text":
        return (finding["RuleID"] == "generic-api-key" and not _CREDENTIAL_FIELD.search(field)
                and isinstance(actual, str) and match in actual and value in actual
                and not _CREDENTIAL_FIELD.search((_MATCH_FIELD.match(match).group(1)
                                                  if _MATCH_FIELD.match(match) else "")))
    if kind == "public-generated-agent-identifier":
        if (actual != value or field not in _RESPAWN_FIELDS or finding["RuleID"] != "generic-api-key"
                or entry.get("line") != finding["StartLine"]
                or entry.get("rowSha256") != context["plainRowDigests"][int(finding["StartLine"])]):
            return False
        ref = entry["makerRef"]
        expected = _RESPAWN_MAKERS.get(ref.get("path"))
        if (not expected or ref.get("tree") != "superproject" or ref.get("blob") != expected[0]):
            return False
        if re.fullmatch(r"su-respawn-[0-9a-f]{32}", value):
            shape = "hex16"
        elif re.fullmatch(r"su-respawn-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", value):
            shape = "uuid4"
        else:
            return False
        if shape not in expected[1]:
            return False
        # Thousands of rows cite the same immutable Git blob. Verify it once
        # within this validation context, then re-check HEAD at the batch end.
        cache = context.setdefault("_makerProofCache", {})
        witness = (ref["tree"], ref["path"], ref["blob"])
        if witness not in cache:
            _frozen_source_bytes(ref, context["trees"])
            cache[witness] = dict(ref)
        check = scan_secret_key_bytes(value.encode(), set(), context["publicKeys"])
        return check["realFindings"] == 0 and check["derivationMatches"] == 0
    if actual != value or _CREDENTIAL_FIELD.search(field):
        return False
    if kind in {"public-condition-reference", "public-opaque-operation-reference",
                "public-schema-bound-reference"}:
        return field in context["idFields"] and field in _ID_FIELDS and _public_id(value)
    if kind == "public-hash-or-log-reference":
        if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value):
            return False
        return value in context["publicReferences"]
    return False


def _validate_mechanical_entries(entries: list[dict[str, object]], report: list[dict[str, object]],
                                 context: dict[str, object], *, seed: bool) -> None:
    added = _MECHANICAL_SEED_CLASSES if seed else _MECHANICAL_PLAIN_CLASSES
    by_digest = {finding_digest(finding): finding for finding in report}
    by_location = {(finding_digest(finding), finding["StartLine"]): finding for finding in report}
    for entry in entries:
        finding = (by_location[(entry["digest"], entry["line"])]
                   if entry["class"] in {"public-generated-agent-identifier", "public-non-bearer-field-reference"}
                   else by_digest[entry["digest"]])
        if entry["class"] in added and not mechanical_class_valid(
                entry, finding, context, seed=seed):
            raise ValueError("mechanical class predicate failed")
    for ref in context.get("_makerProofCache", {}).values():
        _source_tree(ref, context["trees"])
    for refs in context.get("_nonBearerSourceCache", {}).values():
        for ref in refs:
            _source_tree(ref, context["trees"])
    if not seed:
        counts = Counter()
        for entry in entries:
            if entry["class"] == "public-non-bearer-field-reference":
                row = context["plainRows"][int(entry["line"])]
                field = str(entry["fieldPath"][-1])
                if "embeddedJsonPointer" in entry:
                    _, field = _embedded_reference(_at_path(row, entry["fieldPath"]), entry["embeddedJsonPointer"])
                counts[field] += 1
        context["nonBearerCounts"] = {field: counts[field] for field in sorted(_NON_BEARER_FIELDS)}


def _table_ops(source: bytes, table: str) -> list[dict[str, object]]:
    decoder = json.JSONDecoder()
    pattern = rb'\{(?:"type":"put",)?"table":"' + re.escape(table.encode()) + rb'",'
    rows = []
    for found in re.finditer(pattern, source):
        # These are small public metadata rows. Oversized or incomplete rows
        # refuse the proof instead of silently reducing the population.
        text = source[found.start():found.start() + 4 * 1024 * 1024].decode("utf-8", errors="replace")
        row, _ = decoder.raw_decode(text)
        rows.append(row)
    return rows


def validate_envelope_structure(proof: dict[str, object], source: bytes,
                                report: list[dict[str, object]], epochs: set[int]) -> set[str]:
    members = _table_ops(source, "hive-members")
    recipients = {entry["device_pubkey"] for op in members
                  for entry in op["value"].get("device_attestations", [])}
    if len(recipients) != 33:
        raise ValueError("historical recipient population mismatch")
    for value in recipients:
        _canonical_base64(value, 32)
    rows = {op["hbKey"]: op for op in _table_ops(source, "hive-epoch-keys")}
    values = {}
    for op in rows.values():
        value = op["value"]
        if (value["harness_slug"] != "papercusp" or value["epoch"] not in epochs
                or value["member_device_pubkey"] not in recipients
                or op["hbKey"] != str(value["epoch"]) + ":" + value["member_device_pubkey"]):
            raise ValueError("epoch envelope membership mismatch")
        _canonical_base64(value["wrapped_key"], 80)
        values[value["wrapped_key"]] = op
    digests = set()
    count = 0
    for finding in report:
        if "wrapped_key" not in finding["Match"]:
            continue
        if (finding["RuleID"] != "generic-api-key" or finding["Secret"] not in values
                or finding["Match"].encode() not in source):
            raise ValueError("envelope exact finding mismatch")
        count += 1
        digests.add(finding_digest(finding))
    if (count != 62 or len(digests) != 62 or proof.get("count") != count
            or set(proof.get("digests", [])) != digests
            or set(proof.get("recipients", [])) != recipients
            or proof.get("sourceSha256") != hashlib.sha256(source).hexdigest()):
        raise ValueError("envelope count or digest set mismatch")
    return digests


def _read_extra_proof(proof: dict[str, object], directory: Path, name: str) -> object:
    path = directory / name
    _private_file(path)
    if proof.get("evidence", {}).get(name) != _sha256(path):
        raise ValueError("conditional evidence changed")
    return json.loads(path.read_text(encoding="utf-8"))


def _mechanical_context(proof: dict[str, object], directory: Path, root: Path,
                        source: Path, entries: list[dict[str, object]],
                        report: list[dict[str, object]], plain_report: list[dict[str, object]]) -> dict[str, object]:
    reference = _read_extra_proof(proof, directory, "mechanical-class-proof.private.json")
    if (reference.get("sourceSha256") != proof["sourceSha256"]
            or reference.get("plaintextSha256") != _sha256(directory / "seed-000080.plaintext.jsonl")):
        raise ValueError("mechanical proof input mismatch")
    manifest = json.loads((root / "manifest.json").read_text())
    publics = _manifest_publics(manifest)
    public_refs = set()
    for ref in reference.get("publicReferences", []):
        path = _source_file(root, ref["file"])
        field_path = ref["fieldPath"]
        if (_sha256(path) != ref["sourceSha256"]
                or not re.fullmatch(r"(?:sha256|sha|digest|hash|log_id|logId)", str(field_path[-1]))):
            raise ValueError("public reference source mismatch")
        value = _at_path(json.loads(path.read_text()), field_path)
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value):
            raise ValueError("invalid public reference value")
        public_refs.add(value)
    needed_lines = {int(row["StartLine"]) for row in plain_report}
    plain_rows = {}
    plain_digests = {}
    public_ids = set()
    with (directory / "seed-000080.plaintext.jsonl").open() as handle:
        for line, text in enumerate(handle, 1):
            row = json.loads(text)
            def collect_ids(value: object) -> None:
                if isinstance(value, dict):
                    for name, item in value.items():
                        if name in _ID_FIELDS and isinstance(item, str) and _public_id(item):
                            public_ids.add(item)
                        collect_ids(item)
                elif isinstance(value, list):
                    for item in value:
                        collect_ids(item)
            collect_ids(row)
            if line in needed_lines:
                plain_rows[line] = row
                plain_digests[line] = hashlib.sha256(text.encode()).hexdigest()
    data = source.read_bytes()
    fields = {(found.group("field").decode(), found.group("value").decode())
              for found in _SEED_FIELDS.finditer(data)}
    context = {"seedFields": fields, "publicKeys": publics, "plainRows": plain_rows,
               "plainRowDigests": plain_digests,
               "publicReferences": public_refs, "idFields": set(reference.get("idFields", [])),
               "trees": reference.get("trees", {}), "publicIds": public_ids,
               "nonBearerFields": reference.get("nonBearerFields", {})}
    has_envelopes = any(entry["class"] == "recipient-sealed-epoch-key-envelope" for entry in entries)
    # Plain entries are checked by the caller; a supplied closed field proof
    # requires the same full inventory scan, even in a non-metadata segment.
    has_non_bearer = bool(reference.get("nonBearerFields"))
    if has_envelopes or has_non_bearer:
        envelope = _read_extra_proof(proof, directory, "sealed-envelope-proof-safe.json")
        keys = json.loads((root / "epoch-keys.json").read_text())["papercusp"]
        if has_envelopes:
            context["envelopeDigests"] = validate_envelope_structure(envelope, data, report, {int(k) for k in keys})
            recipient_keys = {_canonical_base64(value, 32) for value in envelope["recipients"]}
        else:
            recipient_ref = reference["identityRecipientSource"]
            recipient_source = _source_file(root, recipient_ref["file"])
            if _sha256(recipient_source) != recipient_ref["sha256"]:
                raise ValueError("identity recipient source changed")
            recipient_data = recipient_source.read_bytes()
            members = _table_ops(recipient_data, "hive-members")
            encoded = {entry["device_pubkey"] for op in members
                       for entry in op["value"].get("device_attestations", [])}
            recipient_keys = {_canonical_base64(value, 32) for value in encoded}
            rows = _table_ops(recipient_data, "hive-epoch-keys")
            if len(recipient_keys) != 33 or not rows or set(envelope["recipients"]) != encoded:
                raise ValueError("historical recipient source incomplete")
            for op in rows:
                value = op["value"]
                if (value["harness_slug"] != "papercusp" or value["epoch"] not in {int(k) for k in keys}
                        or value["member_device_pubkey"] not in encoded
                        or op["hbKey"] != str(value["epoch"]) + ":" + value["member_device_pubkey"]):
                    raise ValueError("cross-segment recipient source mismatch")
                _canonical_base64(value["wrapped_key"], 80)
            if envelope["sourceSha256"] != recipient_ref["sha256"]:
                raise ValueError("recipient proof source mismatch")
        publics |= recipient_keys
        identity_scan = _read_extra_proof(proof, directory, "identity-secret-scan-safe.json")
        validate_identity_secret_proof(identity_scan, root, directory, recipient_keys, reference)
        context["identityScanValidated"] = True
        context["credentialDigestScan"] = identity_scan.get("credentialDigestScan", {})
    return context


def _secret_inventory(roots: list[Path]) -> set[Path]:
    # rglob does not traverse symlink directories. The link text is shipped
    # content; its host-resolved destination is not part of the artifact.
    return {Path(os.path.abspath(path)) for folder in roots for path in folder.rglob("*")
            if path.is_symlink() or path.is_file()}


def _secret_input_hash(path: Path) -> str:
    if path.is_symlink():
        return hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest()
    if not path.is_file():
        raise ValueError("secret scan input must be a file or symlink")
    return _sha256(path)


_IDENTITY_NAMES = ("*keychain*", "*keystore*", "*device-keypair*", "*.pem", "*.p8", "*.key")


def _identity_name_hit(path: Path) -> bool:
    return any(fnmatch.fnmatch(path.name.lower(), pattern) for pattern in _IDENTITY_NAMES)


def _frozen_source_bytes(ref: dict[str, object], trees: dict[str, object]) -> bytes:
    root, sha = _source_tree(ref, trees)
    relative = ref["path"]
    if (not isinstance(relative, str) or Path(relative).is_absolute()
            or ".." in Path(relative).parts):
        raise ValueError("invalid frozen source locator")
    blob = subprocess.run(["git", "-C", str(root), "rev-parse", sha + ":" + relative],
                          check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode().strip()
    if blob != ref["blob"]:
        raise ValueError("frozen source blob mismatch")
    return subprocess.run(["git", "-C", str(root), "cat-file", "blob", blob], check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout


def _vendored_package_bytes(ref: dict[str, object], trees: dict[str, object],
                            bundled_path: Path) -> bytes:
    """D-150/D-151: exact bundled package member and frozen sha512 integrity."""
    if ref["lockRef"].get("path") != "package-lock.json" or ref["lockRef"].get("tree") != "superproject":
        raise ValueError("frozen root package lock required")
    lock = json.loads(_frozen_source_bytes(ref["lockRef"], trees))
    package = lock["packages"][ref["packagePath"]]
    if (package["version"] != ref["version"] or package["integrity"] != ref["integrity"]
            or ref["packagePath"] != "node_modules/" + ref["name"]):
        raise ValueError("vendored certificate package mismatch")
    algorithm, encoded = ref["integrity"].split("-", 1)
    if algorithm != "sha512":
        raise ValueError("unsupported package integrity")
    archive = Path(ref["archive"])
    if archive.is_symlink() or not archive.is_file():
        raise ValueError("package archive required")
    before = _sha256(archive)
    digest = hashlib.new(algorithm)
    with archive.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    if base64.b64encode(digest.digest()).decode() != encoded:
        raise ValueError("package archive integrity mismatch")
    member = ref["member"]
    if not member.startswith("package/") or ".." in Path(member).parts:
        raise ValueError("invalid package member")
    suffix = "/node_modules/" + ref["name"] + "/" + member.removeprefix("package/")
    if not bundled_path.as_posix().endswith(suffix):
        raise ValueError("bundled package path mismatch")
    package_root = Path(bundled_path.as_posix()[:-len(member.removeprefix("package/"))])
    package_json = json.loads((package_root / "package.json").read_text())
    if package_json.get("name") != ref["name"] or package_json.get("version") != ref["version"]:
        raise ValueError("bundled package identity mismatch")
    with tarfile.open(archive) as handle:
        found = [row for row in handle.getmembers() if row.name == member]
        if len(found) != 1 or not found[0].isfile():
            raise ValueError("exact regular package member required")
        data = handle.extractfile(found[0]).read()
    if _sha256(archive) != before:
        raise ValueError("package archive changed")
    return data


def _dpkg_certificate_bytes(ref: dict[str, object], bundled_path: Path) -> bytes:
    """D-151 V2: .deb digest in the exact Packages index, not dpkg md5sums."""
    index = Path(ref["index"])
    archive = Path(ref["archive"])
    if (index.is_symlink() or archive.is_symlink() or _sha256(index) != ref["indexSha256"]
            or _sha256(archive) != ref["archiveSha256"]):
        raise ValueError("OS certificate provenance input mismatch")
    records = []
    for paragraph in index.read_text().split("\n\n"):
        record = dict(line.split(": ", 1) for line in paragraph.splitlines()
                      if ": " in line and not line.startswith(" "))
        if record.get("Package") == ref["name"] and record.get("Version") == ref["version"]:
            records.append(record)
    if not records or any(row.get("SHA256") != ref["archiveSha256"] for row in records):
        raise ValueError("OS certificate is not bound to apt Packages index")
    member = ref["member"]
    if (not isinstance(member, str) or not member.startswith("./")
            or ".." in Path(member).parts or not bundled_path.as_posix().endswith("/" + member[2:])):
        raise ValueError("OS certificate path mismatch")
    fields = subprocess.run(["dpkg-deb", "-f", str(archive), "Package", "Version"], check=True,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode().splitlines()
    if fields != ["Package: " + ref["name"], "Version: " + ref["version"]]:
        raise ValueError("OS certificate package identity mismatch")
    producer = subprocess.Popen(["dpkg-deb", "--fsys-tarfile", str(archive)],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    found = []
    try:
        with tarfile.open(fileobj=producer.stdout, mode="r|") as handle:
            for row in handle:
                if row.name == member:
                    if not row.isfile():
                        raise ValueError("OS certificate regular member required")
                    found.append(handle.extractfile(row).read())
        if producer.wait() != 0 or len(found) != 1:
            raise ValueError("OS certificate package member incomplete")
    finally:
        producer.stdout.close()
        if producer.poll() is None:
            producer.terminate()
            producer.wait()
    if _sha256(archive) != ref["archiveSha256"] or _sha256(index) != ref["indexSha256"]:
        raise ValueError("OS certificate provenance changed")
    return found[0]


def _parsed_public_certificates(data: bytes) -> list[dict[str, str]]:
    if any(label != b"CERTIFICATE" for label in re.findall(rb"-----BEGIN ([A-Z0-9 ]+)-----", data)):
        raise ValueError("non-certificate block in public certificate input")
    blocks = list(re.finditer(rb"-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\s]+)"
                             rb"-----END CERTIFICATE-----", data))
    if (not blocks or len(blocks) != data.count(b"-----BEGIN CERTIFICATE-----")
            or len(blocks) != data.count(b"-----END CERTIFICATE-----")):
        raise ValueError("complete public certificates required")
    result = []
    for block in blocks:
        parsed = subprocess.run(["openssl", "x509", "-inform", "PEM", "-noout",
                                 "-sha256", "-fingerprint", "-subject", "-nameopt", "RFC2253"],
                                input=block.group(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if parsed.returncode != 0:
            raise ValueError("public certificate parse failed")
        lines = parsed.stdout.decode().splitlines()
        fingerprint = lines[0].split("=", 1)[1].replace(":", "").lower()
        subject = lines[1].removeprefix("subject=")
        if not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
            raise ValueError("public certificate fingerprint invalid")
        result.append({"sha256": fingerprint, "subject": subject})
    return result


def validate_identity_name_exclusions(entries: list[dict[str, object]], inputs: set[Path],
                                      recipients: set[bytes], publics: set[bytes],
                                      trees: dict[str, object]) -> dict[str, int]:
    """D-150 V1/V2: exact file digests, re-derived provenance and key checks."""
    seen = set()
    counts = Counter()
    for entry in entries:
        path = Path(os.path.abspath(entry["path"]))
        if (path in seen or path not in inputs or path.is_symlink() or not path.is_file()
                or not _identity_name_hit(path) or _sha256(path) != entry["sha256"]):
            raise ValueError("identity name exclusion input mismatch")
        data = path.read_bytes()
        key_check = scan_secret_key_bytes(data, recipients, publics)
        private_der = subprocess.run(["openssl", "pkey", "-inform", "DER", "-noout"],
                                     input=data, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if key_check["realFindings"] != 0 or private_der.returncode == 0:
            raise ValueError("private material cannot be name-excluded")
        kind = entry["class"]
        if "packageRef" in entry:
            relative = entry["packageRef"]["member"]
            if relative in {"package/test/fixtures/https_key.pem",
                            "package/examples/advanced/create-react-native-app/android/app/debug.keystore"}:
                raise ValueError("vendor private-key fixture cannot be excluded")
        if kind == "frozen-public-source-vocabulary":
            if ("sourceRef" in entry) == ("packageRef" in entry):
                raise ValueError("one source provenance required")
            provenance = (_frozen_source_bytes(entry["sourceRef"], trees) if "sourceRef" in entry
                          else _vendored_package_bytes(entry["packageRef"], trees, path))
            if provenance != data:
                raise ValueError("public source exclusion bytes mismatch")
        elif kind == "parsed-public-x509-certificate":
            certificates = _parsed_public_certificates(data)
            if certificates != entry["certificates"]:
                raise ValueError("public certificate identity mismatch")
            if sum(name in entry for name in ("sourceRef", "packageRef", "debRef")) != 1:
                raise ValueError("one certificate provenance required")
            provenance = (_frozen_source_bytes(entry["sourceRef"], trees) if "sourceRef" in entry
                          else _vendored_package_bytes(entry["packageRef"], trees, path) if "packageRef" in entry
                          else _dpkg_certificate_bytes(entry["debRef"], path))
            if provenance != data:
                raise ValueError("public certificate provenance bytes mismatch")
        else:
            raise ValueError("unsupported identity name exclusion")
        if _sha256(path) != entry["sha256"]:
            raise ValueError("identity name exclusion input changed")
        seen.add(path)
        counts[entry["sha256"]] += 1
    return dict(sorted(counts.items()))


def validate_identity_secret_proof(scan: dict[str, object], root: Path, directory: Path,
                                   recipients: set[bytes], reference: dict[str, object]) -> None:
    if (scan.get("schema") != "papercusp-sealed-envelope-secret-scan-v1"
            or scan.get("seedRootSha") != _sha256(root / "manifest.json")
            or scan.get("scannerSha256") != _sha256(Path(__file__))
            or scan.get("recipientSetSha256") != hashlib.sha256(
                json.dumps(sorted(value.hex() for value in recipients), separators=(",", ":")).encode()).hexdigest()
            or any(scan.get(name) != 0 for name in ("realFindings", "derivationMatches", "rawSkMatches", "nameScanHits"))
            or scan.get("positivePlantedSecretDetected") is not True
            or not isinstance(scan.get("tokensChecked"), int)):
        raise ValueError("identity secret scan failed")
    bundles = [Path(value) for value in reference["bundleRoots"]]
    plaintext_root = Path(reference.get("plaintextRoot", str(directory)))
    if not bundles or any(not bundle.is_dir() or bundle.is_symlink() for bundle in bundles):
        raise ValueError("assembled bundle input required")
    expected = _secret_inventory([root, *bundles])
    expected |= {Path(os.path.abspath(_source_file(plaintext_root, value)))
                 for value in reference["plaintextInputs"]}
    inputs = scan.get("inputs", [])
    if (len(inputs) != len(expected)
            or {Path(os.path.abspath(row["path"])) for row in inputs} != expected):
        raise ValueError("identity secret scan inventory incomplete")
    for row in inputs:
        path = Path(row["path"])
        kind = "symlink-target" if path.is_symlink() else "file"
        if row.get("contentKind", "file") != kind or _secret_input_hash(path) != row["sha256"]:
            raise ValueError("identity secret scan input changed")
    manifest = json.loads((root / "manifest.json").read_text())
    exclusions = scan.get("nameExclusions", [])
    counts = validate_identity_name_exclusions(exclusions, expected, recipients,
                                              _manifest_publics(manifest), reference.get("trees", {}))
    if (scan.get("nameExclusionCounts", {}) != counts
            or len(exclusions) != sum(_identity_name_hit(path) for path in expected)):
        raise ValueError("identity name exclusions incomplete")
    if "credentialDigestScan" in scan:
        digest_scan = scan["credentialDigestScan"]
        digests = digest_scan.get("digests", [])
        if (not digests or len(digests) != len(set(digests))
                or any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in digests)
                or any(digest_scan.get(name) != 0 for name in ("digestOfCredentialHits", "rawCredentialHits"))
                or any(digest_scan.get(name) is not True for name in ("hashControlDetected", "rawControlDetected"))
                or not re.fullmatch(r"[0-9a-f]{64}", str(digest_scan.get("plantedSha256", "")))):
            raise ValueError("credential digest exposure scan failed")
    controls = scan.get("controls", [])
    encodings = {"der-base64", "pem", "jwk-d", "hex-seed", "base64-seed", "raw-sodium-secret"}
    samples = {}
    for row in controls:
        if (row.get("detected") is not True or row.get("derivationDetected") is not True
                or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("plantedSha256", "")))
                or row.get("inputSha256") not in {entry["sha256"] for entry in inputs}):
            raise ValueError("identity secret positive control failed")
        samples.setdefault(row["inputSha256"], set()).add(row["encoding"])
    plain_hashes = {_sha256(_source_file(plaintext_root, path)) for path in reference["plaintextInputs"]}
    bundle_hashes = {_secret_input_hash(path) for path in _secret_inventory(bundles)}
    if (not any(digest in plain_hashes and kinds == encodings for digest, kinds in samples.items())
            or not any(digest in bundle_hashes and kinds == encodings for digest, kinds in samples.items())):
        raise ValueError("seed and bundle planted controls required")

# D-142/D-147: recognize complete private-key material, including raw seeds
# whose derived public key belongs to a recipient. Source vocabulary by itself
# (a PEM header or a service name in code) is not a serialized private key.
_ED25519_DER_PREFIX = bytes.fromhex("302e020100300506032b657004220420")
_X25519_DER_PREFIX = bytes.fromhex("302e020100300506032b656e04220420")
_KEY_TOKENS = re.compile(rb"(?<![A-Za-z0-9_+/=-])(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{64}|[A-Za-z0-9_+/-]{86}={0,2}|[A-Za-z0-9_+/-]{43}=?)(?![A-Za-z0-9_+/=-])")
_PEM_PRIVATE = re.compile(rb"-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----\s+([A-Za-z0-9+/=\s]+)-----END \1-----")
_PRIVATE_JWK = re.compile(rb'\{[^{}]{0,16384}"kty"\s*:\s*"(?:OKP|RSA|EC)"[^{}]{0,16384}\}')


def _sodium():
    name = ctypes.util.find_library("sodium")
    if not name:
        raise ValueError("secret-key derivation scanner unavailable")
    library = ctypes.CDLL(name)
    if library.sodium_init() < 0:
        raise ValueError("secret-key derivation scanner unavailable")
    for function, arity in (("crypto_sign_seed_keypair", 3),
                            ("crypto_sign_ed25519_pk_to_curve25519", 2),
                            ("crypto_scalarmult_base", 2)):
        method = getattr(library, function)
        method.argtypes = [ctypes.c_void_p] * arity
        method.restype = ctypes.c_int
    return library


def _key_publics(sodium, seed: bytes) -> tuple[bytes, bytes]:
    ed = ctypes.create_string_buffer(32)
    secret = ctypes.create_string_buffer(64)
    curve = ctypes.create_string_buffer(32)
    if sodium.crypto_sign_seed_keypair(ed, secret, seed) != 0:
        raise ValueError("Ed25519 derivation failed")
    if sodium.crypto_scalarmult_base(curve, seed) != 0:
        raise ValueError("X25519 derivation failed")
    return ed.raw, curve.raw


def scan_secret_key_bytes(data: bytes, recipients: set[bytes],
                          public_keys: set[bytes] | None = None) -> dict[str, int]:
    """Read-only, value-free detector shared by real input and planted controls."""
    sodium = _sodium()
    curve_recipients = set()
    for public in recipients:
        if len(public) != 32:
            raise ValueError("invalid recipient public key")
        curve = ctypes.create_string_buffer(32)
        if sodium.crypto_sign_ed25519_pk_to_curve25519(curve, public) != 0:
            raise ValueError("invalid Ed25519 recipient public key")
        curve_recipients.add(curve.raw)
    seeds: set[bytes] = set()
    public_keys = public_keys or set()
    serialized = 0
    raw_sk_matches = 0
    if len(data) in (32, 64):
        seeds.add(data[:32])

    def der(value: bytes) -> bool:
        nonlocal serialized
        found = False
        for prefix in (_ED25519_DER_PREFIX, _X25519_DER_PREFIX):
            offset = 0
            while True:
                offset = value.find(prefix, offset)
                if offset < 0:
                    break
                end = offset + len(prefix) + 32
                if end <= len(value):
                    seeds.add(value[offset + len(prefix):end])
                    serialized += 1
                    found = True
                offset += 1
        return found

    der(data)
    # A raw libsodium Ed25519 secret is seed || public. Search recipient public
    # bytes first, then derive the preceding seed; random ciphertext is not a key.
    for public in recipients | public_keys:
        offset = data.find(public)
        while offset >= 0:
            if offset >= 32:
                seed = data[offset - 32:offset]
                derived, _ = _key_publics(sodium, seed)
                if derived == public:
                    seeds.add(seed)
                    serialized += 1
                    raw_sk_matches += 1
            offset = data.find(public, offset + 1)
    # Complete DER, not its prefix, represented as hex or base64.
    for pattern, decode in (
        (rb"(?<![0-9a-fA-F])(?:" + _ED25519_DER_PREFIX.hex().encode() + b"|" + _X25519_DER_PREFIX.hex().encode() + rb")[0-9a-fA-F]{64}(?![0-9a-fA-F])", lambda value: bytes.fromhex(value.decode("ascii"))),
        (rb"(?<![A-Za-z0-9+/])MC4CAQAwBQYDK2V[wu]BCIEI[A-Za-z0-9+/]{43}(?![A-Za-z0-9+/])", base64.b64decode),
    ):
        for match in re.finditer(pattern, data):
            der(decode(match.group()))
    for match in _PEM_PRIVATE.finditer(data):
        value = base64.b64decode(re.sub(rb"\s", b"", match.group(2)), validate=True)
        if not der(value):
            # Other complete PEM private-key formats are also private material.
            serialized += 1
    for match in _PRIVATE_JWK.finditer(data):
        try:
            value = json.loads(match.group())
        except (ValueError, UnicodeDecodeError):
            continue
        if isinstance(value, dict) and isinstance(value.get("d"), str):
            raw = base64.urlsafe_b64decode(value["d"] + "=" * (-len(value["d"]) % 4))
            if value.get("crv") in {"Ed25519", "X25519"} and len(raw) in (32, 64):
                seeds.add(raw[:32])
            if raw:
                serialized += 1
    for match in _KEY_TOKENS.finditer(data):
        token = match.group()
        try:
            raw = (bytes.fromhex(token.decode()) if re.fullmatch(rb"[0-9a-fA-F]{64}|[0-9a-fA-F]{128}", token)
                   else base64.b64decode(token.replace(b"-", b"+").replace(b"_", b"/") + b"=" * (-len(token) % 4), validate=True))
        except ValueError:
            continue
        if len(raw) in (32, 64):
            seeds.add(raw[:32])
            if len(raw) == 64:
                public, _ = _key_publics(sodium, raw[:32])
                if raw[32:] == public:
                    serialized += 1
    matches = 0
    for seed in seeds:
        ed, curve = _key_publics(sodium, seed)
        if ed in recipients | public_keys or curve in curve_recipients | public_keys:
            matches += 1
    pem_blocks = len(list(_PEM_PRIVATE.finditer(data)))
    marker_hits = (data.count(b"BEGIN PRIVATE KEY") +
                   data.count(b"BEGIN OPENSSH PRIVATE KEY") +
                   data.count(b"BEGIN ENCRYPTED PRIVATE KEY") +
                   data.count(b"papercusp-hive-epoch-key") +
                   data.count(b"papercusp-device-keypair"))
    dumps = len(list(re.finditer(
        rb'papercusp-(?:hive-epoch-key|device-keypair)[^\n]{0,256}"value"\s*:\s*"[A-Za-z0-9_+/=-]{43,}"', data)))
    return {"realFindings": serialized + matches + dumps,
            "derivationMatches": matches, "tokensChecked": len(seeds),
            "rawSkMatches": raw_sk_matches,
            "literalOnlyMarkers": max(0, marker_hits - pem_blocks - dumps)}


def scan_identity_secret_inputs(inputs: list[Path], recipients: set[bytes],
                                control_samples: list[Path], *,
                                name_exclusions: list[dict[str, object]] | None = None,
                                trees: dict[str, object] | None = None,
                                public_keys: set[bytes] | None = None,
                                credential_digests: set[str] | None = None) -> dict[str, object]:
    """Scan an explicit complete inventory and run controls only in memory.

    The caller binds the inventory to seed/assembled-bundle or final artifacts.
    This never extracts containers implicitly: finished installers need their
    expanded contents in the inventory, through the existing artifact auditor.
    """
    if (not inputs or not control_samples or any(path not in inputs for path in control_samples)
            or any(path.is_symlink() or not path.is_file() for path in control_samples)):
        raise ValueError("complete inventory and real control samples required")
    totals = Counter()
    digest_totals = Counter()
    credential_digests = credential_digests or set()
    if any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in credential_digests):
        raise ValueError("invalid credential digest candidate")
    inventory = []
    name_exclusions = name_exclusions or []
    public_keys = public_keys or set()
    exclusion_counts = validate_identity_name_exclusions(name_exclusions, set(inputs), recipients,
                                                         public_keys, trees or {})
    excluded = {Path(os.path.abspath(entry["path"])) for entry in name_exclusions}
    for path in inputs:
        kind = "symlink-target" if path.is_symlink() else "file"
        before = _secret_input_hash(path)
        # Chunk overlap covers the scanner's largest bounded JWK serialization.
        # It keeps large full-history bundles out of Python heap allocations.
        if kind == "symlink-target":
            content = os.fsencode(os.readlink(path))
            totals.update(scan_secret_key_bytes(content, recipients, public_keys))
            digest_totals.update(scan_credential_digest_bytes(content, credential_digests))
        else:
            with path.open("rb") as handle:
                previous = b""
                for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
                    totals.update(scan_secret_key_bytes(previous + chunk, recipients, public_keys))
                    digest_totals.update(scan_credential_digest_bytes(previous + chunk, credential_digests))
                    previous = chunk[-32768:]
        if (("symlink-target" if path.is_symlink() else "file") != kind
                or _secret_input_hash(path) != before):
            raise ValueError("secret scan input changed")
        entry = {"path": str(path), "sha256": before}
        if kind != "file":
            entry["contentKind"] = kind
        inventory.append(entry)
        if _identity_name_hit(path) and Path(os.path.abspath(path)) not in excluded:
            totals["nameScanHits"] += 1
    sodium = _sodium()
    seed = os.urandom(32)
    public, _ = _key_publics(sodium, seed)
    der = _ED25519_DER_PREFIX + seed
    controls = {
        "der-base64": base64.b64encode(der),
        "pem": b"-----BEGIN " + b"PRIVATE KEY-----\n" + base64.b64encode(der) + b"\n-----END " + b"PRIVATE KEY-----",
        "jwk-d": json.dumps({"kty": "OKP", "crv": "Ed25519", "d": base64.urlsafe_b64encode(seed).decode().rstrip("=")}).encode(),
        "hex-seed": seed.hex().encode(),
        "base64-seed": base64.b64encode(seed),
        "raw-sodium-secret": seed + public,
    }
    results = []
    for sample in control_samples:
        with sample.open("rb") as handle:
            real_copy = handle.read(8 * 1024 * 1024)
        for encoding, planted in controls.items():
            result = scan_secret_key_bytes(real_copy + b"\n" + planted + b"\n", recipients | {public})
            results.append({"inputSha256": _sha256(sample), "encoding": encoding,
                            "plantedSha256": hashlib.sha256(planted).hexdigest(),
                            "detected": result["realFindings"] > 0,
                            "derivationDetected": result["derivationMatches"] > 0})
    if not all(row["detected"] and row["derivationDetected"] for row in results):
        raise ValueError("planted secret control failed")
    result = {"schema": "papercusp-sealed-envelope-secret-scan-v1",
            "inputs": inventory, "scannerSha256": _sha256(Path(__file__)),
            "recipientSetSha256": hashlib.sha256(json.dumps(
                sorted(value.hex() for value in recipients), separators=(",", ":")).encode()).hexdigest(),
            "realFindings": totals["realFindings"],
            "derivationMatches": totals["derivationMatches"],
            "rawSkMatches": totals["rawSkMatches"],
            "tokensChecked": totals["tokensChecked"],
            "literalOnlyMarkers": totals["literalOnlyMarkers"],
            "nameScanHits": totals["nameScanHits"], "controls": results,
            "nameExclusions": name_exclusions, "nameExclusionCounts": exclusion_counts,
            "positivePlantedSecretDetected": True}
    if credential_digests:
        planted = os.urandom(32).hex().encode()
        target = hashlib.sha256(planted).hexdigest()
        hash_control = scan_credential_digest_bytes(planted, {target})
        raw_control = scan_credential_digest_bytes(target.encode(), {target})
        result["credentialDigestScan"] = {
            "digests": sorted(credential_digests),
            "digestOfCredentialHits": digest_totals["digestOfCredentialHits"],
            "rawCredentialHits": digest_totals["rawCredentialHits"],
            "hashControlDetected": hash_control["digestOfCredentialHits"] > 0,
            "rawControlDetected": raw_control["rawCredentialHits"] > 0,
            "plantedSha256": target,
        }
    return result


def scan_credential_digest_bytes(data: bytes, digests: set[str]) -> dict[str, int]:
    """D-149 E3: refuse a digest preimage or reuse outside a typed JSON field.

    Values stay in memory. A digest in prose, a header, or a string containing
    JSON is refused; only direct, parseable credentialSha256 properties qualify.
    """
    counts = Counter()
    if not digests:
        return counts
    if len(data) in (32, 64) and hashlib.sha256(data).hexdigest() in digests:
        counts["digestOfCredentialHits"] += 1
    for token in re.finditer(rb"[A-Za-z0-9_+/.=-]{8,4096}", data):
        value = token.group()
        candidates = {value}
        if re.fullmatch(rb"[0-9a-fA-F]{64}|[0-9a-fA-F]{128}", value):
            candidates.add(bytes.fromhex(value.decode()))
        try:
            decoded = base64.b64decode(value.replace(b"-", b"+").replace(b"_", b"/")
                                       + b"=" * (-len(value) % 4), validate=True)
            if len(decoded) in (32, 64):
                candidates.add(decoded)
        except ValueError:
            pass
        if any(hashlib.sha256(candidate).hexdigest() in digests for candidate in candidates):
            counts["digestOfCredentialHits"] += 1
        if value.decode("ascii") not in digests:
            continue
        start = data.rfind(b"\n", 0, token.start()) + 1
        end = data.find(b"\n", token.end())
        line = data[start:end if end >= 0 else len(data)]
        before = data[start:token.start()]
        direct = re.search(rb'(?<!\\)"credentialSha256"\s*:\s*"$', before)
        try:
            json.loads(line)
        except (ValueError, UnicodeDecodeError):
            direct = None
        if direct is None:
            counts["rawCredentialHits"] += 1
    return counts


def scan_identity_proof(config_path: Path, seed: Path, output: Path) -> dict[str, object]:
    """Collect a private scan over the explicit seed and assembled inventories.

    Container expansion belongs to the maintained artifact auditor; its expanded
    roots must be included alongside the actual sidecar/resource roots here.
    """
    _private_file(config_path)
    config = json.loads(config_path.read_text())
    roots = [seed] + [Path(value) for value in config["bundleRoots"]]
    plaintext = [Path(value) for value in config["plaintextInputs"]]
    if len(roots) < 2 or not plaintext or any(not root.is_dir() or root.is_symlink() for root in roots):
        raise ValueError("seed, assembled bundle and plaintext inventories required")
    paths = sorted(_secret_inventory(roots) | set(plaintext))
    recipients = {_canonical_base64(value, 32) for value in config["recipients"]}
    if len(recipients) != 33:
        raise ValueError("historical recipient population required")
    controls = [Path(value) for value in config["controlSamples"]]
    if (not any(value in plaintext for value in controls)
            or not any(value.resolve().is_relative_to(root.resolve()) for value in controls for root in roots[1:])):
        raise ValueError("plaintext and bundle control samples required")
    scan = scan_identity_secret_inputs(paths, recipients, controls,
                                      name_exclusions=config.get("nameExclusions", []),
                                      trees=config.get("trees", {}),
                                      public_keys=_manifest_publics(json.loads((seed / "manifest.json").read_text())),
                                      credential_digests=set(config.get("credentialDigests", [])))
    scan["seedRootSha"] = _sha256(seed / "manifest.json")
    scan["collectorConfigSha256"] = _sha256(config_path)
    if output.parent.is_symlink() or not output.parent.is_dir() or output.parent.stat().st_mode & 0o077:
        raise ValueError("private scan output directory required")
    fd, temporary = tempfile.mkstemp(prefix="identity-scan-", suffix=".partial", dir=output.parent)
    with os.fdopen(fd, "w") as handle:
        json.dump(scan, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, output)
    return scan


def finding_digest(finding: dict[str, object]) -> str:
    # Gitleaks' native fingerprint binds only file/rule/line. It would hide a
    # second credential on the same binary-blob line (release decision D-140).
    values = [finding.get(key) for key in ("RuleID", "Match", "Secret")]
    if any(not isinstance(value, str) or value == "REDACTED" for value in values):
        raise ValueError("exact private finding required")
    return hashlib.sha256(json.dumps(values, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def _private_file(path: Path) -> None:
    if (path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077
            or path.parent.is_symlink() or path.parent.stat().st_mode & 0o077):
        raise ValueError("proof must be private")


def _source_file(root: Path, relative: str) -> Path:
    candidate = Path(relative)
    if candidate.is_absolute() or not candidate.parts or ".." in candidate.parts:
        raise ValueError("invalid source locator")
    target = root / candidate
    if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("source outside seed")
    return target


def _classification(summary: dict[str, object], entries: list[dict[str, object]],
                    allowed: set[str]) -> set[str]:
    if (summary.get("unclassifiedLocators") != [] or not entries
            or summary.get("findings") != len(entries)
            or dict(Counter(row.get("class") for row in entries)) != summary.get("classes")
            or not set(summary["classes"]).issubset(allowed)):
        raise ValueError("incomplete classification")
    for row in entries:
        if (not isinstance(row.get("rule"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("digest", "")))):
            raise ValueError("invalid finding digest")
    return {str(row["digest"]) for row in entries}


def validate_seed_proof(proof: dict[str, object], directory: Path, root: Path,
                        config: Path) -> set[str]:
    """Validate an explicitly reviewed, private, exact-source evidence package.

    This does not infer publicness from a field name or grant new classifications.
    The review reference and digest-only classifications are authored evidence;
    authentication, scan results and all source inputs must remain bound to it.
    """
    if (proof.get("schemaVersion") != _PROOF_SCHEMA
            or not isinstance(proof.get("reviewRef"), str) or not proof["reviewRef"].strip()
            or proof.get("configSha256") != _sha256(config)):
        raise ValueError("proof identity mismatch")
    version = subprocess.run(["gitleaks", "version"], check=True,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode().strip()
    if proof.get("scannerVersion") != version:
        raise ValueError("scanner changed")
    source = _source_file(root, proof["file"])
    if (proof.get("sourceSha256") != _sha256(source)
            or proof.get("epochKeysSha256") != _sha256(_source_file(root, "epoch-keys.json"))
            or proof.get("manifestSha256") != _sha256(_source_file(root, "manifest.json"))):
        raise ValueError("seed changed")
    evidence = {}
    for name in _PROOF_FILES:
        if name not in _BASE_PROOF_FILES and name not in proof.get("evidence", {}):
            continue
        path = directory / name
        _private_file(path)
        if proof.get("evidence", {}).get(name) != _sha256(path):
            raise ValueError("evidence changed")
        if name.endswith(".json"):
            evidence[name] = json.loads(path.read_text(encoding="utf-8"))
    auth = evidence["ciphertext-auth-safe.json"]
    fields = auth.get("ciphertextFields")
    if (not isinstance(fields, int) or fields <= 0 or auth.get("parsedRows") != fields
            or auth.get("classes") != {"authenticated_ciphertext": fields}
            or auth.get("unparsedCiphertextFields") != 0
            or auth.get("negativeControls") != {"tamper_rejected": True, "wrong_key_rejected": True}):
        raise ValueError("cipher authentication incomplete")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    verify_literal_absence([directory / "seed-000080.plaintext.jsonl"],
                          evidence["forbidden-literals.private.json"],
                          _REQUIRED_FORBIDDEN_DIGESTS if manifest.get("potId") == "papercusp" else set())
    plain = evidence["plaintext-classification-safe.json"]
    plain_entries = evidence["plaintext-exact-finding-digests.json"]
    plain_allowed = _classification(plain, plain_entries, _PLAIN_CLASSES)
    plain_meta = evidence["seed-000080.plaintext.private.meta.json"]
    plain_identity = {"blobSha256": _sha256(directory / "seed-000080.plaintext.jsonl"),
                      "configSha256": proof["configSha256"], "scannerVersion": version}
    plain_report = evidence["seed-000080.plaintext.private.json"]
    if (plain_meta.get("identity") != plain_identity or plain_meta.get("scannerExit") not in (0, 1)
            or plain.get("plaintextSha256") != plain_identity["blobSha256"]
            or plain_meta.get("reportSha256") != _sha256(directory / "seed-000080.plaintext.private.json")
            or plain_meta.get("findings") != len(plain_report)
            or len(plain_entries) != len(plain_report)
            or {finding_digest(row) for row in plain_report} != plain_allowed):
        raise ValueError("plaintext scan incomplete")
    seed = evidence["seed-classification-verified-safe.json"]
    entries = evidence["seed-exact-finding-digests.json"]
    allowed = _classification(seed, entries, _SEED_CLASSES)
    report = evidence["seed-000080.private.json"]
    meta = evidence["seed-000080.private.meta.json"]
    identity = {"blobSha256": proof["sourceSha256"], "configSha256": proof["configSha256"],
                "scannerVersion": version}
    if (meta.get("identity") != identity or meta.get("scannerExit") not in (0, 1)
            or meta.get("findings") != len(report) or len(entries) != len(report)
            or seed.get("sourceSha256") != proof["sourceSha256"]
            or seed.get("plaintextProofSha256") != _sha256(directory / "plaintext-classification-safe.json")
            or {finding_digest(row) for row in report} != allowed):
        raise ValueError("seed scan incomplete")
    if (any(row["class"] in _MECHANICAL_SEED_CLASSES for row in entries)
            or any(row["class"] in _MECHANICAL_PLAIN_CLASSES for row in plain_entries)):
        context = _mechanical_context(proof, directory, root, source, entries, report, plain_report)
        _validate_mechanical_entries(entries, report, context, seed=True)
        _validate_mechanical_entries(plain_entries, plain_report, context, seed=False)
        if any(row["class"] == "public-non-bearer-field-reference" for row in plain_entries):
            if plain.get("nonBearerFields") != {"listedNames": sorted(_NON_BEARER_FIELDS),
                                              "admitted": context["nonBearerCounts"]}:
                raise ValueError("closed non-bearer admission census mismatch")
    return allowed


def assemble_seed_proof(directory: Path, root: Path, config: Path, relative: str,
                        review_ref: str) -> dict[str, object]:
    meta = json.loads((directory / "seed-000080.private.meta.json").read_text())
    proof = {"schemaVersion": _PROOF_SCHEMA, "reviewRef": review_ref, "file": relative,
             "sourceSha256": _sha256(_source_file(root, relative)),
             "epochKeysSha256": _sha256(root / "epoch-keys.json"),
             "manifestSha256": _sha256(root / "manifest.json"),
             "configSha256": _sha256(config), "scannerVersion": meta["identity"]["scannerVersion"],
             "evidence": {name: _sha256(directory / name) for name in _PROOF_FILES
                          if name in _BASE_PROOF_FILES or (directory / name).exists()}}
    validate_seed_proof(proof, directory, root, config)
    path = directory / "seed-finding-proof.json"
    fd, temporary = tempfile.mkstemp(prefix="seed-proof-", suffix=".partial", dir=directory)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(proof, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    return proof


def filter_seed_findings(report_path: Path, root: Path, proof_path: Path,
                         config: Path) -> dict[str, int]:
    _private_file(report_path)
    allowances = seed_proof_allowances(proof_path, root, config)
    findings = json.loads(report_path.read_text(encoding="utf-8"))
    residual = []
    for finding in findings:
        file = Path(str(finding.get("File", "")))
        candidate = file if file.is_absolute() else Path.cwd() / file
        try:
            relative = candidate.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            relative = ""
        if relative in allowances and finding_digest(finding) in allowances[relative]:
            continue
        residual.append({**finding, "Match": "REDACTED", "Secret": "REDACTED"})
    # Keep the original exact scan private for independent review. The normal
    # failure formatter sees only residual, redacted findings at its usual path.
    os.replace(report_path, report_path.with_suffix(".private.json"))
    fd, temporary = tempfile.mkstemp(prefix="seed-residual-", suffix=".partial", dir=report_path.parent)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(residual, handle)
    os.replace(temporary, report_path)
    return {"findings": len(findings), "exempted": len(findings) - len(residual), "remaining": len(residual)}


def seed_proof_allowances(proof_path: Path, root: Path,
                          config: Path) -> dict[str, set[str]]:
    """Compose reviewed per-file proofs without broadening any file's allowance.

    The directory scan can find ciphertext in multiple storage segments. Each
    segment needs its own source-bound authentication and plaintext proof; a
    digest approved in one segment never grants an exception in another.
    """
    _private_file(proof_path)
    proof = json.loads(proof_path.read_text(encoding="utf-8"))
    if "proofs" not in proof:
        return {proof["file"]: validate_seed_proof(proof, proof_path.parent, root, config)}
    if (proof.get("schemaVersion") != _PROOF_SCHEMA
            or not isinstance(proof.get("reviewRef"), str) or not proof["reviewRef"].strip()
            or not isinstance(proof["proofs"], list) or not proof["proofs"]):
        raise ValueError("invalid proof collection")
    allowances = {}
    for entry in proof["proofs"]:
        child = _source_file(proof_path.parent, entry["path"])
        _private_file(child)
        if entry.get("sha256") != _sha256(child):
            raise ValueError("segment proof changed")
        segment = json.loads(child.read_text(encoding="utf-8"))
        if "proofs" in segment or segment.get("file") in allowances:
            raise ValueError("nested or duplicate segment proof")
        allowances[segment["file"]] = validate_seed_proof(segment, child.parent, root, config)
    return allowances


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_seed_report(report: Path, blob: Path, config: Path) -> tuple[list[object], bool]:
    """Retain an identity-bound private scan BEFORE starting classification.

    Reuse requires both input identities and the saved report digest. Scanner
    errors and changed inputs fail closed. A killed scanner leaves its private
    partial report; a killed classifier leaves the completed reusable report.
    """
    directory = report.parent
    if not directory.is_dir() or directory.is_symlink() or directory.stat().st_mode & 0o077:
        raise ValueError("report directory must already be private")
    meta = report.with_suffix(".meta.json")
    if report.is_symlink() or meta.is_symlink():
        raise ValueError("report symlink")
    version = subprocess.run(["gitleaks", "version"], check=True,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode().strip()
    identity = {"blobSha256": _sha256(blob), "configSha256": _sha256(config),
                "scannerVersion": version}
    if report.exists() and meta.exists():
        try:
            saved = json.loads(meta.read_text(encoding="utf-8"))
            if (saved.get("identity") == identity and saved.get("scannerExit") in (0, 1)
                    and saved.get("reportSha256") == _sha256(report)):
                findings = json.loads(report.read_text(encoding="utf-8"))
                if isinstance(findings, list) and len(findings) == saved.get("findings"):
                    return findings, True
        except (OSError, UnicodeError, ValueError, AttributeError):
            pass
    fd, name = tempfile.mkstemp(prefix="seed-scan-", suffix=".partial", dir=directory)
    os.close(fd)
    partial = Path(name)
    result = subprocess.run(["gitleaks", "dir", str(blob), "--config", str(config),
                             "--no-banner", "--log-level=error", "--redact=0",
                             "--report-format=json", "--report-path", str(partial)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode not in (0, 1):
        raise ValueError("scanner failed")
    findings = json.loads(partial.read_text(encoding="utf-8"))
    if not isinstance(findings, list):
        raise ValueError("report shape")
    if identity["blobSha256"] != _sha256(blob) or identity["configSha256"] != _sha256(config):
        raise ValueError("scan input changed")
    report_digest = _sha256(partial)
    os.replace(partial, report)
    report.chmod(0o600)
    fd, name = tempfile.mkstemp(prefix="seed-scan-meta-", suffix=".partial", dir=directory)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump({"identity": identity, "scannerExit": result.returncode,
                   "findings": len(findings), "reportSha256": report_digest}, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(name, meta)
    return findings, False


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
    if len(argv) == 5 and argv[1] == "--scan-identity-proof":
        try:
            scan = scan_identity_proof(Path(argv[2]), Path(argv[3]), Path(argv[4]))
        except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
            print("Identity secret proof scan incomplete (values omitted).", file=sys.stderr)
            return 2
        print(json.dumps({key: scan[key] for key in ("schema", "seedRootSha", "scannerSha256",
                          "realFindings", "derivationMatches", "rawSkMatches", "nameScanHits",
                          "tokensChecked", "positivePlantedSecretDetected")}))
        return 1 if any(scan[key] for key in ("realFindings", "derivationMatches", "rawSkMatches", "nameScanHits")) else 0
    if len(argv) == 7 and argv[1] == "--assemble-seed-proof":
        try:
            proof = assemble_seed_proof(Path(argv[2]), Path(argv[3]), Path(argv[4]), argv[5], argv[6])
        except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
            print("Seed proof could not be assembled (values omitted).", file=sys.stderr)
            return 2
        print(json.dumps({"schemaVersion": proof["schemaVersion"], "sourceSha256": proof["sourceSha256"]}))
        return 0
    if len(argv) == 6 and argv[1] == "--filter-seed":
        try:
            result = filter_seed_findings(Path(argv[2]), Path(argv[3]), Path(argv[4]), Path(argv[5]))
        except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
            print("Exact seed exemption proof invalid; credential gate remains failed (values omitted).", file=sys.stderr)
            return 2
        print(json.dumps(result))
        return 1 if result["remaining"] else 0
    if len(argv) == 5 and argv[1] == "--scan-seed":
        try:
            findings, reused = scan_seed_report(Path(argv[2]), Path(argv[3]), Path(argv[4]))
            result = classify_seed_findings(Path(argv[3]), findings)
            result["privateReportReused"] = reused
        except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
            print("Private seed scan could not be completed (values omitted).", file=sys.stderr)
            return 2
        print(json.dumps(result))
        return 0
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
