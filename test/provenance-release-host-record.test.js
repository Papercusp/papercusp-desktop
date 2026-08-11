// WI-37746 — the shipped provenance must say WHICH RELEASE HOST the binaries poll.
//
// THE BUG (WI-37738, shipped for real on 2026-07-28). The release host is baked into
// the binary at COMPILE time (option_env! PAPERCUSP_RELEASE_HOST -> baked_release_host()
// in main.rs), while the publish target is read from the environment at UPLOAD time.
// Re-point the host between build and upload — or build on a box with a stale
// release-host.env — and you produce binaries that ask the OLD prefix forever, then
// upload them to the NEW one. Nothing errors. Every install from that build is
// permanently stranded: the old prefix keeps answering 200 with a frozen manifest, so
// the app is told it is current and never updates again. It took ~2 weeks and a
// real-VM pass to notice.
//
// WHY THE PRE-EXISTING GUARD WAS NOT ENOUGH. upload-release.sh already scanned the
// artifacts with `strings`, but it greps for the CURRENT host, so an artifact baked to
// a DIFFERENT HOST matches nothing, is skipped rather than counted, and fell into the
// "could not read a baked host" branch — a WARNING THAT SHIPPED. Measured on fixtures
// 2026-08-11, publishing to host H prefix P:
//     baked H/P       -> verified OK
//     baked H/OTHER   -> BLOCKS (exit 1)     <- the scan works for prefix drift
//     baked OTHER/... -> WARNS ONLY, SHIPS   <- the silent stranding path
// And the warning was not a corner case: running upload-release.sh against the REAL,
// already-published 0.0.15 cut gave host_checked=0 — all 16 artifacts are compressed
// (AppImage/.deb/.dmg/.tar.gz/.exe/.zip), so `strings` found no baked host in ANY of
// them. "UNVERIFIED" was the ROUTINE outcome on the release that actually shipped.
//
// So the shipped bytes cannot be the evidence. The BUILD is the only place the baked
// value is known for certain, which is what `releaseHostSha256` records.
//
// WHY A FINGERPRINT AND NOT THE URL: build-provenance.json ships NEXT TO the artifacts
// (and the release identity gate scans what ships), and the URL's path segment is the
// unguessable secret that keeps the bucket unlisted (D-002/D-003). A hash still answers
// the only question publish time asks while carrying nothing secret — so the no-leak
// half is asserted here, not just intended.
//
// Tests run the REAL emitter as a subprocess — the contract is what the script EMITS,
// and a source-text regex cannot tell a contract from a comment describing one.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin');
const EMITTER = path.join(BIN, 'emit-build-provenance.sh');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// A fixture host with an obviously fake secret path segment. It must never appear in
// the emitted file — that assertion is the no-leak guard.
const FIXTURE_HOST = 'https://pub-testfixture.r2.dev/NOTAREALSECRETPREFIX';
const FIXTURE_SECRET = 'NOTAREALSECRETPREFIX';

/**
 * Run the real emitter with the given PAPERCUSP_RELEASE_HOST and return both the parsed
 * provenance and its raw text (the raw text is what the leak assertion needs — a value
 * could hide in a field this test does not name).
 */
function emit(releaseHost) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prov-relhost-')), 'out');
  fs.mkdirSync(out, { recursive: true });
  const artifact = path.join(out, 'App_0.0.0_amd64.deb');
  fs.writeFileSync(artifact, 'fixture');

  const env = { ...process.env, PROVENANCE_GIT_ROOT: path.join(BIN, '..') };
  // Distinguish "not set at all" from "set to empty": both must encode as null.
  if (releaseHost === undefined) delete env.PAPERCUSP_RELEASE_HOST;
  else env.PAPERCUSP_RELEASE_HOST = releaseHost;

  const r = spawnSync('bash', [EMITTER, out, '0.0.0', 'testsha', 'false', artifact], {
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 0, `emitter exited ${r.status}: ${r.stderr}`);
  const raw = fs.readFileSync(path.join(out, 'build-provenance.json'), 'utf8');
  return { prov: JSON.parse(raw), raw };
}

test('records the baked release host as sha256, so publish time has non-heuristic evidence', () => {
  const { prov } = emit(FIXTURE_HOST);
  assert.equal(
    prov.releaseHostSha256,
    sha256(FIXTURE_HOST),
    'releaseHostSha256 must be sha256(PAPERCUSP_RELEASE_HOST) — upload-release.sh compares it against sha256 of the publish base to decide whether these bytes were built for this host',
  );
});

test('never writes the host URL or its secret path segment into a file that ships', () => {
  const { raw } = emit(FIXTURE_HOST);
  assert.ok(
    !raw.includes(FIXTURE_HOST),
    'the release host URL leaked into build-provenance.json — it ships next to the artifacts and must only ever be fingerprinted',
  );
  assert.ok(
    !raw.includes(FIXTURE_SECRET),
    'the secret path segment of the release host leaked into build-provenance.json — that path is what keeps the bucket unlisted (D-002/D-003)',
  );
});

test('a trailing slash does not change the fingerprint (the emitter/uploader interop contract)', () => {
  // upload-release.sh compares against sha256 of "${BASE%/}". If either side stops
  // stripping the trailing slash, every cut fails the host check for a purely cosmetic
  // difference — and the natural "fix" under release pressure is to reach for
  // ALLOW_HOST_MISMATCH=1, which disables the real guard. Pin both sides here.
  const withSlash = emit(`${FIXTURE_HOST}/`).prov.releaseHostSha256;
  const without = emit(FIXTURE_HOST).prov.releaseHostSha256;
  assert.equal(withSlash, without, 'trailing-slash normalization diverged between the emitter and upload-release.sh');
  assert.equal(withSlash, sha256(FIXTURE_HOST), 'the normalized form must be the slash-less URL');
});

for (const [label, value] of [['unset', undefined], ['empty', '']]) {
  test(`no baked host (${label}) encodes as present-and-null, never a missing key`, () => {
    const { prov } = emit(value);
    assert.ok(
      'releaseHostSha256' in prov,
      'the key must be PRESENT-and-null when no host is baked: upload-release.sh reports a MISSING key as "a pre-WI-37746 build" and null as "nothing was baked", and collapsing the two re-hides the gap this closed',
    );
    assert.equal(prov.releaseHostSha256, null, `expected null with no baked host, got ${JSON.stringify(prov.releaseHostSha256)}`);
  });
}
