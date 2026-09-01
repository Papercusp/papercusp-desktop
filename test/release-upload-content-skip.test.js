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

// Run `remote_state` from the real script against a stubbed `aws`.
//
// The helpers are EXTRACTED and evaluated rather than the script being sourced: the
// script is a top-to-bottom release publisher and sourcing it would try to publish.
// Extraction is bounded by two structural markers that exist for other reasons.
function remoteState({
  fileBody,
  remoteBody = fileBody,
  remoteSize,
  remoteEtag,
  etagFailure = false,
  getFailure = false,
  scriptPath = UPLOAD,
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-upload-skip-'));
  try {
    const file = path.join(dir, 'artifact.sig');
    fs.writeFileSync(file, fileBody);

    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    // Stub aws: answers head-object for whichever --query is asked, from the env.
    // An absent object is a non-zero exit, which is how the real helper sees a 404.
    fs.writeFileSync(
      path.join(bin, 'aws'),
      [
        '#!/bin/bash',
        'q=""',
        'for ((i=1;i<=$#;i++)); do',
        '  if [[ "${!i}" == "--query" ]]; then j=$((i+1)); q="${!j}"; fi',
        'done',
        'if [[ "$*" == *"get-object"* ]]; then [[ "${FAKE_GET_MODE:-value}" == error ]] && exit 1; printf "%s" "${FAKE_REMOTE_BODY:-}" > "${!#}"; echo "{}"; exit 0; fi',
        '[[ -z "${FAKE_SIZE:-}" ]] && exit 1',
        'case "$q" in',
        '  ContentLength) echo "$FAKE_SIZE" ;;',
        '  ETag) [[ "${FAKE_ETAG_MODE:-value}" == error ]] && exit 1; [[ "${FAKE_ETAG_MODE:-value}" == none ]] && { echo None; exit 0; }; [[ -z "${FAKE_ETAG:-}" ]] && exit 1; echo "\\"$FAKE_ETAG\\"" ;;',
        'esac',
        'exit 0',
      ].join('\n'),
      { mode: 0o755 },
    );

    const harness = `
set -euo pipefail
eval "$(awk '/^s3api_head\\(\\) \\{/{f=1} /^# ── What to upload/{f=0} f{print}' "$UPLOAD_SCRIPT")"
ENDPOINT=https://example.invalid
R2_BUCKET=bucket
remote_state "some/key" "$TARGET_FILE"
`;
    const res = spawnSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        UPLOAD_SCRIPT: scriptPath,
        TARGET_FILE: file,
        FAKE_SIZE: remoteSize === null ? '' : String(remoteSize),
        FAKE_ETAG: remoteEtag === null ? '' : remoteEtag,
        FAKE_REMOTE_BODY: remoteBody,
        FAKE_GET_MODE: getFailure ? 'error' : 'value',
        FAKE_ETAG_MODE: etagFailure ? 'error' : remoteEtag === 'None' ? 'none' : 'value',
      },
    });
    assert.equal(res.status, 0, `harness failed: ${res.stderr}`);
    return res.stdout.trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test('a multipart ETag cannot be compared to a local hash, and says so instead of guessing', () => {
  // Multi-GB artifacts upload multipart, whose ETag is "<md5-of-part-md5s>-<partcount>".
  // That is NOT a content hash. The honest verdict is "size is all I know" — which the
  // caller is then free to accept for a 4 GB artifact and refuse for a 428 B one.
  const verdict = remoteState({
    fileBody: SIG_A,
    remoteSize: SIG_A.length,
    remoteEtag: `${md5(SIG_A)}-3`,
  });
  assert.equal(verdict, 'size-only-match');
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

test('an opaque non-multipart ETag is unknown, not size-only evidence', () => {
  const verdict = remoteState({
    fileBody: SIG_A,
    remoteSize: SIG_A.length,
    remoteEtag: 'opaque-provider-etag',
  });
  assert.equal(verdict, 'metadata-unavailable');
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
  assert.match(src, /s3api_head_etag\(\)/);
  assert.match(src, /s3api_get_object\(\)/);
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
