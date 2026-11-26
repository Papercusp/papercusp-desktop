// Recurrence guard for WI-6554700010071472: each local-matrix frame keeps its embedded-PG
// data on a host bind volume, not in the container's overlay2 writable layer.
//
// WHY THIS TEST EXISTS
// initdb's 'syncing data to disk' step fsyncs every file of a fresh cluster. In the frames
// that landed on the docker root's filesystem, which shares / with the whole fleet: lm3's
// frame c spent 305.7s there and missed its boot deadline with zero scenarios run
// (WI-6554700010070220). local-matrix.sh now binds $PCUSP_RIG_PGVOL_ROOT/<net>/<frame> at
// /home/pcusp/pgdata, bakes pcusp into the frame image with the host uid (so the host owns,
// and can wipe, the data), wipes the dirs at provisioning and teardown, and points the IO
// preflight at that filesystem. The in-frame launch reset (deb-hetzner-rig.sh) empties
// pgdata in place: rm -rf of a mount point fails EBUSY on its final rmdir, which set -e
// turns into a failed launch.
//
// The static pins run everywhere. The behavioural cases run the REAL pgvol_prepare,
// pgvol_wipe and launch-reset line, extracted from the scripts. The mount case needs
// `sudo -n unshare -m` for a private mount namespace (nothing leaks to the host); without
// it that case skips with the reason.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const matrix = fs.readFileSync(path.join(root, 'bin/local-matrix.sh'), 'utf8');
const rig = fs.readFileSync(path.join(root, 'bin/lib/deb-hetzner-rig.sh'), 'utf8');

/** Source with whole-line comments removed, so prose cannot satisfy or trip a pin. */
const codeOf = (src) => src.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
const matrixCode = codeOf(matrix);
const rigCode = codeOf(rig);

function fnBody(src, name) {
  const match = src.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}$`, 'm'));
  assert.ok(match, `${name}() must remain a top-level function`);
  return match[0];
}

/** The in-frame launch reset, verbatim from deb-hetzner-rig.sh. */
const RESET_LINE = 'mkdir -p "$H/pgdata"; find "$H/pgdata" -mindepth 1 -delete';

function bash(script, args = [], opts = {}) {
  return spawnSync('bash', ['-c', script, 'pgvol-test', ...args], { encoding: 'utf8', timeout: 30000, ...opts });
}

/** pgvol_wipe + pgvol_prepare from local-matrix.sh, a stub log, and the config the script derives. */
function pgvolHarness(body) {
  return [
    'set -u',
    'log() { echo "LOG: $*" >&2; }',
    'PGVOL_ENABLED="${T_ENABLED:-1}"; PGVOL_ROOT="$1"; NET=testnet',
    'PGVOL_DIR="${T_DIR-$PGVOL_ROOT/$NET}"; PCUSP_UID="$(id -u)"',
    fnBody(matrix, 'pgvol_wipe'),
    fnBody(matrix, 'pgvol_prepare'),
    body,
  ].join('\n');
}

test('every frame binds its own host data dir at /home/pcusp/pgdata', () => {
  assert.match(matrixCode, /^PGVOL_ENABLED="\$\{PCUSP_RIG_PGVOL:-1\}"$/m);
  assert.match(matrixCode, /^PGVOL_DIR="\$PGVOL_ROOT\/\$NET"$/m);
  for (const f of ['A', 'B', 'C']) {
    const lower = f.toLowerCase();
    assert.ok(
      matrixCode.includes(`PGVOL_ARGS_${f}=(--mount "type=bind,source=$PGVOL_DIR/${lower},target=/home/pcusp/pgdata")`),
      `PGVOL_ARGS_${f} must bind $PGVOL_DIR/${lower}`,
    );
    const run = matrixCode.split('\n').find((line) => line.includes(`docker run -d --name "$CN_${f}"`));
    assert.ok(run, `frame ${f} must have a docker run line`);
    assert.ok(
      run.includes(`\${PGVOL_ARGS_${f}[@]+"\${PGVOL_ARGS_${f}[@]}"} "$IMAGE_TAG"`),
      `frame ${f} must pass its PG data mount: ${run}`,
    );
  }
});

test('provisioning prepares fresh data dirs after removing the old frames and before starting new ones', () => {
  const rm = matrixCode.indexOf('docker rm -f "$CN_A" "$CN_B" "$CN_C" >/dev/null 2>&1 || true');
  const prep = matrixCode.indexOf('pgvol_prepare || {');
  const run = matrixCode.indexOf('docker run -d --name "$CN_A"');
  assert.ok(rm >= 0 && prep >= 0 && run >= 0, 'the provisioning anchors must exist');
  assert.ok(rm < prep && prep < run, 'pgvol_prepare must run after docker rm -f and before the first docker run');
});

test('teardown wipes the data dirs after the frames are removed, unless asked to keep them', () => {
  const body = fnBody(matrix, 'rig_local_teardown');
  const rm = body.indexOf('docker rm -f "$CN_A" "$CN_B" "$CN_C" "$NET-dht"');
  const wipe = body.indexOf('pgvol_wipe');
  assert.ok(rm >= 0 && wipe > rm, 'pgvol_wipe must follow the frame removal in rig_local_teardown');
  assert.match(body, /PCUSP_RIG_PGVOL_KEEP:-0\}" = 1/);
});

test('the frame image bakes pcusp with the host uid, and the image tag carries that uid', () => {
  assert.match(matrixCode, /^PCUSP_UID="\$\(id -u\)"; \[ "\$PCUSP_UID" = 0 \] && PCUSP_UID=10001$/m);
  assert.match(matrixCode, /^IMAGE_TAG="pcusp-local-frame:ubuntu24-u\$PCUSP_UID"$/m);
  assert.ok(matrixCode.includes('docker build -q -t "$IMAGE_TAG" --build-arg PCUSP_UID="$PCUSP_UID" "$bctx"'));
  assert.match(matrixCode, /^ARG PCUSP_UID=10001$/m);
  assert.ok(matrixCode.includes('useradd -m -s /bin/bash -u "$PCUSP_UID" pcusp'));
});

test('the IO preflight measures the PG volume filesystem when the volume is on', () => {
  const body = fnBody(matrix, 'preflight_host_io');
  assert.match(body, /if \[ "\$PGVOL_ENABLED" = 1 \]; then[\s\S]*?root="\$PGVOL_ROOT"[\s\S]*?else[\s\S]*?DockerRootDir/);
});

test('the in-frame launch reset empties pgdata in place instead of removing it', () => {
  assert.ok(rigCode.split('\n').includes(RESET_LINE), 'deb-hetzner-rig.sh must carry the in-place reset line');
  assert.doesNotMatch(rigCode, /rm -rf[^\n]*"\$H\/pgdata"/, 'rm -rf of $H/pgdata fails EBUSY when pgdata is a mount point');
});

test('pgvol_prepare gives each frame an empty 0700 dir and clears the previous run', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgvol-'));
  try {
    const net = path.join(tmp, 'testnet');
    fs.mkdirSync(path.join(net, 'a'), { recursive: true });
    fs.writeFileSync(path.join(net, 'a', 'PG_VERSION'), '18');
    fs.mkdirSync(path.join(net, 'stale'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'othernet', 'a'), { recursive: true });
    const r = bash(pgvolHarness('pgvol_prepare'), [tmp]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(net).sort(), ['a', 'b', 'c']);
    for (const f of ['a', 'b', 'c']) {
      const dir = path.join(net, f);
      assert.deepEqual(fs.readdirSync(dir), [], `${f} must start empty`);
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700, `${f} must be 0700`);
    }
    assert.ok(fs.existsSync(path.join(tmp, 'othernet', 'a')), "another rig net's data must be left alone");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pgvol_wipe removes only this rig dir and refuses unsafe targets', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgvol-'));
  try {
    fs.mkdirSync(path.join(tmp, 'testnet', 'a'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'keep'), 'x');
    let r = bash(pgvolHarness('pgvol_wipe'), [tmp]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(tmp, 'testnet')), 'the rig dir must be gone');
    assert.ok(fs.existsSync(path.join(tmp, 'keep')), 'a sibling must survive');
    for (const unsafe of ['', '/', tmp, `${tmp}/`, `${tmp}/x/..`]) {
      r = bash(pgvolHarness('pgvol_wipe'), [tmp], { env: { ...process.env, T_DIR: unsafe } });
      assert.equal(r.status, 1, `pgvol_wipe must refuse '${unsafe}'`);
      assert.ok(fs.existsSync(path.join(tmp, 'keep')), `refusing '${unsafe}' must delete nothing`);
    }
    r = bash(pgvolHarness('pgvol_prepare; pgvol_wipe'), [tmp], { env: { ...process.env, T_ENABLED: '0' } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(tmp, 'testnet')), 'PCUSP_RIG_PGVOL=0 must create nothing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the launch reset empties a plain pgdata dir, keeps its mode, and creates a missing one', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgvol-reset-'));
  try {
    const pg = path.join(tmp, 'pgdata');
    fs.mkdirSync(path.join(pg, 'base', '1'), { recursive: true });
    fs.chmodSync(pg, 0o700);
    fs.writeFileSync(path.join(pg, 'PG_VERSION'), '18');
    fs.writeFileSync(path.join(pg, '.hidden'), 'x');
    const r = bash(`set -e; H="$1"; ${RESET_LINE}`, [tmp]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(pg), []);
    assert.equal(fs.statSync(pg).mode & 0o777, 0o700);
    fs.rmSync(pg, { recursive: true });
    assert.equal(bash(`set -e; H="$1"; ${RESET_LINE}`, [tmp]).status, 0);
    assert.ok(fs.statSync(pg).isDirectory(), 'a missing pgdata must be created');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const unshareProbe = spawnSync('sudo', ['-n', 'unshare', '-m', '--propagation', 'private', 'true'], { timeout: 15000 });
const mountSkip = unshareProbe.status === 0 ? false : 'needs `sudo -n unshare -m` for a private mount namespace';

test('on a bind-mounted pgdata the old rm -rf fails EBUSY and the in-place reset succeeds', { skip: mountSkip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgvol-mount-'));
  try {
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'home', 'pgdata'), { recursive: true });
    const script = [
      'H="$1/home"',
      'mount --bind "$1/src" "$H/pgdata" || exit 90',
      'mkdir -p "$H/pgdata/base"; touch "$H/pgdata/PG_VERSION" "$H/pgdata/base/x"',
      'if rm -rf "$H/pgdata" 2>/dev/null; then echo OLD=ok; else echo OLD=busy; fi',
      'mkdir -p "$H/pgdata/base"; touch "$H/pgdata/base/y" "$H/pgdata/.hidden"',
      `if ( set -e; ${RESET_LINE} ); then echo NEW=ok; else echo NEW=fail; fi`,
      'echo "LEFT=$(ls -A "$H/pgdata" | wc -l)"',
      'umount "$H/pgdata"',
    ].join('\n');
    const r = spawnSync('sudo', ['-n', 'unshare', '-m', '--propagation', 'private', 'bash', '-c', script, 'mount-case', tmp], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^OLD=busy$/m, 'the discriminating case: rm -rf of a mount point must fail');
    assert.match(r.stdout, /^NEW=ok$/m);
    assert.match(r.stdout, /^LEFT=0$/m);
  } finally {
    spawnSync('sudo', ['-n', 'rm', '-rf', tmp], { timeout: 15000 });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
