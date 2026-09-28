// WI-10003665 — a Windows Server upgrade over a RUNNING operator exited 7:
// BeginPayloadUpgrade could not rename {app}\sidecar because the WSL-side
// operator (a detached daemon the role-exe close never reaches) held
// sidecar\source.tar.zst open over DrvFs, so the old version stayed installed.
// PrepareToInstall now runs stop-wsl-payload-holders.sh inside the distro.
//
// The script is plain Linux bash, so its behavior is exercised here against
// REAL processes holding REAL files under a temp payload root (absolute Linux
// paths are accepted in place of the Windows paths wslpath translates).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const innoDir = path.join(root, 'src-tauri/windows/inno');
const script = path.join(innoDir, 'stop-wsl-payload-holders.sh');
const iss = fs.readFileSync(path.join(innoDir, 'papercusp.iss'), 'utf8');

function payload(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-payload-holders-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['sidecar', 'sidecar-old']) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'source.tar.zst'), 'x');
  }
  return dir;
}

/** A process holding `file` open on fd 3; `ignoreTerm` models a stuck holder. */
function holder(t, file, { ignoreTerm = false } = {}) {
  const trap = ignoreTerm ? "trap '' TERM; " : '';
  const child = spawn('bash', ['-c', `${trap}exec 3<"$1"; while :; do sleep 0.2; done`, 'holder', file], {
    stdio: 'ignore',
  });
  t.after(() => { try { process.kill(child.pid, 'SIGKILL'); } catch {} });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal)));
  return { child, exited };
}

async function holding(pid, file) {
  for (let i = 0; i < 50; i += 1) {
    try {
      if (fs.readdirSync(`/proc/${pid}/fd`).some((fd) => fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === file)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`holder ${pid} never opened ${file}`);
}

function stop(roots, env = {}) {
  return spawnSync('bash', [script, ...roots], {
    encoding: 'utf8',
    env: { ...process.env, PAPERCUSP_STOP_TERM_GRACE_SEC: '3', PAPERCUSP_STOP_KILL_GRACE_SEC: '3', ...env },
    timeout: 30_000,
  });
}

test('nothing holding the payload: exit 0 without signalling anyone', (t) => {
  const dir = payload(t);
  const run = stop([path.join(dir, 'sidecar')]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /nothing in the distro holds/);
});

test('a holder under a payload root is stopped with SIGTERM; a sibling-prefix holder is left alone', async (t) => {
  const dir = payload(t);
  const held = path.join(dir, 'sidecar', 'source.tar.zst');
  const sibling = path.join(dir, 'sidecar-old', 'source.tar.zst');
  const target = holder(t, held);
  const bystander = holder(t, sibling);
  await holding(target.child.pid, held);
  await holding(bystander.child.pid, sibling);

  const run = stop([path.join(dir, 'sidecar')]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, new RegExp(`pid ${target.child.pid} \\(fd/3=${held.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\)`));
  assert.match(run.stdout, /all holders exited after SIGTERM/);
  assert.equal(await target.exited, 'SIGTERM');
  assert.doesNotThrow(() => process.kill(bystander.child.pid, 0), '"sidecar-old" is not under "sidecar"');
});

test('a holder that ignores SIGTERM is SIGKILLed after the grace', async (t) => {
  const dir = payload(t);
  const held = path.join(dir, 'sidecar', 'source.tar.zst');
  const stuck = holder(t, held, { ignoreTerm: true });
  await holding(stuck.child.pid, held);
  const run = stop([path.join(dir, 'sidecar')], { PAPERCUSP_STOP_TERM_GRACE_SEC: '1' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /sending SIGKILL/);
  assert.equal(await stuck.exited, 'SIGKILL');
});

test('an untranslatable root fails instead of scanning nothing', () => {
  const run = stop(['relative\\path'], { PATH: '/usr/bin:/bin' });
  assert.equal(run.status, 64);
});

test('the helpers ship LF-only (bash inside WSL) and pass bash -n', () => {
  assert.doesNotMatch(fs.readFileSync(script, 'utf8'), /\r/);
  assert.equal(spawnSync('bash', ['-n', script]).status, 0);
});

test('papercusp.iss runs the WSL stop between the role close and the payload rename, Server only', () => {
  const prepare = iss.slice(iss.indexOf('function PrepareToInstall'));
  const body = prepare.slice(0, prepare.indexOf('\nend;'));
  const close = body.indexOf('CloseRoleScopedRunningApplication');
  const wslStop = body.indexOf('StopWslPayloadHolders');
  const rename = body.indexOf('BeginPayloadUpgrade');
  assert.ok(close >= 0 && close < wslStop && wslStop < rename, body);

  const helper = iss.slice(iss.indexOf('function StopWslPayloadHolders'));
  const helperBody = helper.slice(0, helper.indexOf('\nend;'));
  assert.match(helperBody, /#if AppId == "com\.papercusp\.server"[\s\S]*ExtractTemporaryFile\('stop-wsl-payload-holders\.sh'\)[\s\S]*#endif/);

  for (const name of ['stop-wsl-payload-holders.ps1', 'stop-wsl-payload-holders.sh']) {
    assert.ok(fs.existsSync(path.join(innoDir, name)), `${name} must sit beside papercusp.iss`);
    assert.match(iss, new RegExp(`^Source: "${name.replace('.', '\\.')}"; Flags: dontcopy$`, 'm'));
  }
});
