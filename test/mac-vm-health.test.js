import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../bin/mac-vm-health.sh', import.meta.url).pathname;
const vmcall = new URL('../bin/vm-rig/vmcall.sh', import.meta.url).pathname;

async function fixture({ ssh = true, qmp = true } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mac-vm-health-'));
  const bin = path.join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  for (const [name, body] of Object.entries({
    systemctl: '#!/bin/sh\nexit 0\n',
    ssh: `#!/bin/sh\nexit ${ssh ? 0 : 1}\n`,
    qmp: `#!/bin/sh\nexit ${qmp ? 0 : 1}\n`,
  })) {
    const file = path.join(bin, name);
    await writeFile(file, body); await chmod(file, 0o755);
  }
  const disk = path.join(dir, 'disk.img'); await writeFile(disk, 'disk');
  return { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MAC_VM_QMP_PROBE: path.join(bin, 'qmp'), MAC_VM_DISK_IMAGE: disk, MAC_VM_STALE_SEC: '0' } };
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
