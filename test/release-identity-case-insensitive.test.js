// EI-20589264759185712 / D-112 — machine identity must be hunted case-insensitively.
//
// WHY THIS TEST EXISTS
// Generated text can re-case build-home or host values while still identifying the same
// machine. One shared rule (lit_ere) feeds the scan, source-leaker selection and scrub.
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
// The fixture HOME is synthetic. Owner name/email are intentionally absent because D-112
// permits them and removes them from the release identity literal set.

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

const MACHINE_HOME = '/tmp/ZzSyntheticMachineHome';
const env = { ...process.env, HOME: MACHINE_HOME };

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

test('--identity-literals emits a case-folded pattern for build HOME', () => {
  const row = identityLiteralRow(MACHINE_HOME);
  assert.ok(row, 'no --identity-literals row for synthetic build HOME');

  const [, , wordBoundary, sedEre] = row;
  assert.equal(wordBoundary, '0', 'a home path must remain a substring hunt');
  assert.ok(sedEre, 'column 4 (the ready sed -E pattern) must be emitted');

  // The whole point: the letters are folded into classes, so every consumer of this
  // pattern is case-insensitive without needing a flag it may not support.
  assert.match(sedEre, /\[zZ\]/, 'expected a folded character class, got a bare literal');
  assert.ok(
    !sedEre.includes(MACHINE_HOME),
    'the pattern still carries the literal-cased path — it will miss a re-cased form',
  );
});

test('the emitted pattern matches a re-cased build-home leak', () => {
  const [, , , sedEre] = identityLiteralRow(MACHINE_HOME);
  const dir = mkfixture({
    'leak.sql': `-- built from ${MACHINE_HOME.toLowerCase()}/workspace\n`,
    'innocent.txt': 'video.avi and unrelated text\n',
  });

  const hit = spawnSync('grep', ['-nE', sedEre, path.join(dir, 'leak.sql')], { encoding: 'utf8' });
  assert.equal(hit.status, 0, 'the gate pattern must match the re-cased HOME');

  const miss = spawnSync('grep', ['-nE', sedEre, path.join(dir, 'innocent.txt')], {
    encoding: 'utf8',
  });
  assert.equal(miss.status, 1, `pattern fired on unrelated text: ${miss.stdout}`);

  // And it must survive the round trip into the stager's `sed -E` scrub, which is a
  // different ERE engine from grep's and must agree about the folded class.
  const scrubbed = execFileSync('sed', ['-E', `s/${sedEre}/[buildhome]/g`, path.join(dir, 'leak.sql')], {
    encoding: 'utf8',
  });
  assert.ok(scrubbed.includes('[buildhome]'), `sed did not redact: ${scrubbed}`);
  assert.ok(!scrubbed.toLowerCase().includes(MACHINE_HOME.toLowerCase()), `HOME survived the scrub: ${scrubbed}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('--source-leakers nominates a file whose only hit is re-cased build HOME', () => {
  // This is the leg that decides WHICH files the stager rewrites. It failing is what
  // made the leak unreachable: the file was never handed to the scrub at all, so no
  // amount of correctness in the replacement step could have saved it.
  const dir = mkfixture({
    'packages/thing/notes.sql': `-- generated under ${MACHINE_HOME.toLowerCase()}/src\n`,
  });

  const out = execFileSync('python3', [AUDIT, '--source-leakers', dir, 'packages'], {
    encoding: 'utf8',
    env,
  });

  assert.match(
    out,
    /packages\/thing\/notes\.sql/,
    `the re-cased machine leaker was not nominated for scrubbing:\n${out}`,
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('occurrence-aware scrub removes machine HOME but preserves media and opaque hashes', () => {
  const dir = mkfixture({
    'mixed.js': [
      `const buildHome = "${MACHINE_HOME.toLowerCase()}";`,
      'const formats = ["mp4", "webm", "avi", "wmv"];',
      'const chunk = "factor-zED-w_hC.js";',
    ].join('\n'),
  });
  const file = path.join(dir, 'mixed.js');

  const before = spawnSync('python3', [AUDIT, '--scan-dir', dir], { encoding: 'utf8', env });
  assert.equal(before.status, 1, `machine identity must fail before scrub:\n${before.stdout}`);
  const scrub = spawnSync('python3', [AUDIT, '--scrub-text', file], { encoding: 'utf8', env });
  assert.equal(scrub.status, 0, `${scrub.stdout}${scrub.stderr}`);

  const body = fs.readFileSync(file, 'utf8');
  assert.ok(!body.toLowerCase().includes(MACHINE_HOME.toLowerCase()), 'machine HOME must be redacted');
  assert.match(body, /"avi"/, 'AVI media support must survive');
  assert.match(body, /factor-zED-w_hC\.js/, 'opaque Vite reference must survive byte-for-byte');
  const after = spawnSync('python3', [AUDIT, '--scan-dir', dir], { encoding: 'utf8', env });
  assert.equal(after.status, 0, `shared classifier must agree after scrub:\n${after.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('archive scanning convicts a re-cased build-home literal', () => {
  const result = auditArchive({
    'apps/operator-vite/dist/assets/provenance.js':
      `export const buildRoot = "${MACHINE_HOME.toLowerCase()}/workspace";\n`,
  });
  assert.equal(result.status, 1, `machine HOME escaped archive scan:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /IN FILE CONTENT|build-home-path/);
});
