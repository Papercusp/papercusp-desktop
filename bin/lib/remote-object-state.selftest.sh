#!/usr/bin/env bash
# Hermetic provider-contract tests; no account, network, or release data is used.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/release-storage.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
mkdir "$TEST_ROOT/bin" "$TEST_ROOT/objects"
export RELEASE_STORAGE_FIXTURE_ROOT="$TEST_ROOT/objects"
export PAPERCUSP_RELEASE_GCS_BUCKET=test-release-bucket
export PAPERCUSP_RELEASE_STORAGE_ENV="$TEST_ROOT/absent-config"
export PATH="$TEST_ROOT/bin:$PATH"
cat > "$TEST_ROOT/bin/gcloud" <<'PY'
#!/usr/bin/env python3
import hashlib, json, os, pathlib, sys
root = pathlib.Path(os.environ['RELEASE_STORAGE_FIXTURE_ROOT'])
args = sys.argv[1:]
def fail(message):
    print(message, file=sys.stderr); sys.exit(1)
def paths(uri):
    uri = uri.split('#')[0]
    key = hashlib.sha256(uri.encode()).hexdigest()
    return root / (key + '.json'), root / (key + '.data')
def load(uri):
    meta, data = paths(uri)
    if not meta.exists(): fail('HTTPError 404: object absent')
    return json.loads(meta.read_text()), data
def flag(name):
    return next((x.split('=', 1)[1] for x in args if x.startswith(name + '=')), None)
def write(uri, body, generation, sha=None):
    meta, data = paths(uri)
    data.write_bytes(body)
    meta.write_text(json.dumps({'generation': str(generation), 'size': str(len(body)),
        'metadata': {'sha256': sha} if sha else {},
        'contentType': flag('--content-type'), 'cacheControl': flag('--cache-control')}))
if os.environ.get('FAKE_DENY') == '1': fail('HTTPError 403: permission denied')
if args[:3] == ['storage', 'objects', 'describe']:
    metadata, _ = load(args[3]); print(json.dumps(metadata))
elif args[:2] == ['storage', 'cat']:
    uri = args[2]; metadata, data = load(uri)
    if uri.rsplit('#', 1)[-1] != metadata['generation']: fail('HTTPError 404: generation absent')
    body = data.read_bytes()
    sys.stdout.buffer.write(body)
elif args[:2] == ['storage', 'cp']:
    source, uri = args[2:4]; meta, _ = paths(uri)
    current = json.loads(meta.read_text()) if meta.exists() else {'generation': '0'}
    if os.environ.get('FAKE_RACE') == '1':
        write(uri, b'peer', int(current['generation']) + 1, hashlib.sha256(b'peer').hexdigest())
        fail('HTTPError 412: generation changed')
    if flag('--if-generation-match') != current['generation']: fail('HTTPError 412: condition required')
    body = pathlib.Path(source).read_bytes()
    sha = flag('--custom-metadata').removeprefix('sha256=')
    if sha != hashlib.sha256(body).hexdigest(): fail('wrong digest metadata')
    write(uri, body, int(current['generation']) + 1, sha)
    with (root / 'writes').open('a') as log: log.write(uri + '\n')
    if os.environ.get('FAKE_LOST_RESPONSE') == '1': fail('response lost after commit')
elif args[:2] == ['storage', 'rm']:
    uri = args[2]; metadata, data = load(uri)
    if flag('--if-generation-match') != metadata['generation']: fail('HTTPError 412: condition required')
    paths(uri)[0].unlink(); data.unlink()
else: fail('unexpected gcloud call')
PY
chmod +x "$TEST_ROOT/bin/gcloud"
release_storage_init
printf good > "$TEST_ROOT/local"
printf evil > "$TEST_ROOT/other"
checks=0
expect() {
  [[ "$1" == "$2" ]] || { echo "FAIL: $3: expected $2, got $1" >&2; exit 1; }
  checks=$((checks + 1))
}
expect "$(release_storage_state release/file "$TEST_ROOT/local")" absent 'confirmed 404'
expect "$(FAKE_DENY=1 release_storage_state release/file "$TEST_ROOT/local")" metadata-unavailable '403 is unknown'
if FAKE_DENY=1 release_storage_put "$TEST_ROOT/local" release/file; then exit 1; fi
expect "$(test -f "$TEST_ROOT/objects/writes" && cat "$TEST_ROOT/objects/writes" || true)" '' 'unknown state does not upload'
release_storage_put "$TEST_ROOT/local" release/file application/octet-stream 'public, max-age=31536000, immutable' immutable
expect "$(release_storage_state release/file "$TEST_ROOT/local")" identical 'create verified'
release_storage_put "$TEST_ROOT/local" release/file '' '' immutable
expect "$(wc -l < "$TEST_ROOT/objects/writes" | tr -d ' ')" 1 'replay does not write'
if release_storage_put "$TEST_ROOT/other" release/file '' '' immutable; then exit 1; fi
expect "$(release_storage_state release/file "$TEST_ROOT/other")" differs 'same-size signature collision'
release_storage_get release/file "$TEST_ROOT/readback"
expect "$(cat "$TEST_ROOT/readback")" good 'occupied bytes retained'
python3 - "$TEST_ROOT/objects" <<'PY'
import json, pathlib, sys
for file in pathlib.Path(sys.argv[1]).glob('*.json'):
    value = json.loads(file.read_text()); value['metadata'] = {}; file.write_text(json.dumps(value))
PY
expect "$(release_storage_state release/file "$TEST_ROOT/local")" identical 'legacy exact byte comparison'
expect "$(release_storage_state release/file "$TEST_ROOT/other")" differs 'legacy equal size is not equal content'
FAKE_LOST_RESPONSE=1 release_storage_put "$TEST_ROOT/local" release/lost '' '' immutable
expect "$(release_storage_state release/lost "$TEST_ROOT/local")" identical 'lost response reconciles original object'
expect "$(wc -l < "$TEST_ROOT/objects/writes" | tr -d ' ')" 2 'lost response did not retry'
if FAKE_RACE=1 release_storage_put "$TEST_ROOT/local" release/race; then exit 1; fi
release_storage_get release/race "$TEST_ROOT/peer"
expect "$(cat "$TEST_ROOT/peer")" peer 'generation race preserves winner'
mkdir "$TEST_ROOT/tree"
printf '<p>page</p>' > "$TEST_ROOT/tree/page with spaces.html"
release_storage_tree "$TEST_ROOT/tree" release/history 'text/html; charset=utf-8'
release_storage_get 'release/history/page with spaces.html' "$TEST_ROOT/page"
expect "$(cat "$TEST_ROOT/page")" '<p>page</p>' 'tree preserves names and bytes'
release_storage_delete release/file
expect "$(release_storage_state release/file "$TEST_ROOT/local")" absent 'generation-fenced deletion'
for key in '../escape' 'release/../escape' 'release/*' 'release/file#1' '/absolute'; do
  if release_storage_uri "$key"; then echo 'unsafe key accepted' >&2; exit 1; fi
  checks=$((checks + 1))
done
echo "release-storage self-test: $checks PASS"
