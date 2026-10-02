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
}
_SEED_CLASSES |= _MECHANICAL_SEED_CLASSES
_PLAIN_CLASSES |= _MECHANICAL_PLAIN_CLASSES
_CREDENTIAL_FIELD = re.compile(r"token|secret|key|auth|password", re.IGNORECASE)
_ID_FIELDS = {"id", "issue_id", "msg_id", "condition_id", "operation_id", "request_id",
              "receipt_id", "event_id", "rubric_id", "rule_id", "task_id", "ref"}
_FROZEN_TREES = {"superproject": "d740fc3802877d1c8c3b1068768681ee32ef0025",
                 "desktop": "c864f7a1d1b62721a21dc8b0a576d51ff4edb345"}
_PROOF_FILES = (
    "ciphertext-auth-safe.json", "plaintext-classification-safe.json",
    "plaintext-exact-finding-digests.json", "seed-classification-verified-safe.json",
    "seed-exact-finding-digests.json", "seed-000080.plaintext.private.meta.json",
    "seed-000080.plaintext.private.json", "seed-000080.plaintext.jsonl",
    "seed-000080.private.meta.json", "seed-000080.private.json",
    "forbidden-literals.private.json",
)

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
                or re.fullmatch(r"(?:su-|WI-|EI-|F-|P-)[A-Za-z0-9-]+", value)
                or re.fullmatch(r"[a-z][a-z0-9_.-]*:[A-Za-z0-9_.:/-]+", value))


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
            return (finding["RuleID"] == "generic-api-key" and len(parts) == 2
                    and re.fullmatch(r"[a-z][a-z0-9-]*", parts[0]) is not None
                    and _public_id(parts[1])
                    and any((field, value) in fields for field in ("hbKey", "__rekey", "writer_key")))
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
    if kind == "public-cryptographic-key":
        return actual == value and _canonical_base64(value, 32) in context["publicKeys"]
    if kind == "reviewed-descriptive-source-text":
        return (finding["RuleID"] == "generic-api-key" and not _CREDENTIAL_FIELD.search(field)
                and isinstance(actual, str) and match in actual and value in actual
                and not _CREDENTIAL_FIELD.search((_MATCH_FIELD.match(match).group(1)
                                                  if _MATCH_FIELD.match(match) else "")))
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
    for entry in entries:
        if entry["class"] in added and not mechanical_class_valid(
                entry, by_digest[entry["digest"]], context, seed=seed):
            raise ValueError("mechanical class predicate failed")


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
    public_keys = {_canonical_base64(value, 32) for value in recipients}
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
    with (directory / "seed-000080.plaintext.jsonl").open() as handle:
        for line, text in enumerate(handle, 1):
            if line in needed_lines:
                plain_rows[line] = json.loads(text)
    data = source.read_bytes()
    fields = {(found.group("field").decode(), found.group("value").decode())
              for found in _SEED_FIELDS.finditer(data)}
    context = {"seedFields": fields, "publicKeys": publics, "plainRows": plain_rows,
               "publicReferences": public_refs, "idFields": set(reference.get("idFields", [])),
               "trees": reference.get("trees", {})}
    if any(entry["class"] == "recipient-sealed-epoch-key-envelope" for entry in entries):
        envelope = _read_extra_proof(proof, directory, "sealed-envelope-proof-safe.json")
        keys = json.loads((root / "epoch-keys.json").read_text())["papercusp"]
        context["envelopeDigests"] = validate_envelope_structure(envelope, data, report, {int(k) for k in keys})
        publics |= {_canonical_base64(value, 32) for value in envelope["recipients"]}
        validate_identity_secret_proof(_read_extra_proof(proof, directory, "identity-secret-scan-safe.json"),
                                       root, directory, publics, reference)
    return context


def validate_identity_secret_proof(scan: dict[str, object], root: Path, directory: Path,
                                   recipients: set[bytes], reference: dict[str, object]) -> None:
    if (scan.get("schema") != "papercusp-sealed-envelope-secret-scan-v1"
            or scan.get("seedRootSha") != _sha256(root / "manifest.json")
            or scan.get("scannerSha256") != _sha256(Path(__file__))
            or any(scan.get(name) != 0 for name in ("realFindings", "derivationMatches", "rawSkMatches", "nameScanHits"))
            or scan.get("positivePlantedSecretDetected") is not True
            or not isinstance(scan.get("tokensChecked"), int)):
        raise ValueError("identity secret scan failed")
    bundle = Path(reference["bundleRoot"])
    if not bundle.is_dir() or bundle.is_symlink():
        raise ValueError("assembled bundle input required")
    expected = {path.resolve() for folder in (root, bundle) for path in folder.rglob("*") if path.is_file()}
    expected |= {_source_file(directory, value).resolve() for value in reference["plaintextInputs"]}
    inputs = scan.get("inputs", [])
    if len(inputs) != len(expected) or {Path(row["path"]).resolve() for row in inputs} != expected:
        raise ValueError("identity secret scan inventory incomplete")
    for row in inputs:
        path = Path(row["path"])
        if path.is_symlink() or _sha256(path) != row["sha256"]:
            raise ValueError("identity secret scan input changed")
    controls = scan.get("controls", [])
    encodings = {"der-base64", "pem", "jwk-d", "hex-seed", "base64-seed", "raw-sodium-secret"}
    samples = {}
    for row in controls:
        if (row.get("detected") is not True or row.get("derivationDetected") is not True
                or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("plantedSha256", "")))
                or row.get("inputSha256") not in {entry["sha256"] for entry in inputs}):
            raise ValueError("identity secret positive control failed")
        samples.setdefault(row["inputSha256"], set()).add(row["encoding"])
    plain_hashes = {_sha256(_source_file(directory, path)) for path in reference["plaintextInputs"]}
    bundle_hashes = {_sha256(path) for path in bundle.rglob("*") if path.is_file()}
    if (not any(digest in plain_hashes and kinds == encodings for digest, kinds in samples.items())
            or not any(digest in bundle_hashes and kinds == encodings for digest, kinds in samples.items())):
        raise ValueError("seed and bundle planted controls required")

# D-142/D-147: recognize complete private-key material, including raw seeds
# whose derived public key belongs to a recipient. Source vocabulary by itself
# (a PEM header or a service name in code) is not a serialized private key.
_ED25519_DER_PREFIX = bytes.fromhex("302e020100300506032b657004220420")
_KEY_TOKENS = re.compile(rb"(?<![A-Za-z0-9_+/=-])(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{64}|[A-Za-z0-9_+/-]{86}={0,2}|[A-Za-z0-9_+/-]{43}=?)(?![A-Za-z0-9_+/=-])")
_PEM_PRIVATE = re.compile(rb"-----BEGIN (PRIVATE KEY|OPENSSH PRIVATE KEY|ENCRYPTED PRIVATE KEY)-----\s+([A-Za-z0-9+/=\s]+)-----END \1-----")
_PRIVATE_JWK = re.compile(rb'\{[^{}]{0,16384}"crv"\s*:\s*"(?:Ed25519|X25519)"[^{}]{0,16384}\}')


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


def scan_secret_key_bytes(data: bytes, recipients: set[bytes]) -> dict[str, int]:
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
    serialized = 0
    raw_sk_matches = 0

    def der(value: bytes) -> bool:
        nonlocal serialized
        found = False
        offset = 0
        while True:
            offset = value.find(_ED25519_DER_PREFIX, offset)
            if offset < 0:
                return found
            end = offset + len(_ED25519_DER_PREFIX) + 32
            if end <= len(value):
                seeds.add(value[offset + len(_ED25519_DER_PREFIX):end])
                serialized += 1
                found = True
            offset += 1

    der(data)
    # A raw libsodium Ed25519 secret is seed || public. Search recipient public
    # bytes first, then derive the preceding seed; random ciphertext is not a key.
    for public in recipients:
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
        (rb"(?<![0-9a-fA-F])" + _ED25519_DER_PREFIX.hex().encode() + rb"[0-9a-fA-F]{64}(?![0-9a-fA-F])", lambda value: bytes.fromhex(value.decode("ascii"))),
        (rb"(?<![A-Za-z0-9+/])MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/]{43}(?![A-Za-z0-9+/])", base64.b64decode),
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
            if len(raw) in (32, 64):
                seeds.add(raw[:32])
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
        if ed in recipients or curve in curve_recipients:
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
                                control_samples: list[Path]) -> dict[str, object]:
    """Scan an explicit complete inventory and run controls only in memory.

    The caller binds the inventory to seed/assembled-bundle or final artifacts.
    This never extracts containers implicitly: finished installers need their
    expanded contents in the inventory, through the existing artifact auditor.
    """
    if not inputs or not control_samples or any(path not in inputs for path in control_samples):
        raise ValueError("complete inventory and real control samples required")
    totals = Counter()
    inventory = []
    forbidden_names = ("*keychain*", "*keystore*", "*device-keypair*", "*.pem", "*.p8", "*.key")
    for path in inputs:
        if path.is_symlink() or not path.is_file():
            raise ValueError("secret scan input must be an actual file")
        before = _sha256(path)
        # Chunk overlap covers the scanner's largest bounded JWK serialization.
        # It keeps large full-history bundles out of Python heap allocations.
        with path.open("rb") as handle:
            previous = b""
            for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
                totals.update(scan_secret_key_bytes(previous + chunk, recipients))
                previous = chunk[-32768:]
        if _sha256(path) != before:
            raise ValueError("secret scan input changed")
        inventory.append({"path": str(path), "sha256": before})
        if any(fnmatch.fnmatch(path.name.lower(), pattern) for pattern in forbidden_names):
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
    return {"schema": "papercusp-sealed-envelope-secret-scan-v1",
            "inputs": inventory, "scannerSha256": _sha256(Path(__file__)),
            "realFindings": totals["realFindings"],
            "derivationMatches": totals["derivationMatches"],
            "rawSkMatches": totals["rawSkMatches"],
            "tokensChecked": totals["tokensChecked"],
            "literalOnlyMarkers": totals["literalOnlyMarkers"],
            "nameScanHits": totals["nameScanHits"], "controls": results,
            "positivePlantedSecretDetected": True}


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
    return allowed


def assemble_seed_proof(directory: Path, root: Path, config: Path, relative: str,
                        review_ref: str) -> dict[str, object]:
    meta = json.loads((directory / "seed-000080.private.meta.json").read_text())
    proof = {"schemaVersion": _PROOF_SCHEMA, "reviewRef": review_ref, "file": relative,
             "sourceSha256": _sha256(_source_file(root, relative)),
             "epochKeysSha256": _sha256(root / "epoch-keys.json"),
             "manifestSha256": _sha256(root / "manifest.json"),
             "configSha256": _sha256(config), "scannerVersion": meta["identity"]["scannerVersion"],
             "evidence": {name: _sha256(directory / name) for name in _PROOF_FILES}}
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
