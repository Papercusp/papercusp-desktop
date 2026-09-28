// WI-10003577 — bin/audit-bundle.sh must be a pure DELEGATE to the one release gate
// (bin/audit-release-bundle.py), never a second scanner with a second allowlist.
//
// WHY THIS TEST EXISTS
// audit-bundle.sh used to scan for PostHog keys itself, masking exactly one literal
// (our public project key). The canonical gate absorbed those rules in 2026-07 and
// grew the curated BENIGN_ERE list — including third-party vendors' OWN anon keys
// compiled into packages we ship. The old copy was never retired, the two lists
// drifted, and the 0.0.22 mac cut went red after every platform had built and
// signed: the Server sidecar ships lost-pixel ON PURPOSE (design comparison), and
// lost-pixel/dist/constants.js carries lost-pixel's own phc_ key — benign to the
// canonical gate, a "leak" to the stale copy.
//
// The assertions are BEHAVIOURAL and DERIVED: the benign keys are read out of the
// canonical gate's own source, so this file holds no second copy of the list — a
// copy here would be the very drift it guards against.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const WRAPPER = path.join(root, 'bin/audit-bundle.sh');
const AUDIT = path.join(root, 'bin/audit-release-bundle.py');
const RELEASE_LOCAL = path.join(root, 'bin/release-local.sh');

// Synthetic, per release-identity-scan-archives.test.js: the certify path refuses
// (exit 2) without an asserted owner-name literal, and a real identity in tracked
// source is the exact leak this gate exists to prevent.
const AUDIT_ENV = { ...process.env, PAPERCUSP_RELEASE_OWNER_NAME: 'Zzsynthetic Gateowner' };

// Shaped like a real project key (the gate's regex is phc_ + 30+ [A-Za-z0-9_]) but
// on no allowlist. Built at runtime so no key-shaped literal sits in tracked source.
const UNLISTED_KEY = ['phc', 'Zq7'.repeat(14)].join('_');

/** The phc_ literals the canonical gate accepts, parsed from BENIGN_ERE itself. */
function canonicalBenignProjectKeys() {
  const src = fs.readFileSync(AUDIT, 'utf8');
  const block = src.match(/^BENIGN_ERE = \[([\s\S]*?)^\]/m);
  assert.ok(block, 'BENIGN_ERE list not found in audit-release-bundle.py');
  const keys = [...block[1].matchAll(/r"(phc_[A-Za-z0-9_]{30,})"/g)].map((m) => m[1]);
  // Positive control: an empty parse would make every assertion below vacuous.
  assert.ok(keys.length >= 2, `expected >=2 benign phc_ keys in BENIGN_ERE, parsed ${keys.length}`);
  return keys;
}

/** A sidecar-shaped tree with `key` where lost-pixel really carries its own. */
function sidecarFixture(t, key) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-bundle-delegate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tree = path.join(dir, 'sidecar');
  const dist = path.join(tree, 'node_modules/lost-pixel/dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'constants.js'), `exports.POST_HOG_API_KEY = "${key}";\n`);
  // Padding so --scan-artifact's expansion-coverage guard is meaningful.
  fs.writeFileSync(path.join(tree, 'padding.txt'), 'sidecar-data\n'.repeat(1024));
  return { dir, tree };
}

function wrapper(args) {
  return spawnSync('bash', [WRAPPER, ...args], { encoding: 'utf8', env: AUDIT_ENV });
}

function canonical(mode, args) {
  return spawnSync('python3', [AUDIT, mode, ...args], { encoding: 'utf8', env: AUDIT_ENV });
}

test('an unlisted phc_ key in the vendored path is caught by both entry points (positive control)', (t) => {
  // Proves the path IS scanned, so the benign case below passes on the allowlist,
  // not because node_modules went unread.
  const { tree } = sidecarFixture(t, UNLISTED_KEY);
  const viaCanonical = canonical('--scan-dir', [tree]);
  assert.equal(viaCanonical.status, 1, viaCanonical.stdout + viaCanonical.stderr);
  const viaWrapper = wrapper([tree]);
  assert.equal(viaWrapper.status, 1, viaWrapper.stdout + viaWrapper.stderr);
});

test('every key the canonical gate accepts is accepted by audit-bundle.sh (one allowlist)', (t) => {
  for (const key of canonicalBenignProjectKeys()) {
    const { tree } = sidecarFixture(t, key);
    const viaCanonical = canonical('--scan-dir', [tree]);
    assert.equal(viaCanonical.status, 0, `canonical rejected a BENIGN_ERE key:\n${viaCanonical.stdout}${viaCanonical.stderr}`);
    const viaWrapper = wrapper([tree]);
    assert.equal(viaWrapper.status, 0, `audit-bundle.sh disagrees with the canonical gate:\n${viaWrapper.stdout}${viaWrapper.stderr}`);
  }
});

test('a finished artifact argument is routed to --scan-artifact', (t) => {
  const [benign] = canonicalBenignProjectKeys();
  const clean = sidecarFixture(t, benign);
  const cleanArchive = path.join(clean.dir, 'clean.tar.gz');
  execFileSync('tar', ['--owner=0', '--group=0', '--numeric-owner', '-czf', cleanArchive, '-C', clean.tree, '.']);
  const ok = wrapper([cleanArchive]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout + ok.stderr, /identity-scan of FINISHED artifacts/);

  const dirty = sidecarFixture(t, UNLISTED_KEY);
  const dirtyArchive = path.join(dirty.dir, 'dirty.tar.gz');
  execFileSync('tar', ['--owner=0', '--group=0', '--numeric-owner', '-czf', dirtyArchive, '-C', dirty.tree, '.']);
  const bad = wrapper([dirtyArchive]);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
});

test('a missing artifact is refused, never reported clean', () => {
  const r = wrapper([path.join(os.tmpdir(), 'no-such-artifact-WI-10003577.dmg')]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test('audit-bundle.sh carries no key literal or allowlist of its own', () => {
  const src = fs.readFileSync(WRAPPER, 'utf8');
  // A key literal anywhere — comments included — is a second allowlist in waiting.
  assert.doesNotMatch(src, /ph[cx]_[A-Za-z0-9_]{30,}/, 'a key literal in audit-bundle.sh is a second allowlist');
  // The header explains the history in prose; only executable lines must not scan.
  const code = src.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(code, /PUBLIC_PROJECT_KEY|NEEDLES|\bgrep\b/, 'audit-bundle.sh must delegate, not scan');
  assert.match(code, /audit-release-bundle\.py/);
});

test('release-local.sh scans the finished mac dmgs with the canonical gate', () => {
  const code = fs.readFileSync(RELEASE_LOCAL, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  assert.doesNotMatch(code, /audit-bundle\.sh/, 'release-local.sh must not call the retired scanner');
  assert.match(code, /audit-release-bundle\.py" --scan-artifact "\$MAC_OUT"\/dmg\//);
});
