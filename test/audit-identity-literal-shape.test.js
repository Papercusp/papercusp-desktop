// Two identity-literal SHAPE defects in bin/audit-release-bundle.py, both found by a
// fresh clone of the PUBLIC source cut building the Linux AppImage on a VM whose
// unix login was `tester` (open-source-release-2026-09-29, R-15, build7):
//
// 1. The box login was hunted AND scrubbed as a bare case-folded SUBSTRING. A
//    dictionary-word login therefore rewrote vendor identifiers in shipped JS
//    (Monaco's `createStereoPanner` -> `creabuildusereoPanner`, smiles-drawer's
//    `annotateStereochemistry`) and red-ed the gate on libicu `smokeTestERK…` and
//    webkit `IPCTester`. A login leaks as a whole TOKEN; the path form is
//    build-home-path's job and stays a substring hunt.
//
// 2. The public cut redacts this very script with REDACTION_BY_KEY, so its
//    KNOWN_SENSITIVE_IDENTITIES denylist arrives as the scrubber's own placeholders
//    (`builduser`, `ownerhandle`, …). The gate then hunted those in a tree the scrub
//    had produced and refused already-redacted text (`/home/builduser/…`).
//
// Both tests drive the real CLI; nothing here names a real identity.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// PROBE_SCRIPT lets scripts/mutation-probe.sh point this at a mutated COPY.
const AUDIT = process.env.PROBE_SCRIPT || path.join(__dirname, '..', 'bin', 'audit-release-bundle.py');
const ENV = { ...process.env, PAPERCUSP_RELEASE_OWNER_NAME: 'Zzsynthetic Gateowner' };

function run(script, ...args) {
  return spawnSync('python3', [script, ...args], { encoding: 'utf8', env: ENV });
}

function tmp(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `audit-lit-shape-${tag}-`));
}

const LOGIN = os.userInfo().username;
function pyGenericAccounts(script) {
  const r = spawnSync('python3', ['-c', [
    'import importlib.util, json, sys',
    's = importlib.util.spec_from_file_location("arb", sys.argv[1])',
    'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'print(json.dumps(sorted(m.GENERIC_ACCOUNTS)))',
  ].join('\n'), script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const LOGIN_EXEMPT = pyGenericAccounts(AUDIT).includes(LOGIN);

function embedInIdentifier(login) {
  // Word characters on BOTH sides, with the login case-shifted the way a vendor
  // camelCase identifier would carry it (`createStereoPanner` carries `teSter`).
  const shifted = login[0].toUpperCase() + login.slice(1);
  return `create${shifted}Panner`;
}

test('the box login inside a vendor identifier is neither hunted nor rewritten', { skip: LOGIN_EXEMPT }, () => {
  const dir = tmp('embedded');
  const file = path.join(dir, 'vendor.js');
  const body = `export function ${embedInIdentifier(LOGIN)}() { return 1; }\n`;
  fs.writeFileSync(file, body);

  assert.equal(run(AUDIT, '--scan-dir', dir).status, 0,
    'an identifier merely CONTAINING the login is not a leak');
  assert.equal(run(AUDIT, '--scrub-text', dir).status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), body,
    'the scrub must not rewrite a vendor identifier (it corrupted Monaco typings)');
});

test('the box login as a whole token is still hunted and scrubbed', { skip: LOGIN_EXEMPT }, () => {
  const dir = tmp('token');
  const file = path.join(dir, 'notes.md');
  fs.writeFileSync(file, `# Notes\n\nbuilt by ${LOGIN} on the release box\n`);

  // FALSIFIER: exactly 1 (a real leak verdict), not merely non-zero — exit 2 means
  // the gate could not check and would prove nothing.
  assert.equal(run(AUDIT, '--scan-dir', dir).status, 1,
    'a standalone login token must still be REJECTED');
  assert.equal(run(AUDIT, '--scrub-text', dir).status, 0);
  const after = fs.readFileSync(file, 'utf8');
  assert.ok(!after.toLowerCase().includes(LOGIN.toLowerCase()), 'the login token must be gone');
  assert.ok(after.includes('on the release box'), 'surrounding prose survives');
  assert.equal(run(AUDIT, '--scan-dir', dir).status, 0, 'the gate passes after the scrub');
});

test('a public-cut copy (denylist scrubbed to placeholders) passes already-redacted text', () => {
  // Reproduce what the public source cut does to this script: every
  // KNOWN_SENSITIVE_IDENTITIES value becomes its REDACTION_BY_KEY placeholder.
  const src = fs.readFileSync(AUDIT, 'utf8');
  const placeholders = {
    'mac-vm-user': 'macuser',
    'mac-vm-login': 'maclogin',
    'linux-build-user': 'builduser',
    'owner-github-handle': 'ownerhandle',
  };
  let replaced = 0;
  const publicCopy = src.replace(
    /("known-sensitive:([a-z-]+)": )"[^"]*"(,\s*#[^\n]*|,)/g,
    (m, head, key, tail, offset) => {
      // Only the denylist body, not REDACTION_BY_KEY (whose values already are placeholders).
      if (!(key in placeholders)) return m;
      const before = src.lastIndexOf('KNOWN_SENSITIVE_IDENTITIES = {', offset);
      const redaction = src.lastIndexOf('REDACTION_BY_KEY = {', offset);
      if (before < 0 || redaction > before) return m;
      replaced += 1;
      return `${head}"${placeholders[key]}"${tail}`;
    },
  );
  assert.equal(replaced, Object.keys(placeholders).length,
    'fixture must rewrite every denylist entry, or this test proves nothing');

  const work = tmp('publiccut');
  const script = path.join(work, 'audit-release-bundle.py');
  fs.writeFileSync(script, publicCopy);
  const dir = path.join(work, 'tree');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'plans-audit.json'), JSON.stringify({
    note: 'removed the hard ownerhandle6 route-pin; watch /home/builduser/demos/x; macuser ok',
  }));

  assert.equal(run(script, '--scan-dir', dir).status, 0,
    "the scrubber's own placeholders are not identities to hunt");
  assert.equal(run(AUDIT, '--scan-dir', dir).status, 0,
    'the in-tree script agrees');
});

// 3. (build8) A GENERIC login that is also a product word. Word-bounding (fix 1) is not
//    enough when the login is `tester`: the Server deb names the `tester` agent role as a
//    whole word in prompts, blueprints and SQL, and the gate refused 17 files. A generic
//    login identifies nobody; its home PATH is still hunted as build-home-path.
function literalsForLogin(script, login) {
  const r = spawnSync('python3', ['-c', [
    'import importlib.util, json, sys, types',
    's = importlib.util.spec_from_file_location("arb", sys.argv[1])',
    'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'm.pwd.getpwuid = lambda _uid: types.SimpleNamespace(pw_name=sys.argv[2])',
    'print(json.dumps(m.identity_literals()))',
  ].join('\n'), script, login], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('a generic login (tester) is not hunted; a personal login still is', () => {
  assert.equal(literalsForLogin(AUDIT, 'tester')['build-user-name'], undefined,
    'a generic login must not become an identity literal');
  assert.equal(literalsForLogin(AUDIT, 'zzpersonallogin')['build-user-name'], 'zzpersonallogin',
    'a personal login is still hunted');
});

test('GENERIC_ACCOUNTS is identical in the Python gate and the JS lint', async () => {
  const js = await import(require('node:url').pathToFileURL(
    path.join(__dirname, '..', '..', 'scripts', 'lib', 'identity-leak-patterns.mjs')).href);
  assert.deepEqual(pyGenericAccounts(AUDIT), [...js.GENERIC_ACCOUNTS].sort(),
    'the two generic-login sets drifted; keep them equal');
});

// 4. (build8) `--scan-artifact` with a caller-RELATIVE AppImage path crashed with a
//    FileNotFoundError traceback: the AppImage runtime runs with cwd=<scratch dir>.
test('--scan-artifact accepts a relative AppImage path', () => {
  const dir = tmp('relpath');
  const name = 'Fake_0.0.0_amd64.AppImage';
  fs.writeFileSync(path.join(dir, name),
    // payload > container: the gate refuses an expansion under its 10% coverage floor
    '#!/bin/sh\nmkdir -p squashfs-root && printf "%0400d\\n" 0 > squashfs-root/readme.txt\n', { mode: 0o755 });
  const r = spawnSync('python3', [path.resolve(AUDIT), '--scan-artifact', name],
    { encoding: 'utf8', env: ENV, cwd: dir });
  assert.doesNotMatch(r.stderr, /Traceback|FileNotFoundError/, r.stderr);
  assert.equal(r.status, 0, `expected a CLEAN verdict\n${r.stdout}\n${r.stderr}`);
});
