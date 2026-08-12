import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../bin/mac-vm-health.sh', import.meta.url).pathname;

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
