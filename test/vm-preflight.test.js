// EI-20559335826516998 — vm-preflight must explain an SSH failure with the
// host-side QEMU framebuffer when the guest is unreachable.
//
// The regression is deliberately exercised end-to-end against the real Bash
// script. The SSH, HMP socat, and image converter commands are hermetic shims;
// the only real VM-shaped resource is a temporary UNIX socket path so the
// script takes the same monitor-available branch without touching a VM.

const assert = require('node:assert/strict');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

const SCRIPT = join(__dirname, '..', 'bin', 'vm-preflight.sh');

function executable(dir, name, source) {
  const file = join(dir, name);
  writeFileSync(file, source);
  chmodSync(file, 0o755);
  return file;
}

function runPreflight({
  root,
  sshSource,
  monitorSocket,
  screenDir,
  freeGb = 50,
  qemuStatus = 'running',
  qemuIoStatus = 'ok',
}) {
  const shimDir = join(root, 'shims');
  mkdirSync(shimDir);
  const ssh = executable(shimDir, 'ssh', sshSource);
  const diskPath = join(root, 'windows_hdd.qcow2');
  const hmpLog = join(root, 'hmp.log');
  writeFileSync(diskPath, 'qcow2 fixture');
  const statusLine = qemuStatus === 'paused-io-error'
    ? 'VM status: paused (io-error)'
    : qemuStatus === 'paused'
      ? 'VM status: paused'
      : 'VM status: running';
  const socat = executable(
    shimDir,
    'socat',
    `#!/usr/bin/env bash
IFS= read -r command || exit 1
printf '%s\\n' "$command" >> '${hmpLog}'
case "$command" in
  'info status') printf '%s\\n' '${statusLine}' ;;
  'info block') printf '%s\\n' 'hd0: windows_hdd.qcow2 (qcow2)' 'I/O status: ${qemuIoStatus}' ;;
  screendump*)
    ppm="\${command#screendump }"
    printf 'P3\\n1 1\\n255\\n0 0 0\\n' > "$ppm"
    ;;
  *) exit 2 ;;
esac
`,
  );
  const convert = executable(
    shimDir,
    'convert',
`#!/usr/bin/env bash
printf 'PNG-ARTIFACT\\n' > "\${2:?output path required}"
`,
  );
  const df = executable(
    shimDir,
    'df',
    `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf '/dev/mock 104857600 52428800 ${freeGb * 1048576} 50%% /mock\\n'
`,
  );

  return spawnSync('bash', [
    SCRIPT,
    '--skip-host-pgrep',
    '--monitor-socket',
    monitorSocket,
    '--screendump-dir',
    screenDir,
    '--disk-path',
    diskPath,
    '--min-host-free-gb',
    '10',
    '--json',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: root,
      PC_SSH: ssh,
      PC_SOCAT: socat,
      PC_DF: df,
      PC_CONVERT: convert,
    },
  });
}

function sshFails() {
  return '#!/usr/bin/env bash\nexit 1\n';
}

function sshHealthy() {
  return `#!/usr/bin/env bash
case "$*" in
  *"cmd /c echo VM-OK"*) printf 'VM-OK\\n' ;;
  *tasklist*) printf '"papercusp-desktop.exe","1234"\\n' ;;
  *"--exec cat /home/papercup/.papercusp/operator.json"*) printf '{"port":3170}\\n' ;;
  *"--exec curl -sS -m 5 http://127.0.0.1:3170/api/health"*) printf '{"sha":"test","version":"test"}\\n' ;;
  *powershell*) printf '200\\n' ;;
  *) exit 1 ;;
esac
`;
}

async function listeningUnixSocket(socketPath) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return server;
}

test('SSH failure captures a host-side QEMU screendump artifact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ei205593-vm-preflight-'));
  const screenDir = join(root, 'screens');
  const monitorSocket = join(root, 'qemu-monitor.sock');
  mkdirSync(screenDir);
  const server = await listeningUnixSocket(monitorSocket);

  try {
    const result = runPreflight({ root, sshSource: sshFails(), monitorSocket, screenDir });
    assert.equal(result.status, 1, result.stderr);
    const verdict = JSON.parse(result.stdout);

    assert.equal(verdict.ok, false);
    assert.equal(verdict.ssh, 'false');
    assert.equal(verdict.qemuStatus, 'running');
    assert.equal(verdict.qemuIoStatus, 'ok');
    assert.equal(verdict.guestScreenStatus, 'captured');
    assert.match(verdict.guestScreenPng, /\.png$/);
    assert.ok(existsSync(verdict.guestScreenPng), `missing PNG artifact: ${verdict.guestScreenPng}`);
    assert.equal(readFileSync(verdict.guestScreenPng, 'utf8'), 'PNG-ARTIFACT\n');
    assert.match(verdict.failures.join('\n'), /guest screen captured/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test('SSH failure reports unavailable monitor diagnosis instead of a bare unreachable', () => {
  const root = mkdtempSync(join(tmpdir(), 'ei205593-vm-preflight-no-monitor-'));
  const screenDir = join(root, 'screens');
  const monitorSocket = join(root, 'missing-monitor.sock');
  mkdirSync(screenDir);

  try {
    const result = runPreflight({ root, sshSource: sshFails(), monitorSocket, screenDir });
    assert.equal(result.status, 1, result.stderr);
    const verdict = JSON.parse(result.stdout);

    assert.equal(verdict.guestScreenStatus, 'unavailable');
    assert.equal(verdict.qemuStatus, 'unavailable');
    assert.equal(verdict.qemuIoStatus, 'unavailable');
    assert.equal(verdict.guestScreenPng, '');
    assert.match(verdict.failures.join('\n'), /guest-state monitor diagnosis unavailable/);
    assert.match(verdict.notes.join('\n'), /monitor socket not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('healthy SSH path remains authoritative and does not create a screen artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'ei205593-vm-preflight-healthy-'));
  const screenDir = join(root, 'screens');
  const monitorSocket = join(root, 'missing-monitor.sock');
  mkdirSync(screenDir);

  try {
    const result = runPreflight({ root, sshSource: sshHealthy(), monitorSocket, screenDir });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(result.stdout);

    assert.equal(verdict.ok, true);
    assert.equal(verdict.ssh, 'true');
    assert.equal(verdict.innerHealthy, 'true');
    assert.equal(verdict.hostFreeGb, 50);
    assert.equal(verdict.qemuStatus, 'unavailable');
    assert.equal(verdict.qemuIoStatus, 'unavailable');
    assert.equal(verdict.guestScreenStatus, 'not-attempted');
    assert.equal(verdict.guestScreenPng, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('low host free space fails before a healthy VM can mask the recurrence risk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ei210981-vm-preflight-low-space-'));
  const screenDir = join(root, 'screens');
  const monitorSocket = join(root, 'qemu-monitor.sock');
  mkdirSync(screenDir);
  const server = await listeningUnixSocket(monitorSocket);

  try {
    const result = runPreflight({
      root,
      sshSource: sshHealthy(),
      monitorSocket,
      screenDir,
      freeGb: 4,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(result.stdout);

    assert.equal(verdict.ok, false);
    assert.equal(verdict.hostFreeGb, 4);
    assert.equal(verdict.minHostFreeGb, 10);
    assert.equal(verdict.qemuStatus, 'running');
    assert.equal(verdict.qemuIoStatus, 'ok');
    assert.match(verdict.failures.join('\n'), /low space can pause QEMU with io-error/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test('paused QEMU io-error and nospace block status are surfaced without mutating HMP state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ei210981-vm-preflight-paused-'));
  const screenDir = join(root, 'screens');
  const monitorSocket = join(root, 'qemu-monitor.sock');
  mkdirSync(screenDir);
  const server = await listeningUnixSocket(monitorSocket);

  try {
    const result = runPreflight({
      root,
      sshSource: sshFails(),
      monitorSocket,
      screenDir,
      qemuStatus: 'paused-io-error',
      qemuIoStatus: 'nospace',
    });
    assert.equal(result.status, 1, result.stderr);
    const verdict = JSON.parse(result.stdout);

    assert.equal(verdict.ok, false);
    assert.equal(verdict.qemuStatus, 'paused-io-error');
    assert.equal(verdict.qemuIoStatus, 'nospace');
    assert.match(verdict.failures.join('\n'), /paused \(io-error\)/);
    assert.match(verdict.failures.join('\n'), /I\/O status is 'nospace'/);
    const hmpCommands = readFileSync(join(root, 'hmp.log'), 'utf8');
    assert.doesNotMatch(hmpCommands, /^(cont|quit)$/m);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
