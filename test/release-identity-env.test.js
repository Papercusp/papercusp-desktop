// WI-10004349 — the desktop release cut must certify against the owner's FULL identity.
//
// 0.0.25 (published) and 0.0.26 (signed) shipped six docs files carrying an owner name
// unscrubbed. release:cut had been handed ONE hand-typed name and no email, while the
// owner-provisioned ~/.papercusp/release-identity.env held two names and two addresses;
// nothing in the cut path read that file, so the partial caller value silently won and the
// identity audit printed "✓ CLEAN" with only a PARTIAL COVERAGE caveat.
//
// bin/lib/release-identity-env.sh closes that: release-local.sh unions the file into the
// environment, then refuses unless a name AND an email resolved. These tests run the real
// library in bash against synthetic identity files, never the developer's own: HOME and
// PAPERCUSP_RELEASE_IDENTITY_ENV are always pointed at a fixture, so the verdict cannot
// depend on whose box runs it.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
// Overridable ONLY so scripts/mutation-probe.sh can point the suite at a mutated copy.
const lib = process.env.RELEASE_IDENTITY_ENV_LIB || path.join(root, 'bin/lib/release-identity-env.sh');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-identity-env-'));
  return { dir, home: path.join(dir, 'home'), file: path.join(dir, 'identity.env') };
}

// Run `body` after sourcing the library, then print the two variables so the test can read
// them. Only synthetic literals ever flow through here.
function run(body, { env = {}, fx }) {
  fs.mkdirSync(fx.home, { recursive: true });
  const script = [
    'set -u',
    `source ${JSON.stringify(lib)}`,
    body,
    'rc=$?',
    'printf "NAME=%s\\nEMAIL=%s\\n" "${PAPERCUSP_RELEASE_OWNER_NAME:-}" "${PAPERCUSP_RELEASE_OWNER_EMAIL:-}"',
    'exit $rc',
  ].join('\n');
  const result = spawnSync('bash', ['-c', script], {
    env: { PATH: process.env.PATH, HOME: fx.home, ...env },
    encoding: 'utf8',
  });
  const out = Object.fromEntries(
    result.stdout
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  return { status: result.status, stderr: result.stderr, name: out.NAME, email: out.EMAIL };
}

test('a partial caller identity is UNIONED with the file, never allowed to shadow it', () => {
  const fx = fixture();
  fs.writeFileSync(
    fx.file,
    'PAPERCUSP_RELEASE_OWNER_NAME="Synth Owner,Sibling Project"\nPAPERCUSP_RELEASE_OWNER_EMAIL=owner@example.test,alt@example.test\n',
  );
  // The exact 0.0.25/0.0.26 shape: one caller-typed name, no email.
  const r = run('papercusp_union_release_identity_env', {
    fx,
    env: { PAPERCUSP_RELEASE_IDENTITY_ENV: fx.file, PAPERCUSP_RELEASE_OWNER_NAME: 'Synth Owner' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.name, 'Synth Owner,Sibling Project');
  assert.equal(r.email, 'owner@example.test,alt@example.test');
  assert.match(r.stderr, /2 owner-name literal\(s\), 2 owner-email literal\(s\)/);
  // Counts only: the literals themselves must never reach the log.
  assert.doesNotMatch(r.stderr, /Sibling Project|example\.test/);
});

test('caller-only literals are kept, de-duplicated and ordered caller-first', () => {
  const fx = fixture();
  fs.writeFileSync(fx.file, "export PAPERCUSP_RELEASE_OWNER_NAME='B Name; A Name'\n");
  const r = run('papercusp_union_release_identity_env', {
    fx,
    env: {
      PAPERCUSP_RELEASE_IDENTITY_ENV: fx.file,
      PAPERCUSP_RELEASE_OWNER_NAME: ' A Name , Caller Only ',
      PAPERCUSP_RELEASE_OWNER_EMAIL: 'caller@example.test',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  // Names keep their inner spaces: whitespace is not a separator (the audit's own rule).
  assert.equal(r.name, 'A Name,Caller Only,B Name');
  assert.equal(r.email, 'caller@example.test');
});

test('the default path is $HOME/.papercusp/release-identity.env', () => {
  const fx = fixture();
  fs.mkdirSync(path.join(fx.home, '.papercusp'), { recursive: true });
  fs.writeFileSync(
    path.join(fx.home, '.papercusp', 'release-identity.env'),
    'PAPERCUSP_RELEASE_OWNER_NAME=Home Owner\nPAPERCUSP_RELEASE_OWNER_EMAIL=home@example.test\n',
  );
  const r = run('papercusp_union_release_identity_env && papercusp_require_release_owner_identity', { fx });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.name, 'Home Owner');
  assert.equal(r.email, 'home@example.test');
});

test('a missing file is not an error by itself: the environment may carry the identity', () => {
  const fx = fixture();
  const r = run('papercusp_union_release_identity_env && papercusp_require_release_owner_identity', {
    fx,
    env: {
      PAPERCUSP_RELEASE_IDENTITY_ENV: path.join(fx.dir, 'absent.env'),
      PAPERCUSP_RELEASE_OWNER_NAME: 'Env Owner',
      PAPERCUSP_RELEASE_OWNER_EMAIL: 'env@example.test',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.name, 'Env Owner');
  assert.match(r.stderr, /owner identity comes from the environment alone/);
});

test('an absent owner EMAIL refuses the cut (exit 2) — zero email coverage is not CLEAN', () => {
  const fx = fixture();
  fs.writeFileSync(fx.file, 'PAPERCUSP_RELEASE_OWNER_NAME=Name Only\n');
  const r = run('papercusp_union_release_identity_env && papercusp_require_release_owner_identity', {
    fx,
    env: { PAPERCUSP_RELEASE_IDENTITY_ENV: fx.file },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /requires PAPERCUSP_RELEASE_OWNER_EMAIL/);
});

test('an absent owner NAME refuses the cut (exit 2), separators-only counts as absent', () => {
  const fx = fixture();
  const r = run('papercusp_require_release_owner_identity', {
    fx,
    env: { PAPERCUSP_RELEASE_OWNER_NAME: ' , ; ', PAPERCUSP_RELEASE_OWNER_EMAIL: 'e@example.test' },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /requires PAPERCUSP_RELEASE_OWNER_NAME/);
});

test('an unreadable identity file refuses rather than cutting with a partial identity', { skip: process.getuid?.() === 0 }, () => {
  const fx = fixture();
  fs.writeFileSync(fx.file, 'PAPERCUSP_RELEASE_OWNER_NAME=X\n');
  fs.chmodSync(fx.file, 0o000);
  const r = run('papercusp_union_release_identity_env', {
    fx,
    env: { PAPERCUSP_RELEASE_IDENTITY_ENV: fx.file, PAPERCUSP_RELEASE_OWNER_NAME: 'Caller' },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not readable/);
});

test('the file is parsed, never executed', () => {
  const fx = fixture();
  const marker = path.join(fx.dir, 'executed');
  fs.writeFileSync(
    fx.file,
    `touch ${marker}\nPAPERCUSP_RELEASE_OWNER_NAME=Parsed Owner\nPAPERCUSP_RELEASE_OWNER_EMAIL=p@example.test\nUNRELATED=1\n`,
  );
  const r = run('papercusp_union_release_identity_env; printf "UNRELATED=%s\\n" "${UNRELATED:-}"', {
    fx,
    env: { PAPERCUSP_RELEASE_IDENTITY_ENV: fx.file },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.name, 'Parsed Owner');
  assert.equal(fs.existsSync(marker), false, 'a line in the identity file was executed');
});

test('release-local.sh sources the library from the orchestrator and calls union THEN require', () => {
  const text = fs.readFileSync(path.join(root, 'bin/release-local.sh'), 'utf8');
  const lines = text.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  const sourced = at(/^source "\$ORCHESTRATOR_HERE\/lib\/release-identity-env\.sh"$/);
  const union = at(/^papercusp_union_release_identity_env \|\| exit 2$/);
  const require_ = at(/^papercusp_require_release_owner_identity \|\| exit 2$/);
  assert(sourced >= 0, 'release-local.sh no longer sources bin/lib/release-identity-env.sh');
  assert(union > sourced, 'the union runs before the library is sourced');
  assert(require_ > union, 'the owner-identity requirement must run AFTER the file union');
});
