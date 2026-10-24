// EI-20592319474283246 — upload-release.sh must decide "already uploaded" from CONTENT,
// not from size, for any file small enough that size cannot stand in for identity.
//
// WHY THIS TEST EXISTS
// The uploader skipped any artifact whose published size equalled the local size, and
// its own comment justified that: "a re-cut with the same version but different bytes
// is a size change in practice". That is false for exactly the file whose entire job is
// byte-identity. A minisign signature is FIXED-LENGTH (428 B for the GUI here), so a
// re-cut produces a genuinely different .sig at an identical size. Measured live during
// the 0.0.17 Windows re-publish: the NEW .exe was published beside the OLD .exe's .sig.
//
// The damage is a TRUST failure, not a cosmetic one. The auto-updater was fine (it reads
// the signature embedded in latest.json), which is precisely why this went unnoticed. But
// a human or script that downloads the artifact and checks it against the published
// signature gets a MISMATCH on a clean release — the single most alarming possible
// result, pointing at tampering. That teaches people to stop checking signatures, which
// is strictly worse than never publishing one.
//
// WHY BOTH LEGS ARE ASSERTED
// The skip AND the post-upload verifier both read ContentLength, via the same
// `s3api_head` helper. They therefore agreed because they were ONE measurement run
// twice, not because the bytes matched — so the verifier structurally could not catch
// the skip's mistake. A test covering only the skip would pass while the verifier stayed
// blind. Both are asserted here for that reason.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Overridable so falsifiability can be PROVEN against a mutated COPY outside the tree
// (scripts/mutation-probe.sh tier 2). Mutating the real file in place would race
// git-sync, which sweeps and commits the whole working tree on a timer.
const UPLOAD = process.env.PROBE_SCRIPT || path.join(__dirname, '..', 'bin', 'upload-release.sh');
const MOBILE_UPLOAD =
  process.env.PROBE_MOBILE_SCRIPT || path.join(__dirname, '..', 'bin', 'upload-mobile-release.sh');
const CHANNEL_HELPERS = path.join(__dirname, '..', 'bin', 'lib', 'gen-latest-manifest.sh');

const source = () => fs.readFileSync(UPLOAD, 'utf8');

// Execute the REAL public-manifest verifier functions against a fake public
// host. Only the two outward I/O seams are replaced: curl reads fixture files,
// and artifact range probes are a no-op because these tests are about manifest
// identity + feed enumeration. The channel paths still come from the canonical
// gen-latest-manifest.sh registry used by the publisher itself.
function publicManifestVerification({
  version = '9.8.7',
  channel = 'stable',
  manifestName = 'latest.json',
  localIdentity = { version, channel },
  feedPaths,
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-public-manifest-'));
  try {
    const script = source();
    const verifierStart = script.indexOf('verify_public_manifest_identity() {');
    const verifierEnd = script.indexOf('\nverify_public_manifest_feeds "$LATEST_JSON"', verifierStart);
    assert.notEqual(verifierStart, -1, 'public manifest identity verifier is missing');
    assert.notEqual(verifierEnd, -1, 'public manifest verifier invocation boundary is missing');

    const verifier = path.join(dir, 'public-manifest-verifier.sh');
    fs.writeFileSync(verifier, script.slice(verifierStart, verifierEnd));

    const manifestBody = `${JSON.stringify({ ...localIdentity, platforms: {} }, null, 2)}\n`;
    const localManifest = path.join(dir, manifestName);
    fs.writeFileSync(localManifest, manifestBody);

    const feeds = path.join(dir, 'feeds');
    for (const feedPath of feedPaths) {
      const fixture = path.join(feeds, feedPath);
      fs.mkdirSync(path.dirname(fixture), { recursive: true });
      // The served bytes deliberately equal the local manifest. Identity tests
      // therefore cannot pass/fail merely because diff noticed different bytes.
      fs.writeFileSync(fixture, manifestBody);
    }

    const requestLog = path.join(dir, 'requests.log');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, 'curl'),
      [
        '#!/bin/bash',
        'set -euo pipefail',
        'args=("$@")',
        'out=""',
        'url=""',
        'for ((i=0; i<${#args[@]}; i++)); do',
        '  [[ "${args[$i]}" == "-o" ]] && out="${args[$((i + 1))]}"',
        '  [[ "${args[$i]}" == http://* || "${args[$i]}" == https://* ]] && url="${args[$i]}"',
        'done',
        'relative="${url#"$FAKE_BASE"/}"',
        'printf "%s\\n" "$relative" >> "$FAKE_REQUEST_LOG"',
        'fixture="$FAKE_FEEDS/$relative"',
        'if [[ ! -f "$fixture" ]]; then',
        '  : > "$out"',
        '  printf 404',
        '  exit 0',
        'fi',
        'cp "$fixture" "$out"',
        'printf 200',
      ].join('\n'),
      { mode: 0o755 },
    );

    const harness = `
set -euo pipefail
. "$CHANNEL_HELPERS"
. "$VERIFIER"
probe_public_manifest_artifacts() { :; }
BASE="$FAKE_BASE"
R2_BUCKET=test-bucket
VERSION="$EXPECTED_VERSION"
CHANNEL="$EXPECTED_CHANNEL"
PUBLIC_MANIFEST_DIR="$PUBLIC_TMP"
mkdir -p "$PUBLIC_MANIFEST_DIR"
verify_public_manifest_feeds "$LOCAL_MANIFEST" "$MANIFEST_NAME" "$MANIFEST_NAME"
`;
    const result = spawnSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CHANNEL_HELPERS,
        VERIFIER: verifier,
        FAKE_BASE: 'https://updates.example.invalid/secret',
        FAKE_FEEDS: feeds,
        FAKE_REQUEST_LOG: requestLog,
        EXPECTED_VERSION: version,
        EXPECTED_CHANNEL: channel,
        LOCAL_MANIFEST: localManifest,
        MANIFEST_NAME: manifestName,
        PUBLIC_TMP: path.join(dir, 'public'),
      },
    });

    return {
      ...result,
      requestPaths: fs.existsSync(requestLog)
        ? fs.readFileSync(requestLog, 'utf8').trim().split('\n').filter(Boolean)
        : [],
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Run each publisher's REAL decision wrapper through the shared GCS helper.
// Only the Google CLI transport is replaced. Generation-pinned reads execute.
function remoteState({ fileBody, remoteBody = fileBody, remoteSize, etagFailure = false,
  getFailure = false, scriptPath = UPLOAD }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-upload-skip-'));
  try {
    const file = path.join(dir, 'artifact.sig');
    fs.writeFileSync(file, fileBody);
    const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gcloud'), [
      '#!/usr/bin/env node',
      'const args = process.argv.slice(2);',
      'const fail = message => { console.error(message); process.exit(1); };',
      'if (process.env.FAKE_HEAD_MODE === "error") fail("HTTPError 403: unavailable");',
      'if (args[1] === "objects") {',
      '  if (!process.env.FAKE_SIZE) fail("HTTPError 404: absent");',
      '  console.log(JSON.stringify({size:process.env.FAKE_SIZE,generation:"42",metadata:{}}));',
      '} else if (args[1] === "cat") {',
      '  if (process.env.FAKE_GET_MODE === "error") fail("HTTPError 403");',
      '  if (!args[2].endsWith("#42")) fail("generation was not pinned");',
      '  process.stdout.write(process.env.FAKE_REMOTE_BODY);',
      '} else fail("unexpected write during content comparison");',
    ].join('\n'), { mode: 0o755 });
    const harness = `
set -euo pipefail
. "$STORAGE_HELPER"
eval "$(sed -n '/^remote_state()/p' "$UPLOAD_SCRIPT")"
PAPERCUSP_RELEASE_GCS_BUCKET=test-release-bucket
remote_state "some/key" "$TARGET_FILE"
`;
    const res = spawnSync('bash', ['-c', harness], { encoding: 'utf8', env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, UPLOAD_SCRIPT: scriptPath,
      STORAGE_HELPER: path.join(__dirname, '../bin/lib/release-storage.sh'), TARGET_FILE: file,
      FAKE_SIZE: remoteSize === null ? '' : String(remoteSize), FAKE_REMOTE_BODY: remoteBody,
      FAKE_GET_MODE: getFailure ? 'error' : 'value', FAKE_HEAD_MODE: etagFailure ? 'error' : 'value',
    } });
    assert.equal(res.status, 0, `harness failed: ${res.stderr}`);
    return res.stdout.trim();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// A real minisign signature is two base64 lines and a comment: ~428 B, and CRUCIALLY
// the same length whatever it signs. Two different signatures, byte-for-byte distinct,
// identical in size — the exact condition the old size test could not see.
const SIG_A = `untrusted comment: signature from minisign secret key\n${'A'.repeat(96)}\ntrusted comment: timestamp:1755300000\n${'B'.repeat(96)}\n`;
const SIG_B = `untrusted comment: signature from minisign secret key\n${'C'.repeat(96)}\ntrusted comment: timestamp:1755399999\n${'D'.repeat(96)}\n`;

test('THE DEFECT: a re-cut signature — same size, different bytes — is reported as differing', () => {
  assert.equal(SIG_A.length, SIG_B.length, 'fixture invalid: the two signatures must be the same size');
  assert.notEqual(SIG_A, SIG_B);

  const verdict = remoteState({
    fileBody: SIG_A,
    remoteBody: SIG_B,
    remoteSize: SIG_B.length, // identical size — the old test skipped right here
    remoteEtag: md5(SIG_B), // but the published bytes are the OLD signature
  });

  assert.equal(
    verdict,
    'differs',
    'a stale published signature at an identical size must be detected as different, not skipped',
  );
});

test('an unchanged file is still recognised as identical (the fast path must survive)', () => {
  const verdict = remoteState({
    fileBody: SIG_A,
    remoteSize: SIG_A.length,
    remoteEtag: md5(SIG_A),
  });
  assert.equal(verdict, 'identical');
});

test('a size change is still a difference', () => {
  const verdict = remoteState({ fileBody: SIG_A, remoteSize: 12, remoteEtag: md5('x') });
  assert.equal(verdict, 'differs');
});

test('an unpublished object reads as absent, not as a match', () => {
  const verdict = remoteState({ fileBody: SIG_A, remoteSize: null, remoteEtag: null });
  assert.equal(verdict, 'absent');
});

test('legacy multipart objects are compared by exact bytes rather than ETag or size', () => {
  // Multi-GB artifacts upload multipart, whose ETag is "<md5-of-part-md5s>-<partcount>".
  // That is not a content hash. The GCS port reads the exact generation instead.
  const verdict = remoteState({
    fileBody: SIG_A,
    remoteSize: SIG_A.length,
    remoteEtag: `${md5(SIG_A)}-3`,
  });
  assert.equal(verdict, 'identical');
});

test('an ETag lookup failure is unknown, never a verified multipart size match', () => {
  const verdict = remoteState({
    fileBody: SIG_A,
    remoteSize: SIG_A.length,
    remoteEtag: null,
    etagFailure: true,
    getFailure: true,
  });
  assert.equal(
    verdict,
    'metadata-unavailable',
    'a failed authenticated metadata read must not let a same-size large artifact skip upload',
  );
});

test('an opaque provider ETag does not prevent generation-pinned byte verification', () => {
  const verdict = remoteState({
    fileBody: SIG_A,
    remoteSize: SIG_A.length,
    remoteEtag: 'opaque-provider-etag',
  });
  assert.equal(verdict, 'identical');
});

test('BOTH the upload skip and the storage verifier decide via remote_state', () => {
  const src = source();

  // POSITIVE CONTROL FIRST. An absence assertion whose search is broken looks exactly
  // like an absence, so establish that the thing we expect IS findable before
  // concluding anything from what is not.
  const uses = src.match(/remote_state "\$\{KEY_PREFIX\}\/\$\{TAG\}\/\$\{name\}" "\$f"/g) || [];
  assert.ok(
    uses.length >= 2,
    `expected both the upload loop and the verify loop to consult remote_state, found ${uses.length}`,
  );

  // Now the negative: the old shape — comparing a bare size read straight to the local
  // size — must not have come back by any route.
  assert.doesNotMatch(
    src,
    /\$\(s3api_head "\$\{KEY_PREFIX\}\/\$\{TAG\}\/\$\{name\}"\)" == "\$local_size/,
    'the size-equality skip is back: a fixed-length .sig will silently go stale again',
  );
  assert.doesNotMatch(
    src,
    /remote_size" == "\$local_size/,
    'the verifier is comparing sizes directly again, which cannot see a stale companion file',
  );

  const unknownBranches = src.match(/metadata-unavailable\)/g) || [];
  assert.ok(
    unknownBranches.length >= 2,
    'both the upload skip and storage verifier must handle unavailable ETag metadata explicitly',
  );
  assert.doesNotMatch(
    src,
    /s3api_head_etag[\s\S]{0,260}\|\|\s*true/,
    'ETag lookup failures must not be swallowed before remote_state can emit metadata-unavailable',
  );
});

test('mobile upload skip and storage verification are content-aware too', () => {
  const src = fs.readFileSync(MOBILE_UPLOAD, 'utf8');

  // Positive control: establish that both real mobile loops consult the
  // decision function before asserting the old size-only shape is absent.
  const remoteStateCall = 'remote_state "${KEY_PREFIX}/${TAG}/${name}" "$src"';
  const uses = src.split(remoteStateCall).length - 1;
  assert.ok(
    uses >= 2,
    'expected mobile upload and verify loops to consult remote_state, found ' + uses,
  );
  assert.match(src, /release-storage\.sh/);
  assert.match(src, /remote_state\(\) \{ release_storage_state/);
  assert.equal(
    src.includes('if [[ "$(s3api_head "${KEY_PREFIX}/${TAG}/${name}")" == "$local_size" ]]'),
    false,
    'mobile upload must not skip solely because ContentLength equals the local size',
  );
  assert.equal(
    src.includes('if [[ "$remote_size" == "$local_size" ]]'),
    false,
    'mobile storage verification must not report success from ContentLength alone',
  );
  assert.match(src, /metadata-unavailable/, 'mobile path must fail closed when ETag metadata is unavailable');
});

test('mobile remote_state catches a stale same-size APK signature', () => {
  assert.equal(SIG_A.length, SIG_B.length);
  const verdict = remoteState({
    scriptPath: MOBILE_UPLOAD,
    fileBody: SIG_A,
    remoteBody: SIG_B,
    remoteSize: SIG_B.length,
    remoteEtag: md5(SIG_B),
  });
  assert.equal(verdict, 'differs');
});

test('mobile remote_state compares multipart bytes instead of trusting the ETag suffix', () => {
  const staleMultipart = remoteState({
    scriptPath: MOBILE_UPLOAD,
    fileBody: SIG_A,
    remoteSize: SIG_A.length,
    remoteBody: SIG_B,
    remoteEtag: md5(SIG_B) + '-7',
  });
  assert.equal(staleMultipart, 'differs');

  const sameMultipart = remoteState({
    scriptPath: MOBILE_UPLOAD,
    fileBody: SIG_A,
    remoteSize: SIG_A.length,
    remoteBody: SIG_A,
    remoteEtag: md5(SIG_A) + '-7',
  });
  assert.equal(sameMultipart, 'identical');

  const unavailable = remoteState({
    scriptPath: MOBILE_UPLOAD,
    fileBody: SIG_A,
    remoteSize: SIG_A.length,
    remoteEtag: null,
    etagFailure: true,
    getFailure: true,
  });
  assert.equal(unavailable, 'metadata-unavailable');
});

test('public verification accepts byte-identical manifests only when VERSION identity advances exactly', () => {
  const result = publicManifestVerification({
    version: '9.8.7',
    channel: 'stable',
    // The served bytes are identical to the uploaded local manifest, but that
    // manifest is stale by one version. A bytes-only check would incorrectly
    // pass this exact release-stuck scenario.
    localIdentity: { version: '9.8.6', channel: 'stable' },
    feedPaths: ['stable/latest.json'],
  });

  assert.notEqual(result.status, 0, 'a stale byte-identical feed must fail closed');
  assert.match(
    result.stderr,
    /identifies 9\.8\.6\/stable, expected 9\.8\.7\/stable/,
    'the failure must name both served and intended release identities',
  );
});

test('public verification rejects a byte-identical manifest with the wrong CHANNEL', () => {
  const result = publicManifestVerification({
    version: '9.8.7',
    channel: 'stable',
    localIdentity: { version: '9.8.7', channel: 'beta' },
    feedPaths: ['stable/latest.json'],
  });

  assert.notEqual(result.status, 0, 'a channel-mismatched feed must fail closed');
  assert.match(result.stderr, /identifies 9\.8\.7\/beta, expected 9\.8\.7\/stable/);
});

test('public verification enumerates update-lane channel feed first and permanent root last', () => {
  const result = publicManifestVerification({
    version: '9.8.7',
    channel: 'stable',
    feedPaths: ['stable/latest.json', 'latest.json'],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.requestPaths, ['stable/latest.json', 'latest.json']);
});

test('public verification enumerates nightly as side-by-side feed only, never the root', () => {
  const result = publicManifestVerification({
    version: '9.8.7',
    channel: 'nightly',
    feedPaths: ['nightly/latest.json'],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.requestPaths, ['nightly/latest.json']);
  assert.equal(result.requestPaths.includes('latest.json'), false);
});

test('public verification applies the same feed rail to the optional Server manifest', () => {
  const result = publicManifestVerification({
    version: '9.8.7',
    channel: 'stable',
    manifestName: 'latest-server.json',
    feedPaths: ['stable/latest-server.json', 'latest-server.json'],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.requestPaths, ['stable/latest-server.json', 'latest-server.json']);
});
