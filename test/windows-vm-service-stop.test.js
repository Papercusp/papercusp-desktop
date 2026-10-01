const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const windowsVmDir = path.join(__dirname, '..', 'scripts', 'windows-vm');
const unitSource = path.join(windowsVmDir, 'papercup-vm-win.service');
const stopHelper = path.join(windowsVmDir, 'stop-guest.sh');
const installer = path.join(windowsVmDir, 'install-unit.sh');

test('Windows VM service waits for QEMU to exit after requesting guest powerdown', { timeout: 10000 }, async (t) => {
  const unit = readFileSync(unitSource, 'utf8');
  assert.match(unit, /^ExecStop=%h\/windows-vm\/stop-guest\.sh %h\/windows-vm\/qemu-monitor\.sock$/m);
  assert.match(unit, /^KillMode=mixed$/m);
  assert.match(unit, /^TimeoutStopSec=180$/m);
  assert.equal(existsSync(stopHelper), true);

  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'papercup-vm-stop-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const fakeBin = path.join(temporaryRoot, 'bin');
  mkdirSync(fakeBin);
  const capturePath = path.join(temporaryRoot, 'qmp.txt');
  const fakeSocat = path.join(fakeBin, 'socat');
  writeFileSync(fakeSocat, [
    '#!/bin/sh',
    'cat > "$PAPERCUP_VM_STOP_TEST_CAPTURE"',
    '( sleep 0.35; kill -TERM "$MAINPID" 2>/dev/null || true ) </dev/null >/dev/null 2>&1 &',
    '',
  ].join('\n'));
  chmodSync(fakeSocat, 0o755);

  const fakeQemu = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const fakeQemuExit = once(fakeQemu, 'exit');
  t.after(() => {
    if (fakeQemu.exitCode === null && fakeQemu.signalCode === null) fakeQemu.kill('SIGKILL');
  });

  const startedAt = performance.now();
  const stop = spawn(stopHelper, [path.join(temporaryRoot, 'qemu-monitor.sock')], {
    stdio: 'ignore',
    env: {
      ...process.env,
      MAINPID: String(fakeQemu.pid),
      PATH: `${fakeBin}:${process.env.PATH}`,
      PAPERCUP_VM_STOP_TEST_CAPTURE: capturePath,
    },
  });
  const [stopCode, stopSignal] = await once(stop, 'exit');
  const elapsedMs = performance.now() - startedAt;
  await fakeQemuExit;

  assert.equal(stopCode, 0, `stop helper exited by ${stopSignal || stopCode}`);
  assert.ok(elapsedMs >= 250, `helper returned before the guest process exited (${elapsedMs}ms)`);
  assert.equal(readFileSync(capturePath, 'utf8'), 'system_powerdown\n');
});

test('Windows VM unit installer stages the source and only reloads systemd', () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'papercup-vm-install-'));
  try {
    const vmDir = path.join(temporaryRoot, 'vm');
    const unitDir = path.join(temporaryRoot, 'config', 'systemd', 'user');
    const fakeBin = path.join(temporaryRoot, 'bin');
    const systemctlLog = path.join(temporaryRoot, 'systemctl.log');
    mkdirSync(vmDir, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(path.join(vmDir, 'launch-install.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(path.join(vmDir, 'launch-install.sh'), 0o755);
    const fakeSystemctl = path.join(fakeBin, 'systemctl');
    writeFileSync(fakeSystemctl, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PAPERCUP_VM_STOP_TEST_SYSTEMCTL_LOG"\n');
    chmodSync(fakeSystemctl, 0o755);

    const run = spawnSync(installer, [], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PAPERCUP_VM_DIRECTORY: vmDir,
        PAPERCUP_VM_UNIT_DIRECTORY: unitDir,
        PAPERCUP_VM_STOP_TEST_SYSTEMCTL_LOG: systemctlLog,
      },
    });

    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
    assert.equal(readFileSync(path.join(vmDir, 'stop-guest.sh'), 'utf8'), readFileSync(stopHelper, 'utf8'));
    assert.equal(readFileSync(path.join(unitDir, 'papercup-vm-win.service'), 'utf8'), readFileSync(unitSource, 'utf8'));
    assert.equal(readFileSync(systemctlLog, 'utf8'), '--user daemon-reload\n');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
