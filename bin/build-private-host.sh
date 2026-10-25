#!/usr/bin/env bash
# Assemble a disposable, current-build installed PRIMARY from prepared inputs.
# This builds no SPA, installs no donor dependencies and starts no runtime.
# The maintained caller owns the build timeout, process group and run cleanup.
set -euo pipefail
{
[[ $# == 2 && "$1" == /* && "$2" == /* ]] || {
  echo 'usage: build-private-host.sh <absolute donor checkout> <absolute fresh run directory>' >&2
  exit 78
}
unset NODE_OPTIONS NODE_PATH PAPERCUSP_TRANSFORMERS_MODEL_CACHE PAPERCUSP_SIDECAR_BIN_CACHE
REPO_ROOT="$(cd "$1" && pwd -P)"
run="$2"
# Validate without allocating anything. realpath rejects aliases through any
# existing parent; mkdir below atomically refuses a concurrent winner.
node - "$REPO_ROOT" "$run" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const [donor, run] = process.argv.slice(2);
if (/[\r\n\t]/.test(donor + run)) throw new Error('control characters in build root');
const parent = fs.realpathSync(path.dirname(run));
if (fs.existsSync(run) || fs.lstatSync(parent).isSymbolicLink()
    || path.resolve(run) !== path.join(parent, path.basename(run))) throw new Error('run must be fresh with canonical parent');
const inside = (a, b) => a === b || a.startsWith(b + path.sep);
if (inside(run, donor) || inside(donor, run)) throw new Error('private run overlaps donor');
for (const input of ['package-lock.json', 'node_modules', 'apps/operator/bin/serve.ts',
  'scripts/npm-install-safe.mjs', 'libs/papercusp/libs/db/sql']) {
  if (!fs.existsSync(path.join(donor, input))) throw new Error('missing prepared input: ' + input);
}
NODE
# Re-enter through the SAME donor-install reader boundary used by the host.
# This is a lease, never npm install. Metadata uses the host-stable mutex root.
if ! node --input-type=module - "$REPO_ROOT" <<'NODE'
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { installLockNameForRoot, installMutexIsHeld } = await import(pathToFileURL(root + '/scripts/lib/install-lock-name.mjs'));
process.exit(installMutexIsHeld(installLockNameForRoot(root)) ? 0 : 1);
NODE
then
  exec node "$REPO_ROOT/scripts/npm-install-safe.mjs" --repo-root "$REPO_ROOT" \
    --exec-under-lock -- bash "$0" "$REPO_ROOT" "$run"
fi
umask 077
mkdir -m 700 "$run"
mkdir -p "$run/build-state/home" "$run/build-state/tmp" "$run/build-state/npm" "$run/artifact"
# These variables belong only to this disposable build child.
export HOME="$run/build-state/home" TMPDIR="$run/build-state/tmp"
export XDG_CONFIG_HOME="$run/build-state/config" XDG_CACHE_HOME="$run/build-state/cache"
export npm_config_cache="$run/build-state/npm" NPM_CONFIG_CACHE="$run/build-state/npm"
export npm_config_userconfig="$run/build-state/npmrc" npm_config_globalconfig="$run/build-state/global-npmrc"
export BUNDLE_HOST_STEP_LOG="$run/build-steps.jsonl"
touch "$npm_config_userconfig" "$npm_config_globalconfig"
WEB_DIR="$REPO_ROOT/apps/operator"
ROOT="$REPO_ROOT/papercusp-desktop"
HERE="$ROOT/bin"
SIDECAR_DIR="$run/artifact"
TARGET_OS="$(node -p process.platform)" TARGET_ARCH="$(node -p process.arch)"
[[ "$TARGET_OS" == linux ]] || { echo 'private PRIMARY assembly currently requires Linux' >&2; exit 78; }
_bare_node_platform="$TARGET_OS" _bare_node_arch="$TARGET_ARCH"
source "$WEB_DIR/bin/bundle-host-common.sh"
SOURCE_SHA="$(bundle_host_source_sha "$REPO_ROOT")" || exit $?
[[ "$SOURCE_SHA" =~ ^[a-f0-9]{7,40}$ ]] || { echo 'private PRIMARY requires a verified source SHA' >&2; exit 78; }
BUNDLED_SOURCE_SHA_DEFINE=("--define:__PAPERCUSP_BUNDLED_SOURCE_SHA__=\"${SOURCE_SHA}\"")
source "$HERE/lib/transformers-models.sh"
source "$HERE/lib/host-runtime-closure.sh"
HOST_EXTERNALS=("${HOST_COMMON_EXTERNALS[@]}")
for np in "${NATIVE_PKGS[@]}"; do HOST_EXTERNALS+=("--external:$np"); done
HOST_EXTERNALS+=(--external:@lydell/* --external:@embedded-postgres/darwin-arm64
  --external:@embedded-postgres/darwin-x64 --external:@embedded-postgres/linux-arm
  --external:@embedded-postgres/linux-arm64 --external:@embedded-postgres/linux-ia32
  --external:@embedded-postgres/linux-ppc64 --external:@embedded-postgres/windows-x64
  --external:@papercusp/embedded-postgres-server)
export BUNDLE_HOST_GATE_META_DIR="$run/build-meta"
mkdir "$BUNDLE_HOST_GATE_META_DIR"
# The finite source census includes submodules and prepared generated workspace
# inputs. Ignore dependency installs here: their exact dereferenced bytes are
# measured by the shared package copier below.
source_census() {
  node - "$REPO_ROOT" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.argv[2], hash = crypto.createHash('sha256');
let count = 0;
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    if (['node_modules','.git','.papercusp','target','.next','.cache','dist-host','dist-host-dev'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|json|sql|sh)$/.test(entry.name)) {
      hash.update(JSON.stringify([path.relative(root, file), crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
      count++;
    }
  }
}
visit(root);
if (!count) throw new Error('empty source census');
console.log(JSON.stringify({count, sha256: hash.digest('hex')}));
NODE
}
bundle_host_run_step source-census-before source_census > "$run/source-before.json"
bundle_host_run_step primary-probe-wait node "$REPO_ROOT/scripts/mutation-probe-window-gate.mjs" wait \
  --root "$REPO_ROOT" --stamp-file "$run/probe-stamp.json"
bundle_host_primary "$REPO_ROOT" "$SIDECAR_DIR" "${HOST_RELEASE_COMPACTION_ARGS[@]}" \
  --define:__PAPERCUSP_BUNDLED_SIDECAR__=true "${BUNDLED_SOURCE_SHA_DEFINE[@]}" "${HOST_EXTERNALS[@]}"
bundle_host_workers "$REPO_ROOT" "$SIDECAR_DIR"
bundle_host_runtime_siblings "$REPO_ROOT" "$SIDECAR_DIR"
bundle_host_spawner "$REPO_ROOT" "$SIDECAR_DIR" "${HOST_RELEASE_COMPACTION_ARGS[@]}" "${BUNDLED_SOURCE_SHA_DEFINE[@]}" "${HOST_EXTERNALS[@]}"
bundle_host_launcher "$REPO_ROOT" "$SIDECAR_DIR/scripts/psu.mjs" psu-launcher "${HOST_RELEASE_COMPACTION_ARGS[@]}"
bundle_host_launcher "$REPO_ROOT" "$SIDECAR_DIR/scripts/ptool.mjs" ptool "${HOST_RELEASE_COMPACTION_ARGS[@]}"
node "$HERE/check-ptool-sdk-bundle.mjs" "$SIDECAR_DIR/scripts/ptool.mjs"
mkdir -p "$SIDECAR_DIR/sql" "$SIDECAR_DIR/node_modules"
cp -aL "$REPO_ROOT/libs/papercusp/libs/db/sql/." "$SIDECAR_DIR/sql/"
nat_copied=0 nat_missing=0 _seen='|'
HOST_CLOSURE_INPUT_LOG="$run/dependency-inputs.tsv"
for np in "${NATIVE_PKGS[@]}" @lydell/node-pty @papercusp/embedded-postgres-server; do
  bundle_host_run_step "closure-$np" copy_pkg_closure "$np"
done
copy_host_external_closures
copy_host_runtime_require_closures
# Classify optional loader branches only after exercising the real production
# provider/context composition. This is a package probe, never PRIMARY startup.
assert_host_default_trace_context "$run"
write_host_graph_dependency_census "$run" > "$run/graph-packages.tsv"
while IFS=$'\t' read -r dependency_kind dependency_name; do
  if [[ "$dependency_kind" == required ]] || resolve_pkg_source "$dependency_name" '' >/dev/null 2>&1; then
    copy_pkg_closure "$dependency_name"
  fi
done < "$run/graph-packages.tsv"
(( nat_missing == 0 )) || { echo "missing $nat_missing required package(s)" >&2; exit 1; }
prune_vendored_test_fixtures "$SIDECAR_DIR"
prune_gyp_build_intermediates "$SIDECAR_DIR"
assert_runtime_dependency_closure "$SIDECAR_DIR"
assert_no_onnx_gpu_providers "$SIDECAR_DIR"
bundle_host_run_step primary-probe-verify node "$REPO_ROOT/scripts/mutation-probe-window-gate.mjs" verify \
  --root "$REPO_ROOT" --stamp-file "$run/probe-stamp.json"
bundle_host_run_step source-census-after source_census > "$run/source-after.json"
cmp "$run/source-before.json" "$run/source-after.json" || { echo 'source changed during private assembly' >&2; exit 1; }
# A receipt is emitted only after the assembled tree and inputs are qualified.
node - "$run" "$REPO_ROOT" "$nat_copied" "$SOURCE_SHA" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [run, donor, copied, sourceSha] = process.argv.slice(2), artifact = path.join(run, 'artifact');
const receipt = {schemaVersion:'private-primary-assembly-v1', donor, artifact,
  sourceSha, source:JSON.parse(fs.readFileSync(path.join(run,'source-after.json'))), packages:Number(copied),
  primarySha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(artifact,'serve.mjs'))).digest('hex'),
  controlStatus:'not-run', physicalStatus:'not-qualified'};
fs.writeFileSync(path.join(run,'assembly.json'), JSON.stringify(receipt) + '\n', {mode:0o600});
console.log(JSON.stringify(receipt));
NODE
exit 0
}
