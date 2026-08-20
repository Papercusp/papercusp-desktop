// EI-20589264759185712 — the identity gate must hunt the owner's name CASE-INSENSITIVELY.
//
// WHY THIS TEST EXISTS
// The owner's name reached the PUBLISHED 0.0.17 Linux deb in lowercase, inside a SQL
// comment ("Surfaced for avi:"), while every gate reported CLEAN. The matcher built
// `\bAvi\b`, and `avi` is not `Avi`.
//
// What makes it worth a permanent guard is that ONE rule (lit_ere) feeds THREE legs,
// so a single blind spot produced three independent-looking proofs of cleanliness:
//   1. --scan-dir       — the gate's own scan of the shipped bytes: found nothing.
//   2. --source-leakers — WHICH files the stager scrubs: never nominated the file.
//   3. --identity-literals — WHAT the stager replaces: would not have replaced it.
// A test that only covered the gate would have passed while the scrub stayed blind,
// so all three legs are asserted here.
//
// These assertions are BEHAVIOURAL: they run the real script against fixtures and
// check exit codes and output, rather than grepping the source for a flag. A
// flag-grep would pass against a rewrite that reintroduced the hole by another route.
//
// NOTE ON THE FIXTURE NAME: never the owner's real name. It is supplied through
// PAPERCUSP_RELEASE_OWNER_NAME, which is exactly how a box whose git identity is an
// automation supplies it in production — writing the real name into a test file to
// search for it would BE the leak, committed to git forever.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Overridable so falsifiability can be PROVEN against a mutated COPY outside the
// tree (scripts/mutation-probe.sh tier 2). Mutating the real file in place would
// race git-sync, which sweeps and commits the whole working tree on a timer.
const AUDIT = process.env.PROBE_SCRIPT || path.join(__dirname, '..', 'bin', 'audit-release-bundle.py');

// A short, alnum, <6-char name: the class that takes the word-boundary branch, which
// is the branch that was case-sensitive. "Zed" stands in for the real 3-letter name.
const OWNER = 'Zed';
const env = { ...process.env, PAPERCUSP_RELEASE_OWNER_NAME: OWNER };

function identityLiteralRow(name) {
  const out = execFileSync('python3', [AUDIT, '--identity-literals'], {
    encoding: 'utf8',
    env,
  });
  return out
    .split('\n')
    .map((l) => l.split('\t'))
    .find((cols) => cols[0] === name);
}

function mkfixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-identity-case-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

function auditArchive(files) {
  const source = mkfixture(files);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-identity-archive-'));
  const tar = path.join(work, 'fixture.tar');
  const bundle = path.join(work, 'fixture.tar.zst');
  // Mirror stage-source-tree.sh: member ownership is normalized, otherwise this
  // fixture correctly fails on the build host's uname before reaching the case
  // it was created to isolate.
  execFileSync('tar', [
    '--numeric-owner', '--owner=0', '--group=0', '-C', source, '-cf', tar, '.',
  ]);
  execFileSync('zstd', ['-q', '-f', '-o', bundle, tar]);
  const result = spawnSync('python3', [AUDIT, bundle], {
    encoding: 'utf8',
    env,
  });
  fs.rmSync(source, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  return result;
}

test('--identity-literals emits a case-folded pattern for the owner name', () => {
  const row = identityLiteralRow(OWNER);
  assert.ok(row, `no --identity-literals row for ${OWNER}`);

  const [, , wordBoundary, sedEre] = row;
  assert.equal(wordBoundary, '1', 'a short alnum name must take the word-boundary branch');
  assert.ok(sedEre, 'column 4 (the ready sed -E pattern) must be emitted');

  // The whole point: the letters are folded into classes, so every consumer of this
  // pattern is case-insensitive without needing a flag it may not support.
  assert.match(sedEre, /\[zZ\]/, 'expected a folded character class, got a bare literal');
  assert.ok(
    !sedEre.includes(OWNER),
    'the pattern still carries the literal cased name — it will miss the lowercase form',
  );
});

test('the emitted pattern matches the LEAK shape and not a longer word', () => {
  const [, , , sedEre] = identityLiteralRow(OWNER);
  const dir = mkfixture({
    // The exact shape that shipped in the 0.0.17 deb.
    'leak.sql': '--      explicit follow-on. Surfaced for zed: this defers\n',
    // The cry-wolf case the original case-sensitivity was chosen to avoid. The word
    // boundary — not case-sensitivity — is what keeps this clean, which is why
    // dropping case-sensitivity is safe.
    'innocent.txt': 'video.zedx and zedediah are not the owner\n',
  });

  const hit = spawnSync('grep', ['-nE', sedEre, path.join(dir, 'leak.sql')], { encoding: 'utf8' });
  assert.equal(hit.status, 0, 'the gate pattern must match the lowercase name');

  const miss = spawnSync('grep', ['-nE', sedEre, path.join(dir, 'innocent.txt')], {
    encoding: 'utf8',
  });
  assert.equal(miss.status, 1, `pattern fired inside a longer word: ${miss.stdout}`);

  // And it must survive the round trip into the stager's `sed -E` scrub, which is a
  // different ERE engine from grep's and must agree about the folded class.
  const scrubbed = execFileSync('sed', ['-E', `s/${sedEre}/[owner]/g`, path.join(dir, 'leak.sql')], {
    encoding: 'utf8',
  });
  assert.ok(scrubbed.includes('[owner]'), `sed did not redact: ${scrubbed}`);
  assert.ok(!/\bzed\b/i.test(scrubbed), `name survived the scrub: ${scrubbed}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('--source-leakers nominates a file whose ONLY hit is lowercase', () => {
  // This is the leg that decides WHICH files the stager rewrites. It failing is what
  // made the leak unreachable: the file was never handed to the scrub at all, so no
  // amount of correctness in the replacement step could have saved it.
  const dir = mkfixture({
    'packages/thing/notes.sql': '-- Surfaced for zed: a provenance comment\n',
  });

  const out = execFileSync('python3', [AUDIT, '--source-leakers', dir, 'packages'], {
    encoding: 'utf8',
    env,
  });

  assert.match(
    out,
    /packages\/thing\/notes\.sql/,
    `the lowercase-only leaker was not nominated for scrubbing:\n${out}`,
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('opaque asset fingerprints and binary bytes do not convict a short owner name', () => {
  const result = auditArchive({
    // zED-w_hC is an eight-character Vite fingerprint. It happens to contain the
    // whole-word case-folded owner token, but carries no semantic identity.
    'apps/operator-vite/dist/assets/factor-zED-w_hC.js': 'export const factor = 1;\n',
    // The old tar-stream pass forced binary-as-text and convicted this chance hit.
    'apps/operator-vite/dist/assets/random.bin': Buffer.from([0, 122, 69, 100, 0]),
  });
  assert.equal(
    result.status,
    0,
    `hash/binary noise must not block a release:\n${result.stdout}\n${result.stderr}`,
  );
});

test('semantic owner paths and textual owner mentions remain release-blocking controls', () => {
  const pathLeak = auditArchive({
    // Only the opaque suffix is removed. The semantic stem remains searchable.
    'apps/operator-vite/dist/assets/Zed-abcdefgh.js': 'export const clean = true;\n',
  });
  assert.equal(pathLeak.status, 1, `semantic owner path escaped:\n${pathLeak.stdout}`);
  assert.match(pathLeak.stdout, /Zed-abcdefgh\.js/);

  const textLeak = auditArchive({
    'apps/operator-vite/dist/assets/factor-abcdefgh.js':
      '-- Surfaced for zed: this is genuine authored text, not random bytes\n',
  });
  assert.equal(textLeak.status, 1, `text owner mention escaped:\n${textLeak.stdout}`);
  assert.match(textLeak.stdout, /IN FILE CONTENT/);
});
