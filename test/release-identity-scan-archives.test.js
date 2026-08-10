// P-012 (plan memory-corpus-hygiene-and-release-distribution-2026-08-03) —
// the release identity scan must read the bytes that ACTUALLY ship: binary files
// and the contents of archives.
//
// WHY THIS TEST EXISTS
// audit-release-bundle.py --scan-dir calls itself "the ultimate backstop … scan the
// bytes that ship" and honours no path-exclude. It ran `grep -rIlE`, and `-I` SKIPS
// BINARY FILES — so it never opened a database dump, a corestore, or any archive,
// and printed "✓ CLEAN". A scan that inspected nothing is indistinguishable from a
// scan that found nothing; this is the same do-nothing-reads-as-success family as
// `tsc -p .` checking zero files. Compression makes it worse: even with `-a`, an
// archive's payload is not present in its own bytes, so it must be EXPANDED.
//
// Measured 2026-08-08 against the real 5.8G assembled sidecar: of db-seed.tar.gz's
// 3,836 members, exactly one leaked — postmaster.opts, which Postgres writes at
// startup containing the full postmaster ARGV, i.e. the BUILDER's absolute home
// path, username and workspace layout. It had been shipping in every desktop
// bundle, invisible to the gate that exists to catch precisely that.
//
// These assertions are BEHAVIOURAL: they run the real script against fixtures and
// check its exit code, rather than grepping it for flags. A flag-grep would pass
// against a rewrite that reintroduced the hole by another route.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const AUDIT = path.join(root, 'bin/audit-release-bundle.py');

/** A real high-entropy identity literal, from the gate's OWN source of truth. */
function identityLiteral() {
  const r = spawnSync('python3', [AUDIT, '--identity-literals'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--identity-literals failed: ${r.stderr}`);
  for (const line of r.stdout.split('\n')) {
    const value = line.split('\t')[0];
    // Long enough to be high-entropy (scanned in ALL files, not just non-vendor).
    if (value && value.length > 12) return value;
  }
  throw new Error('no high-entropy identity literal available on this host');
}

function scanDir(dir) {
  return spawnSync('python3', [AUDIT, '--scan-dir', dir], { encoding: 'utf8' });
}

function fixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `p012-${name}-`));
  fs.mkdirSync(path.join(dir, 'bundle'));
  return dir;
}

test('a literal in a BINARY file fails the scan (the -I regression)', () => {
  const lit = identityLiteral();
  const dir = fixture('bin');
  try {
    // NUL bytes make grep classify this as binary; `-I` skipped it entirely.
    fs.writeFileSync(
      path.join(dir, 'bundle/blob.bin'),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(lit), Buffer.from([0, 3])]),
    );
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 1, `expected FAIL on a binary carrying an identity literal:\n${r.stdout}`);
    assert.match(r.stdout, /blob\.bin/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a literal INSIDE a .tar.gz fails the scan and names the member', () => {
  const lit = identityLiteral();
  const dir = fixture('arc');
  try {
    const stage = path.join(dir, 'stage');
    fs.mkdirSync(stage);
    fs.writeFileSync(path.join(stage, 'secret.txt'), `leaked ${lit}\n`);
    execFileSync('tar', ['-czf', path.join(dir, 'bundle/db-seed.tar.gz'), '-C', stage, 'secret.txt']);
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 1, `expected FAIL on an archive carrying an identity literal:\n${r.stdout}`);
    // The member must be named — "some archive is dirty" is not actionable.
    assert.match(r.stdout, /db-seed\.tar\.gz!secret\.txt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// CALIBRATION CONTROL: without this, a scan that failed on EVERYTHING would satisfy
// both assertions above while being useless.
test('a clean bundle — including a clean archive and a clean binary — passes', () => {
  const dir = fixture('clean');
  try {
    fs.writeFileSync(path.join(dir, 'bundle/a.txt'), 'nothing sensitive here\n');
    fs.writeFileSync(path.join(dir, 'bundle/b.bin'), Buffer.from([0, 1, 2, 3, 4]));
    const stage = path.join(dir, 'stage');
    fs.mkdirSync(stage);
    fs.writeFileSync(path.join(stage, 'ok.txt'), 'harmless\n');
    execFileSync('tar', ['-czf', path.join(dir, 'bundle/src.tar.gz'), '-C', stage, 'ok.txt']);
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 0, `expected PASS on a clean bundle:\n${r.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an archive the gate cannot open FAILS rather than being skipped', () => {
  const dir = fixture('bad');
  try {
    fs.writeFileSync(path.join(dir, 'bundle/broken.tar.gz'), 'not actually gzip');
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 1, `an uninspectable archive must not report CLEAN:\n${r.stdout}`);
    assert.match(r.stdout, /COULD NOT BE INSPECTED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// WI-37620. The test above is right that an UNREADABLE archive must fail. But the
// gate applied that verdict to a READABLE tar it merely refused to WRITE: tar-fs
// vendors test/fixtures/invalid.tar, whose links deliberately escape the extraction
// root, and `tarfile.extractall` on Python >=3.12 raises on it (the `data` filter is
// correct to refuse). That halted the 0.0.14 release at minute 22 of a 22-minute cut
// on bytes that were perfectly readable. Reading member-wise fixes it WITHOUT
// weakening anything — which is exactly what these two assertions pin: a hostile
// member must not stop the scan, AND a literal hiding behind one must still be caught.
test('a tar whose links escape the root is still SCANNED, and a literal inside it is caught', () => {
  const lit = identityLiteral();
  const dir = fixture('hostile');
  try {
    const stage = path.join(dir, 'stage');
    fs.mkdirSync(stage);
    fs.symlinkSync('../', path.join(stage, 'foo'));           // the escaping member
    fs.writeFileSync(path.join(stage, 'secret.txt'), `leaked ${lit}\n`);
    execFileSync('tar', ['-cf', path.join(dir, 'bundle/hostile.tar'), '-C', stage, 'foo', 'secret.txt']);
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 1, `a hostile member must not hide a literal:\n${r.stdout}`);
    // The specific regression: it must FAIL on the literal, not on inspectability.
    assert.doesNotMatch(r.stdout, /COULD NOT BE INSPECTED/);
    assert.match(r.stdout, /hostile\.tar!secret\.txt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Coverage extractall never had: it materialises member paths as real directories,
// and the scan greps file CONTENTS — so an identity literal that appears only in a
// member's PATH was invisible. Member names are now written to a manifest and read.
test('an identity literal in an archive member PATH is caught, not just in contents', () => {
  const lit = identityLiteral();
  const dir = fixture('pathlit');
  try {
    const stage = path.join(dir, 'stage', `home-${lit}`);
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'harmless.txt'), 'nothing sensitive here\n');
    execFileSync('tar', ['-czf', path.join(dir, 'bundle/paths.tar.gz'),
                         '-C', path.join(dir, 'stage'), `home-${lit}`]);
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 1, `a literal in a member PATH must fail the scan:\n${r.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// WI-37553 — the HIGH/LOW entropy asymmetry. `-a` (read binary as text) is correct
// for a high-entropy literal and WRONG for a low-entropy one: a ~3-char bare first
// name word-boundary-matched across gigabytes of compiled/compressed bytes matches
// constantly by chance and carries no information. Measured on the 0.0.14 AppDir,
// 9 of 16 "leaks" were exactly that noise — including glibc's own libm.so.6 and a
// Go symbol naming the AVI video format — and it nearly cost days of work removing
// a real feature to fix nothing. These two tests pin BOTH directions, because
// "stop crying wolf" and "stop catching real leaks" are one edit apart.
function lowEntropyLiteral() {
  const r = spawnSync('python3', [AUDIT, '--identity-literals'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--identity-literals failed: ${r.stderr}`);
  for (const line of r.stdout.split('\n')) {
    const [value, , low] = line.split('\t');
    if (value && low === '1') return value;
  }
  return null; // this host declares no low-entropy identity — nothing to assert
}

test('a LOW-entropy literal in a BINARY file does NOT fail the scan (noise, not evidence)', () => {
  const lit = lowEntropyLiteral();
  if (!lit) return; // no low-entropy literal on this host
  const dir = fixture('lowbin');
  try {
    // NUL bytes ⇒ grep classifies it binary, exactly like a .so / packfile / corestore.
    // ⚠ The literal MUST sit at a real word boundary (space before, `=` after) or this
    // test passes vacuously: the scan matches `\bLit\b`, so an `xLit=` fixture never
    // matches at all and the assertion proves nothing. That mistake was made here once.
    fs.writeFileSync(
      path.join(dir, 'bundle/blob.bin'),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(` ${lit}=`), Buffer.from([0, 3])]),
    );
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 0,
      `a bare first name inside BINARY bytes is chance, not a leak:\n${r.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a LOW-entropy literal in a TEXT file STILL fails the scan (the gate keeps its power)', () => {
  const lit = lowEntropyLiteral();
  if (!lit) return;
  const dir = fixture('lowtext');
  try {
    fs.writeFileSync(path.join(dir, 'bundle/notes.txt'), `written by ${lit} today\n`);
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 1,
      `a bare first name in TEXT is still a real leak and must fail:\n${r.stdout}`);
    assert.match(r.stdout, /notes\.txt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the PGDATA seed excludes both postmaster.pid and postmaster.opts', () => {
  // The actual leak found in the shipping bundle. Both record build-box absolute
  // paths; PG rewrites both on next start, so neither is needed to restore a seed.
  const seed = fs.readFileSync(
    path.join(root, '../libs/papercusp/packages/embedded-postgres-server/bin/build-seed.mjs'),
    'utf8',
  );
  for (const f of ['./postmaster.pid', './postmaster.opts']) {
    assert.equal(
      seed.includes(`'${f}'`),
      true,
      `build-seed.mjs no longer excludes ${f} from db-seed.tar.gz — it records the ` +
        "builder's absolute paths and the archive ships inside the public desktop bundle (P-012).",
    );
  }
});

// ── WI-37553: owner-authorised seed-corestore content ────────────────────────
// The seed corestore IS the pot's own hive log and this alpha ships the pot
// READABLE by explicit owner decision, so the build box's MACHINE LABEL is
// present there in two forms: a `presence` row inside a signed hypercore block
// (editing it breaks content-addressing) and RocksDB `host.identity` table
// properties in the *.sst files. The gate accepts exactly those two literals,
// exactly under a seed corestore path — an ACCEPTANCE, not an exclude.
//
// The THIRD test is the one that matters: it proves the acceptance is
// PATH-SCOPED. A whitelist that had accidentally gone global would still pass
// the first two while silently no longer catching the build hostname anywhere
// else in the bundle — a far bigger hole than the one deliberately allowed.
function gateLiterals() {
  const r = spawnSync('python3', [AUDIT, '--identity-literals'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--identity-literals failed: ${r.stderr}`);
  return r.stdout.split('\n').map((l) => l.split('\t')[0]).filter(Boolean);
}

function seedFixture(name, bytes) {
  const dir = fixture(name);
  const db = path.join(dir, 'bundle/seed/corestore/db');
  fs.mkdirSync(db, { recursive: true });
  fs.writeFileSync(path.join(db, '000009.sst'), bytes);
  return dir;
}

test('seed corestore carrying ONLY the build machine label is ACCEPTED', (t) => {
  const host = os.hostname();
  if (!gateLiterals().includes(host)) return t.skip('hostname is not a gate literal here');
  const dir = seedFixture('seed-ok', `host.identity${host}\n`);
  try {
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 0, `expected the owner-authorised seed to PASS:\n${r.stdout}`);
    assert.match(r.stdout, /ACCEPTED 1 seed-corestore file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seed corestore carrying a NON-authorised literal still FAILS', (t) => {
  const host = os.hostname();
  const home = os.homedir();
  const lits = gateLiterals();
  if (!lits.includes(host) || !lits.includes(home)) return t.skip('literals unavailable here');
  // The authorised label is present too, so the failure must come from the home
  // path alone — proving acceptance is per-LITERAL, not per-file.
  const dir = seedFixture('seed-bad', `host.identity${host}\nargv=${home}/x\n`);
  try {
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 1, `a home path inside the seed must still FAIL:\n${r.stdout}`);
    assert.match(r.stdout, /NON-authorised identity/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the machine label is accepted ONLY under a seed corestore path', (t) => {
  const host = os.hostname();
  if (!gateLiterals().includes(host)) return t.skip('hostname is not a gate literal here');
  const dir = fixture('seed-scope');
  try {
    // Same bytes, ordinary bundle path: must still fail, or the acceptance has
    // become a global whitelist for the build hostname.
    fs.writeFileSync(path.join(dir, 'bundle/notes.txt'), `built on ${host}\n`);
    const r = scanDir(path.join(dir, 'bundle'));
    assert.equal(r.status, 1, `the hostname outside the seed must still FAIL:\n${r.stdout}`);
    assert.match(r.stdout, /notes\.txt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
