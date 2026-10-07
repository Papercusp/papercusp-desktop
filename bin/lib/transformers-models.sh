#!/usr/bin/env bash
# papercusp_transformers_models_* — SOURCE the two owner-confirmed transformers ONNX
# models into a sidecar staging tree that does not already carry them.
#
# THE DEFECT (EI-22077502575226404). The sidecar's WI-5638 / D-178 guard is fail-closed in
# both directions: exactly the two owner-confirmed models must be present at the relocated
# `models/onnx-community/` path, and nothing else. The guard is correct. The gap was that
# NO BUILD STEP SOURCED THE MODELS. They are ~5.1G of RUNTIME downloads that land in
# `<@huggingface/transformers>/.cache/onnx-community/` the first time the host actually
# embeds something; `npm ci` never fetches them. So an ordinary build passes only
# IMPLICITLY, by happening to run in a host tree whose cache was populated by live use —
# while a pristine clone (the D-074 clean-source bar, and the `REPO_ROOT=<pinned>` mode
# build-desktop-sidecar.sh's own header advertises) gets an empty `.cache`, the D-178
# relocation is a no-op, and the presence check FATALs with exit 5. Measured: P-101 build
# #3 (task 0mtitqt8x9gpi5thk05) died exactly there.
#
# Until now the only fix was a hand-written rig script (/tmp/p101-build.sh, build #6 rc=0)
# that rsync'd the models in after `npm ci`. That works but lives outside the repo, so
# every future pinned-source build has to rediscover and rewrite it. This is that step,
# owned by the build.
#
# WHAT THIS IS NOT: an implicit fallback to the host tree. `PAPERCUSP_TRANSFORMERS_MODEL_CACHE`
# is UNSET BY DEFAULT and has no default value, so a build that does not opt in behaves
# bit-for-bit as before — the caller's fail-closed presence check still owns the verdict.
# Defaulting to "wherever this machine happens to keep its cache" would re-create the
# implicit host-tree dependency this exists to remove.
#
# Sourceable AND runnable (the lib/pinned-deps.sh contract): sourcing only defines
# functions, and the dispatcher at the bottom is guarded on BASH_SOURCE.

# The owner-confirmed live pair. build-desktop-sidecar.sh hardcodes these same two names at
# its prune, relocate and presence-check sites; sidecar-transformers-model-source.test.ts
# pins this list to those so the copies cannot drift apart silently.
PAPERCUSP_TRANSFORMERS_MODELS=(harrier-oss-v1-0.6b-ONNX embeddinggemma-300m-ONNX)
PAPERCUSP_TRANSFORMERS_MODELS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT_DEFAULT="$PAPERCUSP_TRANSFORMERS_MODELS_LIB_DIR/../../src-tauri/distribution-contract.json"

papercusp_verify_transformers_dependencies() {
  local repo_root="${1:-}" check_installed="${2:-0}"
  local contract="${PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT:-$PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT_DEFAULT}"
  [ -n "$repo_root" ] || return 2
  python3 - "$contract" "$repo_root" "$check_installed" <<'PY'
import json
import os
import posixpath
import re
import sys

contract_path, repo_root, check_installed = sys.argv[1:]
package_name = "@huggingface/transformers"
package_suffix = "node_modules/" + package_name

def fail(message):
    sys.exit("FATAL: transformers dependency contract mismatch: " + message)

def read_object(path):
    try:
        with open(path, encoding="utf-8") as source:
            document = json.load(source)
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read {path}: {exc}")
    if not isinstance(document, dict):
        fail(f"{path} must contain a JSON object")
    return document

contract = read_object(contract_path)
matches = [
    pack for pack in contract.get("server", {}).get("optionalPacks", [])
    if pack.get("name") == "local-models"
]
if len(matches) != 1:
    fail("distribution contract must declare exactly one local-models pack")
expected = matches[0].get("compatibility", {}).get("transformersPackage")
if not isinstance(expected, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", expected):
    fail("local-models must pin an exact transformersPackage version")

lock = read_object(os.path.join(repo_root, "package-lock.json"))
packages = lock.get("packages")
if not isinstance(packages, dict):
    fail("root lock must contain a packages map")
consumers = []
resolutions = {}
locked_count = 0
for relative_path, entry in packages.items():
    if not isinstance(entry, dict):
        fail(f"invalid lock entry at {relative_path}")
    if relative_path == package_suffix or relative_path.endswith("/" + package_suffix):
        locked_count += 1
        if entry.get("version") != expected:
            fail(f"lock entry {relative_path} expects {expected}, got {entry.get('version')}")
    if "node_modules" in relative_path.split("/"):
        continue
    declaration = entry.get("dependencies", {}).get(package_name)
    if declaration is None:
        continue
    if declaration != expected:
        fail(f"lock declaration {relative_path} must pin {expected}, got {declaration}")
    manifest = read_object(os.path.join(repo_root, relative_path, "package.json"))
    actual = manifest.get("dependencies", {}).get(package_name)
    if actual != expected:
        fail(f"package declaration {relative_path} must pin {expected}, got {actual}")
    candidates = []
    directory = relative_path
    while True:
        candidates.append(posixpath.join(directory, package_suffix))
        if not directory:
            break
        directory = posixpath.dirname(directory)
    locked_path = next((candidate for candidate in candidates if candidate in packages), None)
    if locked_path is None:
        fail(f"root lock cannot resolve {package_name} from {relative_path}")
    if check_installed == "1":
        installed_path = next((
            candidate for candidate in candidates
            if os.path.isdir(os.path.join(repo_root, candidate))
        ), None)
        if installed_path is None:
            fail(f"cannot read installed {package_name} from {relative_path}")
        installed = read_object(os.path.join(repo_root, installed_path, "package.json"))
        if installed.get("name") != package_name or installed.get("version") != expected:
            fail(f"installed package expects {package_name}@{expected}, got {installed.get('name')}@{installed.get('version')}")
        if installed_path != locked_path:
            fail(f"installed resolution from {relative_path} expects {locked_path}, got {installed_path}")
    consumers.append(relative_path)
    resolutions[relative_path] = locked_path
if not locked_count:
    fail(f"root lock must resolve {package_name}")
if not consumers:
    fail("root lock declares no workspace consumers of transformers")
print(json.dumps({
    "ok": True,
    "transformersPackage": expected,
    "consumers": sorted(consumers),
    "resolutions": resolutions,
    "installedChecked": check_installed == "1",
}))
PY
}

# EI-25296411034890787: packaged local models require their EXACT Node backend,
# even when its import is deferred until after boot. Check installed target
# bytes before a cross-build pays for SPA/Rust/model assembly. Never borrow a
# different runtime version or another architecture's binding.
papercusp_verify_transformers_native_target() {
  local repo_root="$1" target_os="$2" target_arch="$3" dependency_contract stage_package="${4:-}"
  dependency_contract="$(papercusp_verify_transformers_dependencies "$repo_root" 1)" || return $?
  node - "$repo_root" "$target_os" "$target_arch" "$dependency_contract" \
    "${PAPERCUSP_SIDECAR_BIN_CACHE:-$HOME/.cache/papercusp-sidecar-bins}" "$stage_package" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const [root, target, arch, text, cacheRoot, stagePackage] = process.argv.slice(2);
const platform = target === 'windows' ? 'win32' : target;
function fail(message) { throw new Error(message); }
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function targetBytes(file) {
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(4096);
  let n;
  try { n = fs.readSync(fd, header); } finally { fs.closeSync(fd); }
  if (n < 24) fail(`missing or truncated native target bytes: ${file}`);
  const cpu = arch === 'x64' ? 0x1000007 : arch === 'arm64' ? 0x100000c : 0;
  if (platform === 'darwin') {
    const magic = header.readUInt32BE(0);
    if ((magic === 0xcffaedfe && header.readUInt32LE(4) === cpu)
        || (magic === 0xfeedfacf && header.readUInt32BE(4) === cpu)) return;
    if (magic === 0xcafebabe || magic === 0xbebafeca) {
      const read = offset => magic === 0xcafebabe ? header.readUInt32BE(offset) : header.readUInt32LE(offset);
      const count = read(4);
      if (count > 0 && count <= 32 && n >= 8 + count * 20) {
        for (let i = 0; i < count; i++) if (read(8 + i * 20) === cpu) return;
      }
    }
  } else if (platform === 'linux' && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const machine = header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
    if (machine === (arch === 'x64' ? 62 : arch === 'arm64' ? 183 : -1)) return;
  } else if (platform === 'win32' && header.subarray(0, 2).toString() === 'MZ' && n >= 64) {
    const pe = header.readUInt32LE(0x3c);
    if (pe + 6 <= n && header.subarray(pe, pe + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))) {
      if (header.readUInt16LE(pe + 4) === (arch === 'x64' ? 0x8664 : arch === 'arm64' ? 0xaa64 : -1)) return;
    }
  }
  fail(`native bytes do not match ${platform}-${arch}: ${file}`);
}
try {
  if (!['linux', 'darwin', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) fail('unsupported native target');
  const dependencies = JSON.parse(text);
  const checked = new Set();
  for (const relative of Object.values(dependencies.resolutions)) {
    const tfPath = path.join(root, relative, 'package.json');
    const tf = JSON.parse(fs.readFileSync(tfPath));
    const expected = tf.dependencies?.['onnxruntime-node'];
    if (typeof expected !== 'string' || !/^\d+\.\d+\.\d+$/.test(expected)) fail('transformers must declare an exact onnxruntime-node version');
    const runtimeJson = createRequire(tfPath).resolve('onnxruntime-node/package.json');
    const runtime = JSON.parse(fs.readFileSync(runtimeJson));
    if (runtime.version !== expected) fail(`onnxruntime-node version differs from transformers pin ${expected}`);
    if (checked.has(runtimeJson)) continue;
    let nativeDir = path.join(path.dirname(runtimeJson), 'bin/napi-v6', platform, arch);
    const library = platform === 'darwin' ? `libonnxruntime.${expected}.dylib`
      : platform === 'linux' ? 'libonnxruntime.so.1' : 'onnxruntime.dll';
    const files = ['onnxruntime_binding.node', library];
    let receipt;
    // Reuse the sidecar's existing binary cache. A source-built closure is an
    // exact-version fallback, never a replacement for an invalid installed one.
    if (files.some(file => !fs.existsSync(path.join(nativeDir, file)))) {
      for (const file of files) if (fs.existsSync(path.join(nativeDir, file))) targetBytes(path.join(nativeDir, file));
      const missingBinding = path.join(nativeDir, 'onnxruntime_binding.node');
      nativeDir = path.join(cacheRoot, `onnxruntime-node-${expected}-${platform}-${arch}`);
      if (!fs.existsSync(path.join(nativeDir, 'source-build.json'))) fail(`missing pinned target closure: ${missingBinding}; no qualified source-built cache`);
      receipt = JSON.parse(fs.readFileSync(path.join(nativeDir, 'source-build.json')));
      // This fallback repairs the measured missing Intel binding of this exact
      // upstream release. A future pin needs its own measured source identity.
      if (platform !== 'darwin' || arch !== 'x64' || expected !== '1.24.3'
          || receipt.sourceSha !== '3a728b75062256951b6e19ce718907cf1a1d4cf0') {
        fail('source-built native cache is not the qualified upstream release source');
      }
      if (receipt.kind !== 'onnxruntime-node-source-build' || receipt.version !== expected
          || receipt.platform !== platform || receipt.arch !== arch
          || receipt.upstream !== 'https://github.com/microsoft/onnxruntime'
          || receipt.tag !== `v${expected}` || !/^[0-9a-f]{40}$/.test(receipt.sourceSha || '')
          || !receipt.toolchain?.clang || !receipt.toolchain?.cmake || !receipt.toolchain?.node
          || !receipt.dependencyLockSha256 || !/^[0-9a-f]{64}$/.test(receipt.dependencyLockSha256)
          || !Array.isArray(receipt.linkage) || !receipt.linkage.length
          || receipt.bindingLoad !== 'passed') fail('source-built native cache has incomplete or mismatched provenance');
      if (receipt.linkage.length !== files.length || files.some(file => !receipt.linkage.some(entry => entry.file === file))
          || receipt.linkage.some(entry => !Array.isArray(entry.dependencies) || !entry.dependencies.length
            || entry.dependencies.some(dependency => typeof dependency !== 'string'
              || (!dependency.startsWith('/System/Library/') && !dependency.startsWith('/usr/lib/')
                && dependency !== `@rpath/${library}` && dependency !== `@loader_path/${library}`)))) {
        fail('source-built native cache has non-portable or incomplete linkage closure');
      }
      if (Object.keys(receipt.files || {}).sort().join(',') !== files.slice().sort().join(',')) {
        fail('source-built native cache file inventory differs from the required CPU closure');
      }
      for (const file of files) if (digest(path.join(nativeDir, file)) !== receipt.files[file]) {
        fail(`source-built native cache digest mismatch: ${file}`);
      }
      const notices = ['LICENSE', 'ThirdPartyNotices.txt'];
      if (Object.keys(receipt.licenses || {}).sort().join(',') !== notices.slice().sort().join(',')) fail('source-built native cache lacks upstream license inventory');
      for (const file of notices) if (!/^[0-9a-f]{64}$/.test(receipt.licenses[file])
          || digest(path.join(nativeDir, file)) !== receipt.licenses[file]) fail(`source-built license digest mismatch: ${file}`);
    }
    for (const file of files) targetBytes(path.join(nativeDir, file));
    if (stagePackage && receipt) {
      const staged = JSON.parse(fs.readFileSync(path.join(stagePackage, 'package.json')));
      if (staged.name !== 'onnxruntime-node' || staged.version !== expected) fail('staged runtime differs from the exact source-build pin');
      const destination = path.join(stagePackage, 'bin/napi-v6', platform, arch);
      fs.mkdirSync(destination, { recursive: true });
      for (const file of files) {
        fs.copyFileSync(path.join(nativeDir, file), path.join(destination, file));
        if (digest(path.join(destination, file)) !== receipt.files[file]) fail(`staged source-build digest mismatch: ${file}`);
      }
      fs.writeFileSync(path.join(stagePackage, 'native-source-build.json'), JSON.stringify(receipt, null, 2) + '\n');
      const licenseDir = path.join(stagePackage, 'native-source-licenses');
      fs.mkdirSync(licenseDir, { recursive: true });
      for (const file of Object.keys(receipt.licenses)) fs.copyFileSync(path.join(nativeDir, file), path.join(licenseDir, file));
    }
    checked.add(runtimeJson);
  }
  if (!checked.size) fail('no pinned local-model native runtime resolved');
  console.log(`verified pinned local-model native target ${platform}-${arch} (${checked.size} runtime closure(s)); on-target inference remains required`);
} catch (error) {
  console.error(`FATAL: local-model native preflight: ${error.message}`);
  process.exitCode = 1;
}
NODE
}

# P-314: `distribution-contract.json` is already the customer-release manifest.
# The `local-models` pack inside it now owns exact revisions, compatibility and
# per-file content identity; do not create a second model manifest beside it.
# A verified vm-release copies a deterministic snapshot of that pack into the
# installed models root so startup can re-check the exact bytes without access
# to this source checkout.
papercusp_verify_transformers_model_pack() {
  local models_root="${1:-}" write_snapshot="${2:-0}" check_package="${3:-1}"
  local contract="${PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT:-$PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT_DEFAULT}"
  [ -n "$models_root" ] || {
    echo "FATAL: papercusp_verify_transformers_model_pack needs a models root" >&2
    return 2
  }
  [ -f "$contract" ] || {
    echo "FATAL: transformers distribution contract is missing: $contract" >&2
    return 1
  }

  python3 - "$contract" "$models_root" "$write_snapshot" "$check_package" <<'PY'
import hashlib
import json
import os
import re
import sys
import tempfile

contract_path, models_root, write_snapshot, check_package = sys.argv[1:]
community_root = os.path.join(models_root, "onnx-community")
if not os.path.isdir(community_root) and os.path.basename(models_root) == "onnx-community":
    community_root = models_root

def fail(message):
    print(f"FATAL: transformers model pack is not ready: {message}", file=sys.stderr)
    raise SystemExit(1)

def safe_rel(value):
    return (
        isinstance(value, str)
        and value
        and not value.startswith(("/", "\\"))
        and "\\" not in value
        and all(part not in ("", ".", "..") for part in value.split("/"))
        and os.path.normpath(value).replace(os.sep, "/") == value
    )

def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

try:
    with open(contract_path, encoding="utf-8") as source:
        contract = json.load(source)
except (OSError, json.JSONDecodeError) as exc:
    fail(f"cannot read {contract_path}: {exc}")

packs = contract.get("server", {}).get("optionalPacks", [])
matches = [pack for pack in packs if pack.get("name") == "local-models"]
if len(matches) != 1:
    fail(f"distribution contract must declare exactly one local-models pack, found {len(matches)}")
pack = matches[0]
if pack.get("required") is not True:
    fail("local-models pack must be required for vm-release")
if pack.get("cachePolicy", {}).get("remoteFetch") != "forbidden-on-vm-release":
    fail("local-models cache policy must forbid remote fetch on vm-release")
models = pack.get("models")
if not isinstance(models, list) or not models:
    fail("local-models pack declares no models")

snapshot = {
    "schemaVersion": 1,
    "pack": "local-models",
    "required": True,
    "cachePolicy": pack.get("cachePolicy"),
    "compatibility": pack.get("compatibility"),
    "models": models,
}

expected_models = set()
for model in models:
    runtime_id = model.get("runtimeId")
    revision = model.get("revision")
    if not safe_rel(runtime_id) or runtime_id.count("/") != 1:
        fail(f"unsafe runtimeId {runtime_id!r}")
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        fail(f"model {runtime_id} has no exact 40-hex revision")
    model_name = runtime_id.split("/", 1)[1]
    if model_name in expected_models:
        fail(f"duplicate model {model_name}")
    expected_models.add(model_name)
    files = model.get("files")
    if not isinstance(files, list) or not files:
        fail(f"model {model_name} declares no files")
    expected_files = set()
    for entry in files:
        rel = entry.get("path")
        expected_bytes = entry.get("bytes")
        expected_sha = entry.get("sha256")
        if not safe_rel(rel):
            fail(f"model {model_name} has unsafe file path {rel!r}")
        if rel in expected_files:
            fail(f"model {model_name} repeats file {rel}")
        expected_files.add(rel)
        if not isinstance(expected_bytes, int) or expected_bytes <= 0:
            fail(f"model {model_name}/{rel} has invalid byte count")
        if not isinstance(expected_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha):
            fail(f"model {model_name}/{rel} has invalid sha256")
        path = os.path.join(community_root, model_name, *rel.split("/"))
        if not os.path.isfile(path):
            fail(f"missing declared file {model_name}/{rel}")
        actual_bytes = os.path.getsize(path)
        if actual_bytes != expected_bytes:
            fail(f"size mismatch for {model_name}/{rel}: expected {expected_bytes}, got {actual_bytes}")
        actual_sha = sha256_file(path)
        if actual_sha != expected_sha:
            fail(f"sha256 mismatch for {model_name}/{rel}: expected {expected_sha}, got {actual_sha}")

    model_root = os.path.join(community_root, model_name)
    actual_files = set()
    for dirpath, _dirnames, filenames in os.walk(model_root, followlinks=False):
        for filename in filenames:
            if ".tmp." in filename or filename.endswith((".partial", ".part")):
                continue
            actual_files.add(os.path.relpath(os.path.join(dirpath, filename), model_root).replace(os.sep, "/"))
    extras = sorted(actual_files - expected_files)
    missing = sorted(expected_files - actual_files)
    if extras or missing:
        fail(f"file inventory mismatch for {model_name}: missing={missing}, unexpected={extras}")

if not os.path.isdir(community_root):
    fail(f"model namespace is missing: {community_root}")
actual_models = {
    name for name in os.listdir(community_root)
    if os.path.isdir(os.path.join(community_root, name))
}
if actual_models != expected_models:
    fail(f"model inventory mismatch: missing={sorted(expected_models-actual_models)}, unexpected={sorted(actual_models-expected_models)}")

if check_package == "1":
    package_path = os.path.join(models_root, "..", "package.json")
    try:
        with open(package_path, encoding="utf-8") as source:
            package = json.load(source)
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read transformers package identity at {package_path}: {exc}")
    expected_version = snapshot.get("compatibility", {}).get("transformersPackage")
    if package.get("name") != "@huggingface/transformers" or package.get("version") != expected_version:
        fail(
            "transformers compatibility mismatch: "
            f"expected @huggingface/transformers@{expected_version}, "
            f"got {package.get('name')}@{package.get('version')}"
        )

manifest_bytes = (json.dumps(snapshot, sort_keys=True, separators=(",", ":")) + "\n").encode()
manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
if write_snapshot == "1":
    target = os.path.join(models_root, "papercusp-model-assets.json")
    fd, temp = tempfile.mkstemp(prefix=".papercusp-model-assets.", dir=models_root)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(manifest_bytes)
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)

print(json.dumps({
    "ok": True,
    "status": "ready",
    "manifestSha256": manifest_sha,
    "models": sorted(expected_models),
    "remoteFetch": "forbidden-on-vm-release",
}, sort_keys=True))
PY
}

# Download fragments left beside finished weights by an interrupted download. They are not
# model bytes and must never cross the staging boundary (EI-21121880496840788 / P-008) —
# and they are not hypothetical: the host cache carries several right now, so a copy step
# that did not exclude them would ship hundreds of MiB of garbage.
papercusp_transformers_is_fragment() {
  # Match the filename, never the absolute path. Atomic sidecar builds stage under a
  # directory named `<output>.tmp.<pid>`; testing the whole path therefore classified
  # every legitimate `model.onnx_data*` below that directory as a download fragment.
  # The standalone helper fixtures did not carry `.tmp.` in a parent, so they missed the
  # exact production shape until EI-22356733765630454 traced the full build.
  local name="${1##*/}"
  case "$name" in
    *.tmp.*|*.partial|*.part) return 0 ;;
    *) return 1 ;;
  esac
}

# True iff `<models_root>/onnx-community/` already holds BOTH model directories.
papercusp_transformers_models_present() {
  local models_root="${1:-}" m
  [ -n "$models_root" ] || return 1
  [ -d "$models_root/onnx-community" ] || return 1
  for m in "${PAPERCUSP_TRANSFORMERS_MODELS[@]}"; do
    [ -d "$models_root/onnx-community/$m" ] || return 1
  done
  return 0
}

# A model directory holds FINAL weights, not an interrupted download. A bare presence check
# is not enough: a fragments-only directory has a plausible name and a plausible size, and
# would sail through it while shipping a model that cannot load. Requires a non-empty
# `onnx/model.onnx` plus at least one non-empty, non-fragment external-data shard — shard
# COUNT is deliberately not pinned (harrier ships model.onnx_data + model.onnx_data_1,
# embeddinggemma ships only model.onnx_data).
papercusp_transformers_model_has_final_weights() {
  local model_dir="${1:-}" f
  [ -n "$model_dir" ] && [ -d "$model_dir" ] || return 1
  [ -s "$model_dir/onnx/model.onnx" ] || return 1
  for f in "$model_dir"/onnx/model.onnx_data*; do
    [ -e "$f" ] || continue
    papercusp_transformers_is_fragment "$f" && continue
    [ -s "$f" ] && return 0
  done
  return 1
}

# Stage the models into `<models_root>/onnx-community/`, where `models_root` is the
# directory CONTAINING `onnx-community/` (the package's `models/` dir since D-178 — the
# same argument convention as prune_transformers_model_fragments).
#
# Returns 0 without doing anything when the models are already staged, or when the opt-in
# env var is unset. Returns non-zero ONLY when the caller asked for sourcing and it could
# not be satisfied — an opt-in that silently no-ops would be worse than the original bug,
# because the FATAL it produced downstream would name the wrong cause.
papercusp_stage_transformers_models() {
  local models_root="${1:-}"
  if [ -z "$models_root" ]; then
    echo "FATAL: papercusp_stage_transformers_models needs a models root (the dir CONTAINING onnx-community/)" >&2
    return 2
  fi

  # Already staged: the ordinary host-tree build, where the D-178 relocation just ran. Return
  # BEFORE reading the env var — a build that produced its own models must never silently
  # prefer an outside copy of them.
  if papercusp_transformers_models_present "$models_root"; then
    if [ "${PAPERCUSP_DISTRIBUTION_PROFILE:-}" = "vm-release" ] \
      || [ "${PAPERCUSP_TRANSFORMERS_VERIFY_PINNED:-0}" = "1" ]; then
      papercusp_verify_transformers_model_pack "$models_root" 1 1 || return 1
    fi
    return 0
  fi

  local src="${PAPERCUSP_TRANSFORMERS_MODEL_CACHE:-}"
  # Not an error, and not defaulted — see the header. No opt-in means the downstream
  # fail-closed presence check owns the verdict, exactly as before this file existed.
  [ -n "$src" ] || return 0

  local first="${PAPERCUSP_TRANSFORMERS_MODELS[0]}"
  local src_root=""
  if [ -d "$src/onnx-community" ]; then
    src_root="$src/onnx-community"
  elif [ -d "$src/$first" ]; then
    src_root="$src"
  else
    echo "FATAL: PAPERCUSP_TRANSFORMERS_MODEL_CACHE='$src' holds neither 'onnx-community/' nor '$first/' — point it at a transformers .cache/onnx-community dir, or at its parent (EI-22077502575226404)" >&2
    return 1
  fi

  local m
  for m in "${PAPERCUSP_TRANSFORMERS_MODELS[@]}"; do
    if [ ! -d "$src_root/$m" ]; then
      echo "FATAL: transformers model source is missing '$m' at $src_root — the desktop app runs a live hybrid of harrier-oss + embeddinggemma and cannot regenerate them at runtime (WI-5638 / D-178)" >&2
      return 1
    fi
    if ! papercusp_transformers_model_has_final_weights "$src_root/$m"; then
      echo "FATAL: transformers model source '$src_root/$m' has no final ONNX weights (needs a non-empty onnx/model.onnx and at least one non-fragment onnx/model.onnx_data* shard) — refusing to stage an interrupted download (EI-22077502575226404)" >&2
      return 1
    fi
  done

  # A vm-release may copy only bytes that match the exact revision/file manifest.
  # Verify the source before the first mutation so a corrupt cache never leaves a
  # plausible-looking partial destination. An independently published model pack
  # need not carry the npm package wrapper, hence check_package=0 on this leg.
  if [ "${PAPERCUSP_DISTRIBUTION_PROFILE:-}" = "vm-release" ] \
    || [ "${PAPERCUSP_TRANSFORMERS_VERIFY_PINNED:-0}" = "1" ]; then
    papercusp_verify_transformers_model_pack "$src_root" 0 0 || return 1
  fi

  mkdir -p "$models_root/onnx-community" || {
    echo "FATAL: could not create $models_root/onnx-community" >&2
    return 1
  }

  for m in "${PAPERCUSP_TRANSFORMERS_MODELS[@]}"; do
    rm -rf "${models_root:?}/onnx-community/$m"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude='*.tmp.*' --exclude='*.partial' --exclude='*.part' \
        "$src_root/$m/" "$models_root/onnx-community/$m/" || {
        echo "FATAL: failed to stage transformers model '$m' from $src_root (EI-22077502575226404)" >&2
        return 1
      }
    else
      # No rsync: copy then prune. Same end state, and the post-copy assertions below are
      # what actually decide whether it worked, so this leg is not a weaker guarantee.
      cp -a "$src_root/$m" "$models_root/onnx-community/$m" || {
        echo "FATAL: failed to stage transformers model '$m' from $src_root (EI-22077502575226404)" >&2
        return 1
      }
      find "$models_root/onnx-community/$m" -type f \( \
        -name '*.tmp.*' -o -name '*.partial' -o -name '*.part' \
      \) -delete
    fi
  done

  # Re-assert against what actually landed. The copy is the step most likely to be
  # half-done (a full disk truncates silently), and this is the last point at which the
  # cause is still legible — downstream it degrades into the same anonymous FATAL that
  # opened this item.
  for m in "${PAPERCUSP_TRANSFORMERS_MODELS[@]}"; do
    if ! papercusp_transformers_model_has_final_weights "$models_root/onnx-community/$m"; then
      echo "FATAL: staged transformers model '$m' lacks final ONNX weights after copy — refusing to continue (EI-22077502575226404)" >&2
      return 1
    fi
  done
  local _staged_fragments
  _staged_fragments="$(find "$models_root/onnx-community" -type f \( \
    -name '*.tmp.*' -o -name '*.partial' -o -name '*.part' \
  \) 2>/dev/null)"
  if [ -n "$_staged_fragments" ]; then
    echo "FATAL: download fragment(s) survived transformers model staging (EI-21121880496840788):" >&2
    echo "$_staged_fragments" >&2
    return 1
  fi

  if [ "${PAPERCUSP_DISTRIBUTION_PROFILE:-}" = "vm-release" ] \
    || [ "${PAPERCUSP_TRANSFORMERS_VERIFY_PINNED:-0}" = "1" ]; then
    papercusp_verify_transformers_model_pack "$models_root" 1 1 || return 1
  fi

  echo "staged transformers models from $src_root -> $models_root/onnx-community"
  return 0
}

# papercusp_fetch_transformers_models <dest> — DOWNLOAD the contract-pinned pack into
# <dest>/onnx-community/<model>/..., the layout PAPERCUSP_TRANSFORMERS_MODEL_CACHE accepts.
#
# WHY (WI-10003960 R-15, fresh-clone build6): the staging step above can only COPY models
# from a cache a previous runtime download filled; nothing in the repo could PRODUCE that
# cache, so a stranger following the README had no path to a buildable tree at all. This
# fetches exactly what distribution-contract.json's `local-models` pack pins — the repo id,
# the immutable revision, and every file's byte count + sha256 — so there is still ONE model
# manifest (P-314) and the bytes are identical to what vm-release verifies. Idempotent: a
# file whose size+sha256 already match is kept. Every file downloads to `<name>.part` and is
# renamed only after its digest verifies, so an interrupted run never leaves a
# final-looking shard (the fragment class EI-21121880496840788 guards against).
# PAPERCUSP_HF_ENDPOINT overrides https://huggingface.co (a mirror, or a test server).
papercusp_fetch_transformers_models() {
  local dest="${1:-}"
  if [ -z "$dest" ]; then
    echo "FATAL: papercusp_fetch_transformers_models needs a destination dir (it will hold onnx-community/)" >&2
    return 2
  fi
  local contract="${PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT:-$PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT_DEFAULT}"
  [ -f "$contract" ] || {
    echo "FATAL: transformers distribution contract is missing: $contract" >&2
    return 1
  }
  python3 - "$contract" "$dest" "${PAPERCUSP_HF_ENDPOINT:-https://huggingface.co}" <<'PY'
import hashlib, json, os, sys, urllib.request

contract_path, dest, endpoint = sys.argv[1:]
contract = json.load(open(contract_path))
packs = [p for p in contract.get("server", {}).get("optionalPacks", []) if p.get("name") == "local-models"]
if len(packs) != 1:
    sys.exit(f"FATAL: {contract_path} must declare exactly one 'local-models' pack (found {len(packs)})")

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

fetched = kept = 0
for model in packs[0]["models"]:
    repo, rev = model["runtimeId"], model["revision"]
    for entry in model["files"]:
        rel, size, digest = entry["path"], int(entry["bytes"]), entry["sha256"]
        final = os.path.join(dest, repo, rel)
        if os.path.isfile(final) and os.path.getsize(final) == size and sha256(final) == digest:
            kept += 1
            continue
        os.makedirs(os.path.dirname(final), exist_ok=True)
        part = final + ".part"
        url = f"{endpoint.rstrip('/')}/{repo}/resolve/{rev}/{rel}"
        print(f"→ fetching {repo}@{rev[:12]} {rel} ({size} bytes)", flush=True)
        h = hashlib.sha256()
        got = 0
        try:
            with urllib.request.urlopen(url, timeout=120) as r, open(part, "wb") as out:
                for chunk in iter(lambda: r.read(1 << 20), b""):
                    out.write(chunk)
                    h.update(chunk)
                    got += len(chunk)
        except Exception as e:
            sys.exit(f"FATAL: download failed for {url}: {e}")
        if got != size or h.hexdigest() != digest:
            os.remove(part)
            sys.exit(f"FATAL: {url} does not match the contract (got {got} bytes sha256 {h.hexdigest()}, "
                     f"want {size} bytes sha256 {digest}) — refusing to stage unverified weights")
        os.replace(part, final)
        fetched += 1
print(f"fetched {fetched} file(s), kept {kept} already-verified file(s) -> {dest}/onnx-community")
PY
}

# Script entry point — sourceable AND runnable, so the staging step can be exercised (and
# tested) on its own instead of only through a full sidecar build.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  case "${1:-}" in
    stage) shift; papercusp_stage_transformers_models "$@" ;;
    present) shift; papercusp_transformers_models_present "$@" ;;
    names) printf '%s\n' "${PAPERCUSP_TRANSFORMERS_MODELS[@]}" ;;
    verify) shift; papercusp_verify_transformers_model_pack "$@" ;;
    dependencies) shift; papercusp_verify_transformers_dependencies "$@" ;;
    fetch) shift; papercusp_fetch_transformers_models "$@" ;;
    *)
      echo "usage: $0 {stage|present|names|verify|fetch} <models_root> | dependencies <repo_root> [check_installed]" >&2
      exit 2
      ;;
  esac
fi
