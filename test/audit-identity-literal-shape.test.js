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
const LOGIN_EXEMPT = ['root', 'runner', 'build', 'ubuntu'].includes(LOGIN);

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
