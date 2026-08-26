import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../bin/mac-vm-health.sh', import.meta.url).pathname;
const vmcall = new URL('../bin/vm-rig/vmcall.sh', import.meta.url).pathname;
const currentBoot = new URL('../bin/vm-rig/boot-headless-current.sh', import.meta.url).pathname;
const currentComposer = new URL('../bin/vm-rig/compose-rig-sidecar-current.sh', import.meta.url).pathname;

async function fixture({ ssh = true, qmp = true } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mac-vm-health-'));
  const bin = path.join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  for (const [name, body] of Object.entries({
    systemctl: '#!/bin/sh\nexit 0\n',
    ssh: `#!/bin/sh\nif [ -n "$MAC_VM_SSH_MARKER" ]; then : > "$MAC_VM_SSH_MARKER"; fi\nexit ${ssh ? 0 : 1}\n`,
    qmp: `#!/bin/sh\nif [ -n "$MAC_VM_QMP_MARKER" ]; then : > "$MAC_VM_QMP_MARKER"; fi\nexit ${qmp ? 0 : 1}\n`,
  })) {
    const file = path.join(bin, name);
    await writeFile(file, body); await chmod(file, 0o755);
  }
  const disk = path.join(dir, 'disk.img'); await writeFile(disk, 'disk');
  return {
    dir,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      MAC_VM_QMP_PROBE: path.join(bin, 'qmp'),
      MAC_VM_DISK_IMAGE: disk,
      MAC_VM_QMP_SOCK: path.join(dir, 'qmp.sock'),
      MAC_VM_QEMU_PIDFILE: path.join(dir, 'qemu.pid'),
      MAC_VM_QEMU_LOG: path.join(dir, 'qemu.log'),
      MAC_VM_STALE_SEC: '0',
      MAC_VM_SSH_MARKER: path.join(dir, 'ssh-called'),
      MAC_VM_QMP_MARKER: path.join(dir, 'qmp-called'),
    },
  };
}

test('reports healthy when guest SSH answers', async () => {
  const { env } = await fixture();
  const result = spawnSync('bash', [script, '--json'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, 'healthy');
});

test('classifies a running QEMU with dead SSH and stale disk as picker-suspect', async () => {
  const { env } = await fixture({ ssh: false });
  const result = spawnSync('bash', [script, '--json'], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, 'picker-suspect');
});

test('distinguishes an active service from an unavailable QEMU control plane', async () => {
  const { env } = await fixture({ qmp: false, ssh: false });
  const result = spawnSync('bash', [script, '--json'], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const health = JSON.parse(result.stdout);
  const diskAge = health.disk_age_sec;
  delete health.disk_age_sec;
  assert.deepEqual(health, {
    status: 'control-plane-unavailable',
    service_active: true,
    qemu_process_found: false,
    qemu_pid: null,
    qemu_fd_count: -1,
    qemu_fd_limit: -1,
    qemu_close_wait_count: 0,
    qemu_fd_exhausted: false,
    ssh_ok: false,
    ssh_probe_skipped: false,
    qmp_running: false,
    qmp_probe_skipped: false,
    qemu_log_bounded: false,
    recovery: 'not-requested',
    detail: 'QEMU/SSH control plane is unavailable (service_active=true qemu_pid=none)',
  });
  assert.ok(Number.isInteger(diskAge) && diskAge >= 0, `disk age should be a non-negative integer, got ${diskAge}`);
});

async function exhaustedQemuFixture() {
  const fixtureState = await fixture({ qmp: true, ssh: false });
  const { dir, env } = fixtureState;
  const proc = path.join(dir, 'proc');
  const pid = '4726';
  const fdDir = path.join(proc, pid, 'fd');
  await mkdir(fdDir, { recursive: true });
  await mkdir(path.join(proc, 'net'), { recursive: true });
  await writeFile(path.join(dir, 'qemu.pid'), `${pid}\n`);
  await writeFile(
    path.join(proc, pid, 'cmdline'),
    'qemu-system-x86_64\0-drive\0file=./disk.img\0-qmp\0unix:./qmp.sock\0',
  );
  await writeFile(path.join(proc, pid, 'limits'), 'Max open files            10                   1000              files\n');

  for (let index = 0; index < 10; index += 1) {
    const target = index < 3 ? `socket:[${1001 + index}]` : `pipe:[${2001 + index}]`;
    await symlink(target, path.join(fdDir, String(index)));
  }
  const tcpHeader = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n';
  const closeWait = (inode, state) =>
    `   0: 0100007F:08AE 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 1000 0 ${inode}\n`;
  await writeFile(
    path.join(proc, 'net', 'tcp'),
    tcpHeader + closeWait(1001, '08') + closeWait(1002, '08') + closeWait(1003, '01') + closeWait(9999, '08'),
  );
  await writeFile(path.join(proc, 'net', 'tcp6'), tcpHeader);

  const qemuLog = 'prefix\n'.repeat(20) + 'latest-warning\n';
  await writeFile(path.join(dir, 'qemu.log'), qemuLog);
  return {
    ...fixtureState,
    env: {
      ...env,
      MAC_VM_QEMU_PID: pid,
      MAC_VM_PROC_ROOT: proc,
      MAC_VM_FD_EXHAUSTION_PCT: '90',
      MAC_VM_CLOSE_WAIT_THRESHOLD: '2',
      MAC_VM_CLOSE_WAIT_OCCUPANCY_PCT: '50',
      MAC_VM_QEMU_LOG_MAX_BYTES: '20',
    },
    qemuLog,
  };
}

test('detects QEMU FD/CLOSE_WAIT exhaustion before probing SSH and bounds the warning log', async () => {
  const { dir, env, qemuLog } = await exhaustedQemuFixture();
  try {
    const result = spawnSync('bash', [script, '--json'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const health = JSON.parse(result.stdout);
    assert.equal(health.status, 'fd-exhausted');
    assert.equal(health.qemu_process_found, true);
    assert.equal(health.qemu_pid, 4726);
    assert.equal(health.qemu_fd_count, 10);
    assert.equal(health.qemu_fd_limit, 10);
    assert.equal(health.qemu_close_wait_count, 2);
    assert.equal(health.qemu_fd_exhausted, true);
    assert.equal(health.ssh_ok, false);
    assert.equal(health.ssh_probe_skipped, true);
    assert.equal(health.qmp_running, false);
    assert.equal(health.qmp_probe_skipped, true);
    assert.equal(health.qemu_log_bounded, true);
    assert.match(health.detail, /CLOSE_WAIT sockets; SSH\/QMP probes skipped/);
    assert.equal(await readFile(path.join(dir, 'ssh-called'), 'utf8').catch(() => null), null);
    assert.equal(await readFile(path.join(dir, 'qmp-called'), 'utf8').catch(() => null), null);
    const boundedLog = await readFile(path.join(dir, 'qemu.log'), 'utf8');
    assert.ok(Buffer.byteLength(boundedLog) <= 20);
    assert.ok(qemuLog.endsWith('latest-warning\n'));
    assert.match(boundedLog, /latest-warning/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recovery is opt-in and refused without the picker signature', async () => {
  const { env } = await fixture({ qmp: false, ssh: false });
  const result = spawnSync('bash', [script, '--recover-picker'], { env, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /refusing recovery/);
});

async function vmcallFixture(result) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vm-rig-vmcall-'));
  const fakeMcp = path.join(dir, 'mcp-call.mjs');
  // vmcall.sh runs this with the discovered Node binary. Keeping the fake
  // transport as a real JS file means the same Node binary also exercises the
  // driver's JSON-result validator.
  await writeFile(fakeMcp, "process.stdout.write(process.env.VM_RIG_FAKE_RESULT ?? '');\n");
  return {
    dir,
    env: {
      ...process.env,
      PCUSP_VM_NODE: process.execPath,
      PCUSP_MCP_CALL: fakeMcp,
      PAPERCUSP_HONO_PORT: '34567',
      VM_RIG_FAKE_RESULT: result,
    },
  };
}

test('vm-rig driver rejects an empty MCP result even when the child exits 0', async () => {
  const { dir, env } = await vmcallFixture('');
  try {
    const result = spawnSync('bash', [vmcall, 'coord:whoami', '{}'], { env, encoding: 'utf8' });
    assert.equal(result.status, 5);
    assert.match(result.stderr, /MCP_RESULT_INVALID/);
    assert.equal(result.stdout, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('vm-rig driver forwards a parseable JSON MCP result and exits 0', async () => {
  const { dir, env } = await vmcallFixture('{"ok":true}');
  try {
    const result = spawnSync('bash', [vmcall, 'coord:whoami', '{}'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('current mac rig launcher validates staged integrity and deployment preserves the executable contract', async () => {
  const mode = (await stat(currentBoot)).mode & 0o777;
  assert.equal(mode & 0o111, 0o111, 'boot-headless-current.sh must have executable bits set');

  const result = spawnSync(currentBoot, ['--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /SELF-TEST PASS: staged validation rejects missing\/tampered payloads/);

  const composer = await readFile(currentComposer, 'utf8');
  assert.match(composer, /\[ -x "\$HERE\/boot-headless-current\.sh" \]/);
  assert.match(composer, /rsync -a --chmod=F755 "\$HERE\/boot-headless-current\.sh"/);
  assert.match(composer, /PAYLOAD-MANIFEST\.sha256/);
});
