const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');

test('every cargo build closes the sidecar flock fd before sccache can daemonize', () => {
  const cargoBuilds = builder.match(/cargo build /g) || [];
  const protectedBuilds = builder.match(/\( exec 9>&-; cd [^\n]+&& cargo build /g) || [];

  assert.equal(cargoBuilds.length, 2, 'update this guard when another cargo build is added');
  assert.equal(protectedBuilds.length, cargoBuilds.length);
});

test('a daemon-capable child with fd 9 closed cannot retain the parent flock', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-sidecar-lock-'));
  const lock = path.join(tmp, 'sidecar.lock');
  let sleeper = 0;

  try {
    sleeper = Number(
      execFileSync(
        'bash',
        [
          '-c',
          'exec 9>"$1"; flock 9; ( exec 9>&-; exec sleep 30 ) >/dev/null 2>&1 & echo $!',
          'bash',
          lock,
        ],
        { encoding: 'utf8' },
      ).trim(),
    );
    assert(Number.isInteger(sleeper) && sleeper > 1);
    assert.equal(spawnSync('flock', ['-n', lock, '-c', 'true']).status, 0);
  } finally {
    if (sleeper > 1) {
      try {
        process.kill(sleeper, 'SIGTERM');
      } catch {}
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
