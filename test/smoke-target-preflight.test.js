// WI-10004346 — bin/smoke-target-preflight.sh names a missing native smoke
// target (SSH / console login / installed baseline) BEFORE a long release
// build, instead of the verifier refusing with exit 2 after the cut.
//
// Hermetic: ssh and systemctl are PATH-independent shims passed via
// PC_SSH / PC_SYSTEMCTL, so no real VM is ever dialled.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

const BIN = join(__dirname, '..', 'bin');
const SCRIPT = join(BIN, 'smoke-target-preflight.sh');

function executable(dir, name, source) {
  const file = join(dir, name);
  writeFileSync(file, source);
  chmodSync(file, 0o755);
  return file;
}

// ssh shim: the last argv element is the remote command. TEST_* env picks the
// behaviour of each probe.
const SSH_SHIM = `#!/usr/bin/env bash
cmd="\${@: -1}"
case "$cmd" in
  *"echo VM-OK"*) [ "$TEST_REACH" = up ] && echo VM-OK || { echo "ssh: connect to host 127.0.0.1 port 2223: Connection refused" >&2; exit 255; } ;;
  *PAPERCUSP_NATIVE_MAC_PREFLIGHT*)
    [ "$TEST_CONSOLE" = ok ] && echo PAPERCUSP_NATIVE_MAC_PREFLIGHT_OK || { echo "macOS native preflight: SSH user must own the logged-in GUI console" >&2; exit 2; } ;;
  *Uninstall*|*CFBundleShortVersionString*) printf '%b' "$TEST_BASELINE" ;;
  *) exit 99 ;;
esac
`;
const SYSTEMCTL_SHIM = `#!/usr/bin/env bash
case "$*" in
  "--user cat papercup-vm-win.service") [ "$TEST_UNIT" != absent ] ;;
  "--user is-active --quiet papercup-vm-win.service") [ "$TEST_UNIT" = active ] ;;
  *) exit 99 ;;
esac
`;

function run(platform, env) {
  const root = mkdtempSync(join(tmpdir(), 'smoke-target-preflight-'));
  try {
    const key = join(root, 'key');
    writeFileSync(key, 'fixture');
    const result = spawnSync('bash', [SCRIPT, '--platform', platform, '--ssh-key', key], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PC_SSH: executable(root, 'ssh', SSH_SHIM),
        PC_SYSTEMCTL: executable(root, 'systemctl', SYSTEMCTL_SHIM),
        TEST_REACH: 'up', TEST_CONSOLE: 'ok', TEST_UNIT: 'inactive',
        TEST_BASELINE: 'Papercusp GUI=0.0.23\\nPapercusp Server=0.0.23\\n',
        ...env,
      },
    });
    return { status: result.status, out: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('ready target reports READY with the installed baseline', () => {
  for (const platform of ['windows', 'mac']) {
    const r = run(platform, {});
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, new RegExp(`SMOKE_TARGET_RESULT platform=${platform} status=ready baseline=GUI=0\\.0\\.23,Server=0\\.0\\.23`));
  }
});

test('stopped Windows VM is STOPPED (exit 3) with the boot command, not a rig fault', () => {
  const r = run('windows', { TEST_REACH: 'down', TEST_UNIT: 'inactive' });
  assert.equal(r.status, 3, r.out);
  assert.match(r.out, /systemctl --user start papercup-vm-win\.service/);
  assert.doesNotMatch(r.out, /SMOKE_TARGET_BLOCKER/);
});

test('unreachable target with no bootable unit is NOT-READY and names ssh', () => {
  for (const [platform, unit] of [['windows', 'absent'], ['windows', 'active'], ['mac', 'inactive']]) {
    const r = run(platform, { TEST_REACH: 'down', TEST_UNIT: unit });
    assert.equal(r.status, 2, `${platform}/${unit}: ${r.out}`);
    assert.match(r.out, new RegExp(`SMOKE_TARGET_BLOCKER ${platform} ssh-unreachable: .*Connection refused`));
  }
});

test('mac console at loginwindow is named as a blocker (the 0.0.26 refusal)', () => {
  const r = run('mac', { TEST_CONSOLE: 'loginwindow' });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /SMOKE_TARGET_BLOCKER mac console-not-ready: macOS native preflight: SSH user must own the logged-in GUI console/);
});

test('missing installed baseline is named per role', () => {
  const r = run('windows', { TEST_BASELINE: 'Papercusp GUI=0.0.23\\n' });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /baseline-missing: no installed Papercusp Server/);
  assert.doesNotMatch(r.out, /no installed Papercusp GUI/);
});

test('mac check sends the SAME remote predicate file the verifier sends', () => {
  const pre = readFileSync(SCRIPT, 'utf8');
  const verify = readFileSync(join(BIN, 'install-and-relaunch-verify.sh'), 'utf8');
  for (const source of [pre, verify]) {
    assert.match(source, /\$HERE\/lib\/mac-native-preflight\.sh/);
    assert.match(source, /source "\$HERE\/lib\/smoke-endpoints\.sh"/);
  }
});
