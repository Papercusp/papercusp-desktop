'use strict';

// WI-10004052 — the release platform-smoke gate's Linux leg used to run the
// installed-update verifier with NO endpoint, so it inherited the Windows VM's
// :2223 + papercup-vm-win defaults and could never produce a Linux receipt.
// The leg now owns the vmctl clean-room VM lifecycle: reset -> up -> wait-ssh
// -> install the PREVIOUS release as the running baseline -> verify against
// the vmctl-derived endpoint -> ALWAYS power down.
//
// Hermetic: vmctl and the verifier are fakes, and ssh/scp on PATH are shims
// that record a LEAK and fail, so no step can reach a real VM (an unfaked
// nested scp reaching a real rig VM is a measured failure mode of VM tests).

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');
const { test } = require('node:test');

const LIB = join(__dirname, '..', 'bin', 'lib', 'release-artifacts.sh');
const VERSION = '0.0.25';
const BASELINE_VERSION = '0.0.24';
const TAG = `desktop-v${VERSION}-alpha`;
const SHA = 'cddbd8d5';

function executable(file, source) {
  writeFileSync(file, source);
  chmodSync(file, 0o755);
  return file;
}

function fixture({ running = false, failAt = '', verifyFail = false, policyFail = false, baseline = 'dir', baselineVersion = BASELINE_VERSION } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'linux-smoke-vm-'));
  const artifacts = join(root, 'bundle');
  const baselineDir = join(root, 'baseline');
  const shims = join(root, 'shims');
  for (const dir of [artifacts, baselineDir, shims]) mkdirSync(dir);

  const gui = join(artifacts, `Papercusp GUI_${VERSION}_amd64.deb`);
  const server = join(artifacts, `Papercusp Server_${VERSION}_amd64.deb`);
  writeFileSync(gui, 'target gui deb');
  writeFileSync(server, 'target server deb');
  writeFileSync(join(artifacts, 'build-provenance.json'), JSON.stringify({
    version: VERSION,
    buildSha: SHA,
    artifacts: [gui, server].map((file) => ({
      name: basename(file),
      bytes: statSync(file).size,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    })),
  }));
  const baseGui = join(baselineDir, `Papercusp GUI_${baselineVersion}_amd64.deb`);
  const baseServer = join(baselineDir, `Papercusp Server_${baselineVersion}_amd64.deb`);
  writeFileSync(baseGui, 'baseline gui deb');
  writeFileSync(baseServer, 'baseline server deb');

  const log = join(root, 'calls.log');
  const vmctl = executable(join(root, 'vmctl'), `#!/usr/bin/env bash
printf 'VMCTL %s\\n' "$*" >> "$MOCK_LOG"
cmd="$1"; shift
[[ "$cmd" == "$MOCK_FAIL_AT" ]] && exit 1
case "$cmd" in
  endpoint)
    printf 'ssh_port=2224\\nssh_key=%s/.ssh/papercup-vm-linux\\nssh_host=tester@127.0.0.1\\n' "$HOME" ;;
  is-running) [[ "$MOCK_RUNNING" == 1 ]] ;;
  ssh)
    script="$(cat)"
    printf 'VMCTL-SSH-SCRIPT %s\\n' "$(printf '%s' "$script" | tr '\\n' ' ')" >> "$MOCK_LOG"
    if [[ "$script" == *PAPERCUSP_LINUX_MANAGED_POLICY* ]]; then
      [[ "$MOCK_POLICY_FAIL" == 0 ]] || exit 1
      printf 'PAPERCUSP_LINUX_MANAGED_POLICY_READY\\n'
      exit 0
    fi
    printf 'PAPERCUSP_LINUX_BASELINE_OPERATOR_OK port=17043 health={"sha":"01a67545","version":"${BASELINE_VERSION}"}\\n'
    ;;
  *) exit 0 ;;
esac
`);
  const verifier = executable(join(root, 'fake-verify.sh'), `#!/usr/bin/env bash
printf 'VERIFY %s\\n' "$*" >> "$MOCK_LOG"
[[ "$MOCK_VERIFY_FAIL" == 1 ]] && exit 1
if [[ -n "$PAPERCUSP_LINUX_SMOKE_MANAGED_POLICY_CHANNEL" && "$*" != *"--verify-managed-policy $PAPERCUSP_LINUX_SMOKE_MANAGED_POLICY_CHANNEL"* ]]; then
  echo 'managed-policy scenario was silently dropped' >&2
  exit 1
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact) gui="$2"; shift 2 ;;
    --server-artifact) server="$2"; shift 2 ;;
    --expected-version) version="$2"; shift 2 ;;
    --smoke-receipt-tag) tag="$2"; shift 2 ;;
    --smoke-provenance) prov="$2"; shift 2 ;;
    *) shift ;;
  esac
done
source "${LIB}"
release_artifacts_smoke_receipt_write "$tag" "$version" linux fake-verify.sh "${SHA}" "$prov" "$gui" "$server" >/dev/null
`);
  for (const name of ['ssh', 'scp']) {
    executable(join(shims, name), `#!/usr/bin/env bash\nprintf 'LEAK ${name} %s\\n' "$*" >> "$MOCK_LOG"\nexit 97\n`);
  }

  const env = {
    PATH: `${shims}:${process.env.PATH}`,
    HOME: root,
    TMPDIR: root,
    MOCK_LOG: log,
    MOCK_RUNNING: running ? '1' : '0',
    MOCK_FAIL_AT: failAt,
    MOCK_VERIFY_FAIL: verifyFail ? '1' : '0',
    MOCK_POLICY_FAIL: policyFail ? '1' : '0',
    PAPERCUSP_LINUX_VMCTL: vmctl,
    PAPERCUSP_PLATFORM_SMOKE_VERIFIER: verifier,
    PAPERCUSP_SMOKE_RECEIPT_ROOT: root,
  };
  if (baseline === 'dir') env.PAPERCUSP_LINUX_SMOKE_BASELINE_DIR = baselineDir;
  if (baseline === 'explicit') {
    env.PAPERCUSP_LINUX_SMOKE_BASELINE_GUI = baseGui;
    env.PAPERCUSP_LINUX_SMOKE_BASELINE_SERVER = baseServer;
  }
  return { root, gui, server, baseGui, baseServer, log, env };
}

function runGate(f) {
  return spawnSync('bash', [
    '-c', 'source "$1"; shift; release_artifacts_run_platform_smoke "$@"',
    '--', LIB, TAG, VERSION, 'linux', f.gui, f.server,
  ], { encoding: 'utf8', env: f.env });
}

function calls(f) {
  return existsSync(f.log) ? readFileSync(f.log, 'utf8').trim().split('\n').filter(Boolean) : [];
}

function withFixture(options, body) {
  const f = fixture(options);
  try { body(f); } finally { rmSync(f.root, { recursive: true, force: true }); }
}

test('Linux leg resets, boots and baselines the clean VM, verifies against its own endpoint, then powers it down', () => {
  withFixture({}, (f) => {
    const result = runGate(f);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const lines = calls(f);
    assert.deepEqual(lines.filter((l) => l.startsWith('LEAK')), [], 'no step may reach a real ssh/scp');

    const order = [
      'VMCTL is-running clean',
      'VMCTL reset clean',
      'VMCTL up clean',
      'VMCTL wait-ssh clean 300',
      `VMCTL install clean ${f.baseServer}`,
      `VMCTL install clean ${f.baseGui}`,
      'VMCTL ssh clean bash -s',
    ];
    let cursor = -1;
    for (const step of order) {
      const at = lines.findIndex((l, i) => i > cursor && l === step);
      assert.ok(at > cursor, `expected "${step}" after line ${cursor}:\n${lines.join('\n')}`);
      cursor = at;
    }
    const verify = lines.findIndex((l) => l.startsWith('VERIFY '));
    assert.ok(verify > cursor, 'the verifier runs only after the baseline operator is healthy');
    assert.equal(lines[lines.length - 1], 'VMCTL down clean', 'the VM is powered down last');

    const verifyLine = lines[verify];
    assert.match(verifyLine, / --ssh-port 2224 /);
    assert.ok(verifyLine.includes(`--ssh-key ${f.root}/.ssh/papercup-vm-linux`), verifyLine);
    assert.match(verifyLine, / --ssh-host tester@127\.0\.0\.1 /);
    assert.doesNotMatch(verifyLine, /2223|papercup-vm-win|papercup-vm-mac/, 'the Linux leg never dials another platform VM');
    assert.match(verifyLine, /--platform linux/);

    const script = lines.find((l) => l.startsWith('VMCTL-SSH-SCRIPT'));
    assert.match(script, /systemctl --user enable --now papercusp-server\.service/);
    assert.match(script, /api\/health/);
    assert.ok(existsSync(join(f.root, `papercusp-smoke-${TAG}-linux.json`)), 'the verifier receipt is required and present');
  });
});

test('explicit baseline paths are honoured', () => {
  withFixture({ baseline: 'explicit' }, (f) => {
    const result = runGate(f);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(calls(f).includes(`VMCTL install clean ${f.baseServer}`));
  });
});

test('managed policy is provisioned exclusively on the reset Linux guest, then bound to the canonical verifier', () => {
  withFixture({}, f => {
    // A pre-existing ordinary smoke receipt is insufficient policy evidence.
    assert.equal(runGate(f).status, 0);
    writeFileSync(f.log, '');
    f.env.PAPERCUSP_LINUX_SMOKE_MANAGED_POLICY_CHANNEL = 'stable';
    const result = runGate(f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const lines = calls(f);
    const baseline = lines.findIndex(line => line.startsWith('VMCTL-SSH-SCRIPT') && line.includes('BASELINE_OPERATOR_OK'));
    const provision = lines.findIndex(line => line.startsWith('VMCTL-SSH-SCRIPT') && line.includes('PAPERCUSP_LINUX_MANAGED_POLICY'));
    const verify = lines.findIndex(line => line.startsWith('VERIFY '));
    assert.ok(baseline >= 0 && provision > baseline && verify > provision, lines.join('\n'));
    assert.match(lines[provision], /sudo python3 -I - stable/);
    assert.match(lines[provision], /os\.O_EXCL/);
    assert.match(lines[provision], /\/etc\/papercusp\/managed-policy\.json/);
    assert.match(lines[verify], /--verify-managed-policy stable/);
    assert.equal(lines.at(-1), 'VMCTL down clean');
    assert.equal(lines.some(line => line.startsWith('LEAK')), false);
  });
});

test('failed managed-policy provisioning powers down without invoking verifier or writing receipt', () => {
  withFixture({ policyFail: true }, f => {
    f.env.PAPERCUSP_LINUX_SMOKE_MANAGED_POLICY_CHANNEL = 'stable';
    const result = runGate(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /managed-policy provisioning/);
    assert.equal(calls(f).some(line => line.startsWith('VERIFY ')), false);
    assert.equal(calls(f).at(-1), 'VMCTL down clean');
    assert.equal(existsSync(join(f.root, `papercusp-smoke-${TAG}-linux.json`)), false);
  });
});

for (const extraEnv of [
  { PAPERCUSP_LINUX_SMOKE_MANAGED_POLICY_CHANNEL: 'nightly' },
  { PAPERCUSP_LINUX_SMOKE_RESET: '0' },
  { PAPERCUSP_LINUX_SMOKE_VM_MANAGED: '0' },
  { PAPERCUSP_PLATFORM_SMOKE_CMD: 'exit 0' },
  { PAPERCUSP_SKIP_PLATFORM_SMOKE: '1', PAPERCUSP_SKIP_PLATFORM_SMOKE_REASON: 'fixture' },
]) {
  test(`managed-policy scenario refuses an unsafe or bypassed lifecycle ${JSON.stringify(extraEnv)}`, () => {
    withFixture({}, f => {
      Object.assign(f.env, { PAPERCUSP_LINUX_SMOKE_MANAGED_POLICY_CHANNEL: 'stable' }, extraEnv);
      const result = runGate(f);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /managed-policy qualification requires/);
      assert.deepEqual(calls(f), [], 'no VM command or real transport may run');
    });
  });
}

test('a failed verifier still powers the VM down and writes no receipt', () => {
  withFixture({ verifyFail: true }, (f) => {
    const result = runGate(f);
    assert.notEqual(result.status, 0);
    const lines = calls(f);
    assert.equal(lines[lines.length - 1], 'VMCTL down clean');
    assert.equal(existsSync(join(f.root, `papercusp-smoke-${TAG}-linux.json`)), false);
  });
});

test('a failed boot powers the VM down and never runs the verifier', () => {
  withFixture({ failAt: 'up' }, (f) => {
    const result = runGate(f);
    assert.notEqual(result.status, 0);
    const lines = calls(f);
    assert.equal(lines.some((l) => l.startsWith('VERIFY')), false);
    assert.equal(lines.some((l) => l.startsWith('VMCTL install')), false);
    assert.equal(lines[lines.length - 1], 'VMCTL down clean');
  });
});

test('a VM that is already running belongs to another lane and is never reset', () => {
  withFixture({ running: true }, (f) => {
    const result = runGate(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already running/);
    const lines = calls(f);
    for (const verb of ['reset', 'up', 'down', 'install']) {
      assert.equal(lines.some((l) => l.startsWith(`VMCTL ${verb} `)), false, `${verb} must not run`);
    }
    assert.equal(lines.some((l) => l.startsWith('VERIFY')), false);
  });
});

test('without a baseline the gate refuses before touching the VM', () => {
  withFixture({ baseline: 'none' }, (f) => {
    const result = runGate(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PAPERCUSP_LINUX_SMOKE_BASELINE_GUI/);
    assert.deepEqual(calls(f).filter((l) => /^VMCTL (reset|up|install|down)/.test(l)), []);
  });
});

test('a baseline of the target version is refused (nothing could flip)', () => {
  withFixture({ baselineVersion: VERSION }, (f) => {
    const result = runGate(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nothing to update from/);
    assert.deepEqual(calls(f).filter((l) => /^VMCTL (reset|up)/.test(l)), []);
  });
});

test('PAPERCUSP_LINUX_SMOKE_VM_MANAGED=0 runs the verifier without any VM lifecycle', () => {
  withFixture({}, (f) => {
    f.env.PAPERCUSP_LINUX_SMOKE_VM_MANAGED = '0';
    const result = runGate(f);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const lines = calls(f);
    assert.equal(lines.some((l) => l.startsWith('VMCTL')), false);
    assert.ok(lines.some((l) => l.startsWith('VERIFY ')));
  });
});
