/**
 * WI-7101 — target-dir slot claiming.
 *
 * The bug: ~/.cargo/config.toml pins one shared Rust target dir for the whole box,
 * so two concurrent `tauri dev` builds interleave writes to the GENERATED
 * app-manifest and both die. On 2026-08-02 an agent following the documented
 * "launch your own isolated instance" advice took down the OWNER'S desktop.
 *
 * These tests drive the helper in a sandboxed HOME so they never touch the real
 * ~/.cargo-target or the live desktop instances on this box.
 */
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawn } = require('node:child_process');
const {
  mkdtempSync,
  rmSync,
  existsSync,
  lstatSync,
  linkSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
} = require('node:fs');
const { tmpdir, homedir } = require('node:os');
const { join } = require('node:path');

// Overridable so a mutation probe can point the suite at a mutated COPY of the
// helper outside the shared tree instead of mutating the tracked file.
const HELPER = process.env.PAPERCUSP_CLAIM_TARGET_DIR_HELPER
  || join(__dirname, '..', 'bin', 'lib', 'claim-target-dir.sh');
const BUILD_LINUX = readFileSync(join(__dirname, '..', 'bin', 'build-linux-local.sh'), 'utf8');
const BUILD_APPIMAGE = readFileSync(join(__dirname, '..', 'bin', 'build-appimage.sh'), 'utf8');
const RUSTUP_HOME = process.env.RUSTUP_HOME || join(homedir(), '.rustup');

let home;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wi7101-'));
  mkdirSync(join(home, '.cargo'));
  mkdirSync(join(home, 'src-tauri', 'src'), { recursive: true });
  writeFileSync(join(home, 'src-tauri', 'Cargo.toml'),
    '[package]\nname = "target-slot-fixture"\nversion = "0.1.0"\nedition = "2021"\n');
  writeFileSync(join(home, 'src-tauri', 'src', 'lib.rs'), '');
  configureTarget(join(home, '.cargo-target'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function configureTarget(target) {
  writeFileSync(join(home, '.cargo', 'config.toml'), `[build]\ntarget-dir = ${JSON.stringify(target)}\n`);
}

function isolatedEnv(env = {}) {
  return {
    ...process.env,
    HOME: home,
    CARGO_HOME: join(home, '.cargo'),
    RUSTUP_HOME,
    CARGO_TARGET_DIR: '',
    CARGO_BUILD_TARGET_DIR: undefined,
    PAPERCUSP_DESKTOP_TARGET_ROOT: home,
    PAPERCUSP_FS_MUTEX_LOCK_DIR: join(home, 'mutexes'),
    PAPERCUSP_DISABLE_FS_MUTEX: undefined,
    PAPERCUSP_DISK_RETENTION_MUTEX_HELD: undefined,
    ...env,
  };
}

/** Source the helper and report the CARGO_TARGET_DIR it settled on. */
function claim(env = {}) {
  return execFileSync(
    'bash',
    ['-c', `set -euo pipefail; . "${HELPER}"; printf '%s' "\${CARGO_TARGET_DIR:-}"`],
    { cwd: home, env: isolatedEnv(env), encoding: 'utf8' },
  );
}

function writeRetentionLease(tag, targetPath) {
  const retentionRoot = join(home, 'retention');
  mkdirSync(retentionRoot, { recursive: true });
  const pin = tag.startsWith('agent-pin-');
  const metadata = pin ? 'agent-pin-' + Buffer.from(JSON.stringify({ version: 1,
    id: require('node:crypto').randomUUID(), owner: 'slot-test', reason: 'fixture evidence',
    createdAt: new Date().toISOString() })).toString('base64url') : tag;
  writeFileSync(join(retentionRoot, `lease-${tag}.tsv`), [
    'schema=papercusp-release-retention/v1',
    `tag=${metadata}`,
    'created_ns=1',
    `expires_ns=${pin ? BigInt(Date.now() + 86400000) * 1000000n : 0}`,
    `path=${targetPath}`,
    '',
  ].join('\n'));
  return retentionRoot;
}

// Exercise the real allocator and atomic reservation ledger. Only the physical
// filesystem probes are hermetic: primary and alternate are separate devices.
function nativeClaimScript(tail = 'printf "%s\\n%s\\n" "$CARGO_TARGET_DIR" "$PAPERCUSP_DISK_RESERVATION_FILE"; cat "$PAPERCUSP_DISK_RESERVATION_FILE"') {
  return `set -euo pipefail
    PAPERCUSP_DESKTOP_REAP_ONLY=1 . "${HELPER}"
    . "${join(__dirname, '..', 'bin', 'lib', 'disk-preflight.sh')}"
    papercusp_free_gb() {
      case "$1" in "$HOME"/alternate*) printf '%s' "$TEST_ALTERNATE_FREE";;
        *) printf '%s' "$TEST_PRIMARY_FREE";; esac
    }
    papercusp_device_id() {
      case "$1" in /) printf '0';; "$HOME"/alternate*) printf '2';; *) printf '1';; esac
    }
    PAPERCUSP_DESKTOP_NATIVE_DEV=1 __pc_claim_target_dir
    ${tail}`;
}

test('root-side Cargo defaults redirect to data without creating or moving a cache', () => {
  const output = execFileSync('bash', ['-c', `set -euo pipefail
    PAPERCUSP_DESKTOP_REAP_ONLY=1 . "$1"
    papercusp_cargo_metadata_target_dir() { printf '%s' "$HOME/root-target"; }
    papercusp_device_id() { case "$1" in /|"$HOME"/root*) printf '0';; *) printf '1';; esac; }
    __pc_cargo_target_root`, 'placement', HELPER], { cwd: home, env: isolatedEnv(), encoding: 'utf8' });
  assert.strictEqual(output, '/mnt/data/cargo-target');
  assert.ok(!existsSync(join(home, 'root-target')));
});

test('unmounted data storage refuses a root-side default instead of falling back to root', () => {
  assert.throws(() => execFileSync('bash', ['-c', `set -euo pipefail
    PAPERCUSP_DESKTOP_REAP_ONLY=1 . "$1"
    papercusp_cargo_metadata_target_dir() { printf '%s' "$HOME/root-target"; }
    papercusp_device_id() { printf '0'; }
    __pc_cargo_target_root`, 'placement', HELPER], { cwd: home, env: isolatedEnv(), encoding: 'utf8' }),
  error => error.status === 2 && /root filesystem/.test(error.stderr.toString()));
  assert.ok(!existsSync(join(home, 'root-target')));
});

test('an explicit root-side Cargo target is refused before claiming a slot, including disabled slots', () => {
  for (const slots of ['0', '4']) {
    assert.throws(() => execFileSync('bash', ['-c', `set -euo pipefail
      PAPERCUSP_DESKTOP_REAP_ONLY=1 . "$1"
      papercusp_device_id() { printf '0'; }
      __pc_claim_target_root`, 'placement', HELPER], { cwd: home, encoding: 'utf8',
      env: isolatedEnv({ CARGO_TARGET_DIR: join(home, 'root-target'), PAPERCUSP_DESKTOP_TARGET_SLOTS: slots }) }),
    error => error.status === 2 && /root filesystem/.test(error.stderr.toString()));
  }
  assert.ok(!existsSync(join(home, 'root-target')));
  assert.ok(!existsSync(join(home, '.papercusp', 'desktop-dev-slots')));
});

test('a target symlink back to root is refused using its actual device', { skip: process.platform !== 'linux' }, () => {
  const alias = join(home, 'root-link');
  symlinkSync('/', alias);
  assert.throws(() => claim({ CARGO_TARGET_DIR: join(alias, 'p009-must-not-create') }),
    error => error.status === 2 && /root filesystem/.test(error.stderr.toString()));
  assert.ok(lstatSync(alias).isSymbolicLink());
});

const nativePlacementSkip = process.platform !== 'linux' ? 'Linux filesystem placement'
  : !existsSync('/mnt/data') || statSync('/mnt/data').dev === statSync('/').dev
    ? 'requires a separately mounted /mnt/data' : false;

test('native filesystem placement redirects real Cargo root metadata and accepts a separate data target',
  { skip: nativePlacementSkip }, () => {
    // No device or Cargo stubs: Cargo reads a real project on the root device,
    // while stat supplies an oracle independent of the shell placement helper.
    const project = mkdtempSync('/var/tmp/p009-native-cargo-');
    try {
      assert.strictEqual(statSync(project).dev, statSync('/').dev);
      mkdirSync(join(project, '.cargo'));
      mkdirSync(join(project, 'src-tauri', 'src'), { recursive: true });
      writeFileSync(join(project, 'src-tauri', 'Cargo.toml'),
        '[package]\nname = "native-placement-control"\nversion = "0.1.0"\nedition = "2021"\n');
      writeFileSync(join(project, 'src-tauri', 'src', 'lib.rs'), '');
      const rootTarget = join(project, 'target-must-stay-absent');
      writeFileSync(join(project, '.cargo', 'config.toml'),
        `[build]\ntarget-dir = ${JSON.stringify(rootTarget)}\n`);
      const resolveTarget = (env = {}) => execFileSync('bash', ['-c',
        'set -euo pipefail; PAPERCUSP_DESKTOP_REAP_ONLY=1 . "$1"; __pc_cargo_target_root',
        'native-placement', HELPER], { cwd: project, encoding: 'utf8',
        env: isolatedEnv({ PAPERCUSP_DESKTOP_TARGET_ROOT: project, ...env }) });
      assert.strictEqual(resolveTarget(), '/mnt/data/cargo-target');
      assert.ok(!existsSync(rootTarget));
      const dataTarget = join('/mnt/data', home.split('/').pop(), 'native-data-target');
      assert.notStrictEqual(statSync('/mnt/data').dev, statSync('/').dev);
      writeFileSync(join(project, '.cargo', 'config.toml'),
        `[build]\ntarget-dir = ${JSON.stringify(dataTarget)}\n`);
      assert.strictEqual(resolveTarget(), dataTarget);
      assert.ok(!existsSync(dataTarget), 'resolving placement must not create a cache');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

test('native filesystem placement refuses explicit root and root symlink through the public allocator with slots enabled or disabled',
  { skip: nativePlacementSkip }, () => {
    const project = mkdtempSync('/var/tmp/p009-native-refusal-');
    try {
      assert.strictEqual(statSync(project).dev, statSync('/').dev);
      const alias = join(home, 'native-root-link');
      symlinkSync(project, alias);
      for (const target of [join(project, 'target-must-stay-absent'), join(alias, 'target-must-stay-absent')]) {
        for (const slots of ['0', '4']) for (const nativeDev of ['0', '1']) {
          // Exercise the public dispatcher: both allocation modes must admit
          // storage before selecting a slot or creating its reservation/cache.
          assert.throws(() => execFileSync('bash', ['-c',
            'set -euo pipefail; PAPERCUSP_DESKTOP_REAP_ONLY=1 . "$1"; __pc_claim_target_dir',
            'native-placement', HELPER], { cwd: home, encoding: 'utf8',
            env: isolatedEnv({ CARGO_TARGET_DIR: target, PAPERCUSP_DESKTOP_TARGET_SLOTS: slots,
              PAPERCUSP_DESKTOP_NATIVE_DEV: nativeDev }) }),
          error => error.status === 2 && /root filesystem/.test(error.stderr.toString()),
          `target=${target}; slots=${slots}; nativeDev=${nativeDev}`);
          assert.ok(!existsSync(target));
          assert.ok(!existsSync(join(home, '.papercusp', 'desktop-dev-slots')));
          assert.ok(!existsSync(join(home, 'reservations')));
        }
      }
      assert.ok(lstatSync(alias).isSymbolicLink());
      assert.ok(!existsSync(join(home, '.papercusp', 'desktop-dev-slots')));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

function nativeEnv(env = {}) {
  return isolatedEnv({
    PAPERCUSP_DESKTOP_CARGO_FALLBACK_ROOTS: join(home, 'alternate'),
    PAPERCUSP_DESKTOP_PRIVATE_SLOT_REAP: '0',
    PAPERCUSP_DISK_RESERVATION_DIR: join(home, 'reservations'),
    TEST_PRIMARY_FREE: '20',
    TEST_ALTERNATE_FREE: '100',
    ...env,
  });
}

function claimNative(env = {}) {
  const output = execFileSync('bash', ['-c', nativeClaimScript()], {
    cwd: home, env: nativeEnv(env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [dir, receipt, ...record] = output.trim().split('\n');
  return { dir, receipt, record: record.join('\n') };
}

test('native capacity admission skips a leased primary and insufficient cold slots for a roomy configured root', () => {
  const primary = join(home, '.cargo-target');
  const retention = writeRetentionLease('other-cut', primary);
  const result = claimNative({ PAPERCUSP_RELEASE_RETENTION_ROOT: retention });
  assert.strictEqual(result.dir, join(home, 'alternate'));
  assert.match(result.receipt, /reservations\/dev-2\//);
  assert.match(result.record, /gb=65\n/);
  assert.match(result.record, /label=native dev Cargo build/);
  assert.ok(existsSync(join(retention, 'lease-other-cut.tsv')));
});

test('native capacity admission prefers an affordable warm primary and reserves its actual budget', () => {
  mkdirSync(join(home, '.cargo-target', 'debug', 'deps'), { recursive: true });
  const result = claimNative();
  assert.strictEqual(result.dir, join(home, '.cargo-target'));
  assert.match(result.record, /gb=12\n/);
  assert.ok(!existsSync(join(home, 'alternate')));
});

test('native capacity admission fails 28 before Cargo when every configured filesystem is insufficient', () => {
  assert.throws(() => claimNative({ TEST_ALTERNATE_FREE: '20' }), (error) => {
    assert.strictEqual(error.status, 28);
    assert.match(error.stderr.toString(), /insufficient disk/);
    return true;
  });
});

test('native capacity admission honors and reserves an explicit target without switching roots', () => {
  const explicit = join(home, 'explicit');
  const result = claimNative({ CARGO_TARGET_DIR: explicit, TEST_PRIMARY_FREE: '100' });
  assert.strictEqual(result.dir, explicit);
  assert.match(result.record, /gb=65\n/);
  assert.throws(() => claimNative({ CARGO_TARGET_DIR: explicit }), (error) => error.status === 28);
});

test('native capacity admission subtracts live reservations and cannot overcommit a roomy fallback', async () => {
  const child = spawn('bash', ['-c', nativeClaimScript('echo "$CARGO_TARGET_DIR"; exec sleep 30')], {
    cwd: home, env: nativeEnv({ TEST_ALTERNATE_FREE: '100' }), stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const dir = await new Promise((resolve, reject) => {
      child.stdout.once('data', (buf) => resolve(buf.toString().trim()));
      child.once('exit', (code) => reject(new Error(`native holder exited ${code}`)));
    });
    assert.strictEqual(dir, join(home, 'alternate'));
    assert.throws(() => claimNative(), (error) => {
      assert.strictEqual(error.status, 28);
      assert.match(error.stderr.toString(), /65GB is already RESERVED/);
      return true;
    });
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
});

test('native capacity admission keeps a live preparation receipt after time has elapsed', () => {
  const childScript = nativeClaimScript('printf "ADOPTED=%s\\n" "$PAPERCUSP_DISK_RESERVATION_FILE"');
  const script = nativeClaimScript(`
    receipt="$PAPERCUSP_DISK_RESERVATION_FILE"
    expires="$(sed -n 's/^expires=//p' "$receipt")"
    sed "s/^expires=.*/expires=$((expires - 60))/" "$receipt" > "$receipt.tmp"
    mv "$receipt.tmp" "$receipt"
    bash -c "$1"
    [ "$receipt" = "$PAPERCUSP_DISK_RESERVATION_FILE" ]
    papercusp_release_disk_reservation`);
  const result = execFileSync('bash', ['-c', script, 'handoff', childScript], {
    cwd: home, env: nativeEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(result, /ADOPTED=.*reservations\/dev-2\//);
});

test('native capacity admission skips foreign and unreadable fallback leases without altering them', () => {
  const alternate = join(home, 'alternate');
  const retention = writeRetentionLease('foreign', alternate);
  assert.notStrictEqual(claimNative({ PAPERCUSP_RELEASE_RETENTION_ROOT: retention }).dir, alternate);
  const invalid = join(retention, 'lease-invalid.tsv');
  writeFileSync(invalid, 'invalid retention marker\n');
  assert.throws(() => claimNative({ PAPERCUSP_RELEASE_RETENTION_ROOT: retention }), (error) => error.status === 28);
  assert.strictEqual(readFileSync(invalid, 'utf8'), 'invalid retention marker\n');
});

test('native capacity admission protects a fallback root also configured as another launcher primary', async () => {
  const child = spawn('bash', ['-c', nativeClaimScript('echo "$CARGO_TARGET_DIR"; exec sleep 30')], {
    cwd: home, env: nativeEnv({ TEST_ALTERNATE_FREE: '1000' }), stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('exit', (code) => reject(new Error(`native holder exited ${code}`)));
    });
    configureTarget(join(home, 'alternate'));
    const second = claimNative({ TEST_ALTERNATE_FREE: '1000' });
    assert.notStrictEqual(second.dir, join(home, 'alternate'));
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
});

function prepareCollectionTarget(root) {
  return execFileSync(
    'bash',
    [
      '-c',
      `set -euo pipefail; export CARGO_TARGET_DIR="$HOME/deliberate"; . "${HELPER}" >/dev/null; papercusp_prepare_collection_target_root "$1"`,
      'prepare-collection-target',
      root,
    ],
    { env: { ...process.env, HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

/**
 * Hold a slot the way a real launch does — claim, then `exec` a long-lived
 * process — and return that process plus the dir it claimed. The `exec` is the
 * point: it proves the lock survives the very thing the wrapper does after
 * sourcing, rather than only surviving inside the sourcing shell.
 */
function holdSlotViaExec(env = {}, { execCommand = 'sleep 30' } = {}) {
  const child = spawn(
    'bash',
    ['-c', `. "${HELPER}" 2>/dev/null; echo "$CARGO_TARGET_DIR"; exec ${execCommand}`],
    { cwd: home, env: isolatedEnv(env), stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return new Promise((resolve) => {
    child.stdout.once('data', (buf) => resolve({ child, dir: buf.toString().trim() }));
  });
}

test('a lone instance keeps the shared dir, so the ordinary case is unchanged', () => {
  // The historical configuration still selects its existing warm cache.
  assert.strictEqual(claim(), join(home, '.cargo-target'));
});

test('slot zero honors Cargo-configured relocation instead of forcing the home filesystem', () => {
  const relocated = join(home, 'data disk', 'cargo-target');
  configureTarget(relocated);
  assert.strictEqual(claim(), relocated);
});

test('a resumed release cut prefers the target slot holding its own leased artifacts', async () => {
  const held = await holdSlotViaExec();
  try {
    const ownSlot = join(home, '.cargo-target-dev3');
    const retentionRoot = writeRetentionLease('resume-cut', join(ownSlot, 'release', 'bundle'));
    assert.strictEqual(claim({
      PAPERCUSP_RELEASE_TAG: 'resume-cut',
      PAPERCUSP_RELEASE_RETENTION_ROOT: retentionRoot,
    }), ownSlot);
  } finally {
    held.child.kill();
  }
});

test('a resumed cut still skips another cut\'s leased target slot', async () => {
  const held = await holdSlotViaExec();
  try {
    const foreignSlot = join(home, '.cargo-target-dev2');
    const retentionRoot = writeRetentionLease('other-cut', join(foreignSlot, 'release', 'bundle'));
    assert.strictEqual(claim({
      PAPERCUSP_RELEASE_TAG: 'resume-cut',
      PAPERCUSP_RELEASE_RETENTION_ROOT: retentionRoot,
    }), join(home, '.cargo-target-dev3'));
  } finally {
    held.child.kill();
  }
});

test('relocated target slots retain concurrency isolation on the configured filesystem', async () => {
  const relocated = join(home, 'data disk', 'cargo-target');
  configureTarget(relocated);
  const held = await holdSlotViaExec();
  try {
    assert.strictEqual(held.dir, relocated);
    assert.strictEqual(claim(), `${relocated}-dev2`);
  } finally {
    held.child.kill();
  }
});

test('relocated slots use a writable same-filesystem fallback when the configured parent forbids siblings', async () => {
  const relocationParent = join(home, 'root-owned-data');
  const relocated = join(relocationParent, 'cargo-target');
  mkdirSync(relocated, { recursive: true });
  configureTarget(relocated);
  chmodSync(relocationParent, 0o555);
  const held = await holdSlotViaExec();
  try {
    assert.strictEqual(held.dir, relocated);
    const fallback = join(relocated, '.papercusp-target-slots', 'dev2');
    assert.strictEqual(claim(), fallback);
    assert.ok(lstatSync(fallback).isDirectory(), 'the allocator must materialize the fallback before Cargo starts');
    assert.ok(!existsSync(`${relocated}-dev2`), 'the allocator must not pretend the forbidden sibling exists');
  } finally {
    held.child.kill();
    chmodSync(relocationParent, 0o700);
  }
});

test('private overflow also stays usable below a non-writable configured parent', async () => {
  const relocationParent = join(home, 'root-owned-overflow');
  const relocated = join(relocationParent, 'cargo-target');
  mkdirSync(relocated, { recursive: true });
  configureTarget(relocated);
  chmodSync(relocationParent, 0o555);
  const held = await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' });
  try {
    assert.strictEqual(held.dir, relocated);
    const overflow = claim({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' });
    assert.ok(
      overflow.startsWith(join(relocated, '.papercusp-target-slots', 'pid')),
      `expected private fallback below the writable shared root, got ${overflow}`,
    );
    assert.ok(lstatSync(overflow).isDirectory(), 'the private fallback must exist before Cargo starts');
  } finally {
    held.child.kill();
    chmodSync(relocationParent, 0o700);
  }
});

test('Cargo build-target environment configuration is honored', () => {
  const selected = join(home, 'environment-target');
  assert.strictEqual(claim({ CARGO_BUILD_TARGET_DIR: selected }), selected);
});

test('the selected project config wins over Cargo home config', () => {
  const selected = join(home, 'project-target');
  mkdirSync(join(home, 'src-tauri', '.cargo'));
  writeFileSync(join(home, 'src-tauri', '.cargo', 'config.toml'),
    `[build]\ntarget-dir = ${JSON.stringify(selected)}\n`);
  assert.strictEqual(claim(), selected);
});

test('with no configured relocation the allocator follows Cargo default target placement', () => {
  rmSync(join(home, '.cargo', 'config.toml'));
  assert.strictEqual(claim(), join(home, 'src-tauri', 'target'));
});

test('unreadable Cargo configuration refuses before claiming a fallback home target', () => {
  writeFileSync(join(home, '.cargo', 'config.toml'), '[build\ntarget-dir =');
  assert.throws(() => claim(), /cannot resolve Cargo target directory/);
  assert.ok(!existsSync(join(home, '.papercusp', 'desktop-dev-slots', 'slot0.lock')));
});

test('a second concurrent instance gets a DIFFERENT dir, never the shared one', async () => {
  const held = await holdSlotViaExec();
  try {
    assert.strictEqual(held.dir, join(home, '.cargo-target'));
    const second = claim();
    assert.notStrictEqual(second, held.dir, 'second instance reused the shared dir — this is the corruption path');
    assert.strictEqual(second, join(home, '.cargo-target-dev2'));
  } finally {
    held.child.kill();
  }
});

test('the slot lock SURVIVES exec — the claim covers the whole instance lifetime', async () => {
  // Load-bearing and easy to get wrong: the wrapper sources the helper and then
  // execs `npm run tauri`, replacing the shell. If the lock did not live on the
  // open file description, the slot would free the instant the real build began —
  // the claim would look correct in a unit test and evaporate in production.
  const held = await holdSlotViaExec();
  try {
    // The sourcing shell is GONE (replaced by sleep), yet the slot is still held.
    assert.strictEqual(claim(), join(home, '.cargo-target-dev2'));
  } finally {
    held.child.kill();
  }
});

test('a released slot is reclaimed by the next instance (no stale-lock leak)', async () => {
  const held = await holdSlotViaExec();
  assert.strictEqual(held.dir, join(home, '.cargo-target'));
  held.child.kill();
  await new Promise((r) => held.child.once('exit', r));
  // No trap, no cleanup step — the kernel drops the lock when the holder dies.
  assert.strictEqual(claim(), join(home, '.cargo-target'), 'slot 0 was not reclaimed after its holder died');
});

test('slots are handed out in order, and exhaustion falls back to a PRIVATE dir — never the shared one', async () => {
  const holders = [];
  try {
    for (let i = 0; i < 3; i++) holders.push(await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' }));
    assert.deepStrictEqual(
      holders.map((h) => h.dir),
      [join(home, '.cargo-target'), join(home, '.cargo-target-dev2'), join(home, '.cargo-target-dev3')],
    );

    // Every slot busy. The fallback must be private: falling back to the shared
    // dir would silently restore the exact bug this file exists to prevent.
    const overflow = claim({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' });
    assert.ok(overflow.startsWith(join(home, '.cargo-target-pid')), `expected a private per-pid dir, got ${overflow}`);
    assert.notStrictEqual(overflow, join(home, '.cargo-target'));
  } finally {
    holders.forEach((h) => h.child.kill());
  }
});

// WI-10004764 — private overflow roots were never removed: 131 of them, 774 GiB,
// filled the data disk. The reaper must remove dead ones, keep anything that is
// live, recent, leased or referenced, and let overflow reuse a dead root warm.
//
// A pid above the kernel's pid_max (4194304 on Linux) can never be live, so
// these names model a legacy root whose claiming launcher is gone.
function reapEnv(env = {}) {
  return {
    PAPERCUSP_DESKTOP_PRIVATE_SLOT_REAP_SYNC: '1',
    PAPERCUSP_DESKTOP_PRIVATE_SLOT_GRACE_SEC: '1800',
    PAPERCUSP_RELEASE_RETENTION_ROOT: join(home, 'retention'),
    ...env,
  };
}

function makePrivateRoot(name, { ageSec = 7200, marker = name } = {}) {
  const dir = join(home, `.cargo-target-${name}`);
  mkdirSync(join(dir, 'debug'), { recursive: true });
  writeFileSync(join(dir, 'debug', 'marker'), marker);
  ageRoot(dir, ageSec);
  return dir;
}

function ageRoot(dir, ageSec) {
  const t = Date.now() / 1000 - ageSec;
  for (const p of [join(dir, 'debug'), dir]) if (existsSync(p)) utimesSync(p, t, t);
}

function auditLines() {
  const audit = join(home, 'retention', 'deletion-audit.tsv');
  return existsSync(audit) ? readFileSync(audit, 'utf8').trim().split('\n') : [];
}

test('private reaping waits for a pin writer before renaming its root', async () => {
  const root = makePrivateRoot('pid99999989');
  const control = makePrivateRoot('pid99999988');
  const { pathToFileURL } = require('node:url');
  const { withFsMutex } = await import(pathToFileURL(join(__dirname, '../../scripts/lib/fs-mutex.mjs')).href);
  const oldLockRoot = process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR;
  const oldDisable = process.env.PAPERCUSP_DISABLE_FS_MUTEX;
  process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR = join(home, 'mutexes');
  delete process.env.PAPERCUSP_DISABLE_FS_MUTEX;
  let child, completion, output = '', prematureExit = false;
  try {
    await withFsMutex('papercusp-disk-retention', async () => {
      child = spawn('bash', [join(__dirname, '../bin/reap-private-target-slots.sh')], {
        cwd: home, env: isolatedEnv(reapEnv({ ROOT: home })), stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      completion = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => { prematureExit = true; resolve(code); });
      });
      // The writer deliberately has not committed its pin yet. A different
      // flock or a pre-lock lease read would rename/delete the root here.
      const deadline = Date.now() + 5000;
      while (!prematureExit && existsSync(root) && Date.now() < deadline &&
          !readdirSync(join(home, 'mutexes')).some(name => name.endsWith('.queue') &&
            readdirSync(join(home, 'mutexes', name)).length)) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(existsSync(root), 'a pin writer must exclude even the rename');
      assert.strictEqual(prematureExit, false, output);
      writeRetentionLease('agent-pin-concurrent-writer', root);
    });
    assert.strictEqual(await completion, 0, output);
    assert.ok(existsSync(root), 'the final read must observe the newly written pin');
    assert.ok(!existsSync(control), 'an unpinned root remains reclaimable');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    if (completion) await completion;
    if (oldLockRoot === undefined) delete process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR;
    else process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR = oldLockRoot;
    if (oldDisable === undefined) delete process.env.PAPERCUSP_DISABLE_FS_MUTEX;
    else process.env.PAPERCUSP_DISABLE_FS_MUTEX = oldDisable;
  }
});

test('guarded deletion holds the pin mutex through the actual removal', async () => {
  const root = makePrivateRoot('pid99999987');
  const ready = join(home, 'removal-entered');
  const proceed = join(home, 'finish-removal');
  const script = `set -euo pipefail
    source "$1"
    # Capture barrier paths separately from rm's own arguments.
    ready="$2"; proceed="$3"
    rm() { touch "$ready"; while [[ ! -e "$proceed" ]]; do sleep 0.02; done; command rm "$@"; }
    release_artifacts_guarded_delete "$4"`;
  const child = spawn('bash', ['-c', script, 'guarded-delete', join(__dirname, '../bin/lib/release-artifacts.sh'), ready, proceed, root], {
    cwd: home, env: isolatedEnv(reapEnv()), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  const completion = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const { pathToFileURL } = require('node:url');
  const { withFsMutex } = await import(pathToFileURL(join(__dirname, '../../scripts/lib/fs-mutex.mjs')).href);
  const saved = [process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR, process.env.PAPERCUSP_DISABLE_FS_MUTEX];
  process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR = join(home, 'mutexes');
  delete process.env.PAPERCUSP_DISABLE_FS_MUTEX;
  let writer, acquired = false;
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(ready) && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(ready), output);
    writer = withFsMutex('papercusp-disk-retention', async () => { acquired = true; }, { retryMs: 10, timeoutMs: 5000 });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(acquired, false, 'pin mutations must wait until rm finishes');
    writeFileSync(proceed, '');
    assert.strictEqual(await completion, 0, output);
    await writer;
    assert.strictEqual(acquired, true);
    assert.ok(!existsSync(root));
  } finally {
    writeFileSync(proceed, '');
    await completion;
    if (writer) await writer;
    for (const [index, key] of ['PAPERCUSP_FS_MUTEX_LOCK_DIR', 'PAPERCUSP_DISABLE_FS_MUTEX'].entries()) {
      if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];
    }
  }
});

test('the scheduled reaper reuses its enclosing pin mutex and lock timeouts keep roots intact', async () => {
  const root = makePrivateRoot('pid99999986');
  const control = makePrivateRoot('pid99999985');
  const { pathToFileURL } = require('node:url');
  const { withFsMutex } = await import(pathToFileURL(join(__dirname, '../../scripts/lib/fs-mutex.mjs')).href);
  const saved = [process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR, process.env.PAPERCUSP_DISABLE_FS_MUTEX];
  process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR = join(home, 'mutexes');
  delete process.env.PAPERCUSP_DISABLE_FS_MUTEX;
  const run = env => new Promise((resolve, reject) => {
    const child = spawn('bash', [join(__dirname, '../bin/reap-private-target-slots.sh')], {
      cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_FS_MUTEX_TIMEOUT_MS: '100', ...env })),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject); child.once('close', code => resolve({ code, output }));
  });
  try {
    await withFsMutex('papercusp-disk-retention', async () => {
      const refused = await run({});
      assert.notStrictEqual(refused.code, 0, refused.output);
      assert.ok(existsSync(root)); assert.ok(existsSync(control));
      writeRetentionLease('agent-pin-inherited-mutex', root);
      const scheduled = await run({ PAPERCUSP_DISK_RETENTION_MUTEX_HELD: '1' });
      assert.strictEqual(scheduled.code, 0, scheduled.output);
      assert.ok(existsSync(root));
      assert.ok(!existsSync(control), 'the owner-held route must finish without taking the mutex twice');
      rmSync(root, { recursive: true });
      const empty = await run({});
      assert.strictEqual(empty.code, 0, 'an empty launch has no mutation to lock: ' + empty.output);
    });
  } finally {
    for (const [index, key] of ['PAPERCUSP_FS_MUTEX_LOCK_DIR', 'PAPERCUSP_DISABLE_FS_MUTEX'].entries()) {
      if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];
    }
  }
});

test('private slot eviction removes the oldest root first and reports a finite cap', () => {
  const newer = makePrivateRoot('pid99999999', { ageSec: 7200 });
  const older = makePrivateRoot('pid99999998', { ageSec: 10800 });
  const script = join(__dirname, '..', 'bin', 'reap-private-target-slots.sh');
  const output = execFileSync('bash', ['-c', 'exec bash "$1" 2>&1', 'reap', script], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: '1' })), encoding: 'utf8',
  });
  const removed = auditLines().filter(line => line.includes('decision=reap'));
  assert.ok(removed[0].includes(`path=${older}\t`), removed.join('\n'));
  assert.ok(removed[1].includes(`path=${newer}\t`), removed.join('\n'));
  const cap = JSON.parse(output.split('\n').find(line => line.startsWith('private-slot-cap ')).slice(17));
  assert.strictEqual(cap.maxBytes, 1);
  assert.ok(cap.beforeBytes > 1);
  assert.strictEqual(cap.afterBytes, 0);
  assert.strictEqual(cap.overByBytes, 0);
});

test('private slot cap reports leased overage and dry-run leaves roots intact', () => {
  const pinned = makePrivateRoot('pid99999999');
  const ordinary = makePrivateRoot('pid99999998');
  const retention = writeRetentionLease('agent-pin-fixture', pinned);
  const script = join(__dirname, '..', 'bin', 'reap-private-target-slots.sh');
  const invoke = args => execFileSync('bash', ['-c', 'exec bash "$1" "$2" 2>&1', 'reap', script, ...args], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_RELEASE_RETENTION_ROOT: retention,
      PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: '1' })), encoding: 'utf8',
  });
  const dry = invoke(['--dry-run']);
  assert.ok(existsSync(ordinary));
  assert.ok(existsSync(pinned));
  assert.match(dry, /would reap:/);
  const output = invoke(['']);
  assert.ok(!existsSync(ordinary));
  assert.ok(existsSync(pinned));
  const cap = JSON.parse(output.split('\n').find(line => line.startsWith('private-slot-cap ')).slice(17));
  assert.ok(cap.afterBytes > 1);
  assert.strictEqual(cap.overByBytes, cap.afterBytes - 1);
  assert.ok(cap.pinnedPaths.includes(pinned));
  assert.ok(cap.retainedPaths.includes(pinned));
  assert.strictEqual(cap.pinnedBytes, cap.afterBytes);
  assert.strictEqual(cap.pinnedOverageBytes, cap.overByBytes);
  assert.strictEqual(cap.pinCoverageComplete, true);
});

test('private slot cap distinguishes live-pin allowance from retained recent excess', () => {
  const pinned = makePrivateRoot('pid99999999');
  const recent = makePrivateRoot('pid99999998', { ageSec: 60 });
  writeRetentionLease('agent-pin-fixture', pinned);
  const script = join(__dirname, '..', 'bin', 'reap-private-target-slots.sh');
  let failure;
  try {
    execFileSync('bash', [script], {
      cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: '1' })),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) { failure = error; }
  assert.ok(failure, 'retained non-pin excess must fail cap compliance');
  assert.strictEqual(failure.status, 2);
  const line = failure.stderr.toString().split('\n').find(line => line.startsWith('private-slot-cap '));
  const cap = JSON.parse(line.slice(17));
  assert.ok(cap.pinnedBytes > 1);
  assert.strictEqual(cap.pinnedOverageBytes, cap.pinnedBytes - 1);
  assert.ok(cap.overByBytes > cap.pinnedOverageBytes);
  assert.deepStrictEqual(cap.pinnedPaths, [pinned]);
  assert.ok(existsSync(pinned));
  assert.ok(existsSync(recent), 'cap diagnostics must preserve the grace-period guard');
  assert.deepStrictEqual(auditLines(), []);
});

test('private slot cap does not treat other retention leases as live pins', () => {
  const retained = makePrivateRoot('pid99999999');
  writeRetentionLease('release-window-fixture', retained);
  const script = join(__dirname, '..', 'bin', 'reap-private-target-slots.sh');
  assert.throws(() => execFileSync('bash', [script], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: '1' })),
    stdio: ['ignore', 'pipe', 'pipe'],
  }), error => {
    const line = error.stderr.toString().split('\n').find(line => line.startsWith('private-slot-cap '));
    const cap = JSON.parse(line.slice(17));
    assert.strictEqual(error.status, 2);
    assert.deepStrictEqual(cap.pinnedPaths, []);
    assert.strictEqual(cap.pinnedBytes, 0);
    assert.strictEqual(cap.pinnedOverageBytes, 0);
    assert.ok(cap.overByBytes > 0);
    return true;
  });
  assert.ok(existsSync(retained));
  assert.deepStrictEqual(auditLines(), []);
});

test('private slot cap charges shared allocations to pins first in a dry run', () => {
  const ordinary = makePrivateRoot('pid99999998');
  const pinned = makePrivateRoot('pid99999999');
  writeFileSync(join(pinned, 'shared-allocation'), Buffer.alloc(65536, 7));
  linkSync(join(pinned, 'shared-allocation'), join(ordinary, 'shared-allocation'));
  writeRetentionLease('agent-pin-fixture', pinned);
  const output = execFileSync('bash', ['-c', 'exec bash "$1" --dry-run 2>&1', 'reap',
    join(__dirname, '..', 'bin', 'reap-private-target-slots.sh')], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: '1' })), encoding: 'utf8',
  });
  const cap = JSON.parse(output.split('\n').find(line => line.startsWith('private-slot-cap ')).slice(17));
  assert.ok(cap.pinnedBytes >= 65536, 'the live pin must own its shared blocks');
  assert.ok(cap.afterBytes - cap.pinnedBytes < 65536, 'the other root must not charge those blocks again');
  assert.strictEqual(cap.pinnedOverageBytes, cap.pinnedBytes - 1);
  assert.ok(existsSync(ordinary));
  assert.ok(existsSync(pinned));
});

test('a pin on one Cargo file does not exempt its whole retained root', () => {
  const root = makePrivateRoot('pid99999999');
  const file = join(root, 'debug', 'marker');
  writeFileSync(join(root, 'unpinned-allocation'), Buffer.alloc(65536, 9));
  writeRetentionLease('agent-pin-child', file);
  const script = join(__dirname, '..', 'bin', 'reap-private-target-slots.sh');
  assert.throws(() => execFileSync('bash', [script], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: '1' })),
    stdio: ['ignore', 'pipe', 'pipe'],
  }), error => {
    const cap = JSON.parse(error.stderr.toString().split('\n').find(line => line.startsWith('private-slot-cap ')).slice(17));
    assert.strictEqual(error.status, 2);
    assert.strictEqual(cap.pinnedBytes, statSync(file).blocks * 512);
    assert.ok(cap.afterBytes > cap.pinnedBytes);
    assert.ok(cap.overByBytes > cap.pinnedOverageBytes);
    return true;
  });
  assert.ok(existsSync(root));
  assert.deepStrictEqual(auditLines(), []);
});

test('an unreadable Cargo pin keeps cap coverage unknown and the root intact', () => {
  const root = makePrivateRoot('pid99999999');
  const retention = writeRetentionLease('agent-pin-invalid', root);
  writeFileSync(join(retention, 'lease-agent-pin-invalid.tsv'), 'malformed\n');
  const script = join(__dirname, '..', 'bin', 'reap-private-target-slots.sh');
  assert.throws(() => execFileSync('bash', [script], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: '1' })),
    stdio: ['ignore', 'pipe', 'pipe'],
  }), error => {
    const cap = JSON.parse(error.stderr.toString().split('\n').find(line => line.startsWith('private-slot-cap ')).slice(17));
    assert.strictEqual(error.status, 2);
    assert.strictEqual(cap.pinCoverageComplete, false);
    assert.strictEqual(cap.pinnedBytes, null);
    assert.strictEqual(cap.pinnedOverageBytes, null);
    return true;
  });
  assert.ok(existsSync(root));
  assert.deepStrictEqual(auditLines(), []);
});

test('a pin-shaped Cargo marker without pin metadata cannot grant a cap allowance', () => {
  const root = makePrivateRoot('pid99999999');
  const retention = writeRetentionLease('agent-pin-invalid', root);
  const marker = join(retention, 'lease-agent-pin-invalid.tsv');
  writeFileSync(marker, readFileSync(marker, 'utf8').replace(/^tag=.*$/m, 'tag=release-window-fixture'));
  assert.throws(() => execFileSync('bash', [join(__dirname, '..', 'bin', 'reap-private-target-slots.sh')], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: '1' })),
    stdio: ['ignore', 'pipe', 'pipe'],
  }), error => {
    const cap = JSON.parse(error.stderr.toString().split('\n').find(line => line.startsWith('private-slot-cap ')).slice(17));
    assert.strictEqual(error.status, 2);
    assert.strictEqual(cap.pinCoverageComplete, false);
    assert.strictEqual(cap.pinnedBytes, null);
    return true;
  });
  assert.ok(existsSync(root));
  assert.deepStrictEqual(auditLines(), []);
});

test('an expired Cargo pin releases its root and supplies no cap allowance', () => {
  const root = makePrivateRoot('pid99999999');
  const retention = writeRetentionLease('agent-pin-expired', root);
  const marker = join(retention, 'lease-agent-pin-expired.tsv');
  writeFileSync(marker, readFileSync(marker, 'utf8').replace(/^expires_ns=.*$/m, 'expires_ns=1'));
  const output = execFileSync('bash', ['-c', 'exec bash "$1" 2>&1', 'reap',
    join(__dirname, '..', 'bin', 'reap-private-target-slots.sh')], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: '1' })), encoding: 'utf8',
  });
  const cap = JSON.parse(output.split('\n').find(line => line.startsWith('private-slot-cap ')).slice(17));
  assert.strictEqual(cap.pinnedBytes, 0);
  assert.strictEqual(cap.overByBytes, 0);
  assert.strictEqual(cap.pinCoverageComplete, true);
  assert.ok(!existsSync(root));
});

test('an invalid private slot cap refuses before deleting any root', () => {
  const dead = makePrivateRoot('pid99999999');
  const script = join(__dirname, '..', 'bin', 'reap-private-target-slots.sh');
  assert.throws(() => execFileSync('bash', [script], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PAPERCUSP_DESKTOP_PRIVATE_SLOT_MAX_BYTES: 'invalid' })),
    stdio: ['ignore', 'pipe', 'pipe'],
  }), error => error.status === 2);
  assert.ok(existsSync(dead));
  assert.deepStrictEqual(auditLines(), []);
});

test('a failed private slot measurement refuses deletion instead of reporting zero', () => {
  const dead = makePrivateRoot('pid99999999');
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'du'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const script = join(__dirname, '..', 'bin', 'reap-private-target-slots.sh');
  assert.throws(() => execFileSync('bash', [script], {
    cwd: home, env: isolatedEnv(reapEnv({ ROOT: home, PATH: `${bin}:${process.env.PATH}` })),
    stdio: ['ignore', 'pipe', 'pipe'],
  }), error => error.status === 2 && /measurement failed/.test(error.stderr.toString()));
  assert.ok(existsSync(dead));
  assert.deepStrictEqual(auditLines(), []);
});

test('a dead private overflow root is reaped by the next claim, and the deletion is audited', () => {
  const dead = makePrivateRoot('pid99999999');
  assert.strictEqual(claim(reapEnv()), join(home, '.cargo-target'));
  assert.ok(!existsSync(dead), 'the dead private root must be deleted');
  assert.deepStrictEqual(readdirSync(home).filter((n) => n.includes('reaping')), [],
    'a synchronous reap must not leave a renamed-aside root behind');
  const lines = auditLines();
  assert.ok(lines.some((l) => l.includes('decision=reap') && l.includes(`path=${dead}\t`)), lines.join('\n'));
  assert.ok(lines.some((l) => l.includes('decision=allow') && l.includes('reaping-pid99999999')), lines.join('\n'));
});

test('private reaping respects the canonical root lock across slot namespaces', async () => {
  const root = makePrivateRoot('pid99999994');
  const child = spawn('bash', ['-c', `set -euo pipefail
    PAPERCUSP_DESKTOP_REAP_ONLY=1 . "${HELPER}"
    __pc_lock_target_root "$1"
    echo READY
    exec sleep 30`, 'root-holder', root], {
    cwd: home, env: isolatedEnv(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('exit', (code) => reject(new Error(`root holder exited ${code}`)));
    });
    claim(reapEnv());
    assert.ok(existsSync(root), 'a canonical root claimant protects the root even without this namespace slot lock');
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  claim(reapEnv());
  assert.ok(!existsSync(root), 'negative control: after the claimant exits, the old private root is reclaimable');
});

test('live, recent, leased and referenced private roots are all kept', async () => {
  const live = makePrivateRoot(`pid${process.pid}`);
  const recent = makePrivateRoot('pid99999998', { ageSec: 60 });
  const leased = makePrivateRoot('pid99999997');
  const referenced = makePrivateRoot('pid99999996');
  const control = makePrivateRoot('pid99999995');
  mkdirSync(join(home, 'retention'));
  writeFileSync(join(home, 'retention', 'lease-desktop-test.tsv'),
    `schema=papercusp-release-retention/v1\ntag=desktop-test\ncreated_ns=1\nexpires_ns=0\npath=${join(leased, 'debug')}\n`);
  const user = spawn('sleep', ['30'], { env: { ...process.env, CARGO_TARGET_DIR: referenced }, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 100));
    claim(reapEnv());
    assert.ok(!existsSync(control), 'positive control: an ordinary dead root must be reaped in the same run');
    assert.ok(existsSync(live), 'a root whose claiming pid is alive must be kept');
    assert.ok(existsSync(recent), 'a root idle for less than the grace period must be kept');
    assert.ok(existsSync(leased), 'a root covered by a release-retention lease must be kept');
    assert.ok(existsSync(referenced), 'a root a live process builds into must be kept');
  } finally {
    user.kill();
  }
});

test('overflow reuses the newest dead private root as a warm cache instead of a cold build', async () => {
  const held = await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' });
  try {
    const older = makePrivateRoot('pid99999990', { ageSec: 10000, marker: 'older' });
    const newer = makePrivateRoot('pid99999991', { ageSec: 4000, marker: 'newer' });
    const overflow = claim(reapEnv({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' }));
    assert.notStrictEqual(overflow, held.dir);
    assert.strictEqual(readFileSync(join(overflow, 'debug', 'marker'), 'utf8'), 'newer',
      'the overflow claim must adopt the most recently active dead root');
    // WI-10004841: adoption is IN PLACE. A Cargo root is not relocatable, so the
    // adopted root keeps its own path; renaming it stranded tauri's OUT_DIR paths.
    assert.strictEqual(overflow, newer, 'the adopted root must keep its own path, never be renamed');
    assert.ok(!existsSync(older), 'the remaining dead root is reaped');
    assert.ok(auditLines().some((l) => l.includes('decision=adopt') && l.includes(`path=${newer}\t`)));
  } finally {
    held.child.kill();
  }
});

test('a private root stays claimed while its holder lives and is reclaimed once it exits', async () => {
  const shared = await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' });
  // The holder drops CARGO_TARGET_DIR from its own environment, as a launcher shell
  // between cargo invocations does, so the claim lock is the ONLY thing that can
  // show the root is in use — the reference probe cannot see this holder.
  const priv = await holdSlotViaExec(reapEnv({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' }),
    { execCommand: 'env -u CARGO_TARGET_DIR sleep 30' });
  try {
    assert.match(priv.dir, /\.cargo-target-pid\d+$/);
    assert.ok(existsSync(join(home, '.papercusp', 'desktop-dev-slots', `${priv.dir.split('-').pop()}.lock`)),
      'a private claim must take a lock the reaper can test');
    ageRoot(priv.dir, 7200);
    const other = claim(reapEnv({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' }));
    assert.notStrictEqual(other, priv.dir, 'a held private root must never be adopted');
    assert.ok(existsSync(priv.dir), 'a held private root must never be reaped');

    priv.child.kill();
    await new Promise((r) => priv.child.once('exit', r));
    const next = claim(reapEnv({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' }));
    // Reclaimed = adopted in place as the next overflow claim's warm cache (WI-10004841).
    assert.strictEqual(next, priv.dir, 'once its holder exits, the idle private root is reclaimed by the next overflow claim');
    assert.ok(existsSync(next));
  } finally {
    shared.child.kill();
    priv.child.kill();
  }
});

// WI-10004841 — adoption used to RENAME the dead root (`mv -T`) to the claimant's
// name. Cargo kept the tauri crate's finished build-script output across the move,
// and that output lists every permission .toml by ABSOLUTE path into the OLD root,
// so the next `tauri dev` died in tauri_build: "failed to read plugin permissions …
// No such file or directory". This fixture is the real shape: `root-output` records
// the OUT_DIR the script ran against; `tauri-core-*-permission-files` is the listing.
function writeTauriBuildOutput(dir, recordedRoot) {
  const rel = join('debug', 'build', 'tauri-70ec3dd833253023');
  const out = join(dir, rel, 'out');
  const toml = join('permissions', 'app', 'autogenerated', 'commands', 'app_hide.toml');
  mkdirSync(join(out, 'permissions', 'app', 'autogenerated', 'commands'), { recursive: true });
  writeFileSync(join(out, toml), '');
  writeFileSync(join(dir, rel, 'root-output'), join(recordedRoot, rel, 'out'));
  writeFileSync(join(out, 'tauri-core-app-permission-files'), JSON.stringify([join(recordedRoot, rel, 'out', toml)]));
  return join(out, 'tauri-core-app-permission-files');
}

test('adoption keeps build-script absolute paths valid; a relocated root is reaped, never adopted', async () => {
  const held = await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' });
  try {
    const intact = makePrivateRoot('pid99999987', { ageSec: 4000, marker: 'intact' });
    const listing = writeTauriBuildOutput(intact, intact);
    // Newer than `intact`, so an adopter that ignores relocation picks it first.
    const relocated = makePrivateRoot('pid99999986', { ageSec: 3000, marker: 'relocated' });
    writeTauriBuildOutput(relocated, join(home, '.cargo-target-pid99999900'));
    ageRoot(intact, 4000);
    ageRoot(relocated, 3000);

    const overflow = claim(reapEnv({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' }));
    assert.strictEqual(overflow, intact, 'the newest root whose build outputs are anchored in it is adopted, in place');
    for (const p of JSON.parse(readFileSync(listing, 'utf8'))) {
      assert.ok(existsSync(p), `tauri_build would fail: the adopted root's permission listing names a missing file ${p}`);
    }
    assert.ok(!existsSync(relocated), 'a root whose root-output points outside it was moved, so it is reaped');
    assert.ok(auditLines().some((l) => l.includes('decision=adopt') && l.includes(`path=${intact}\t`)), auditLines().join('\n'));
  } finally {
    held.child.kill();
  }
});

test('an adopted root stays claimed by the launch that adopted it', async () => {
  const shared = await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' });
  const dead = makePrivateRoot('pid99999985', { ageSec: 4000 });
  // CARGO_TARGET_DIR is dropped after the claim, so only the adopted root's lock,
  // carried on the inherited fd 8, can show the root is in use.
  const priv = await holdSlotViaExec(reapEnv({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' }),
    { execCommand: 'env -u CARGO_TARGET_DIR sleep 30' });
  try {
    assert.strictEqual(priv.dir, dead, 'the overflow launch adopts the dead root in place');
    assert.ok(existsSync(join(home, '.papercusp', 'desktop-dev-slots', 'pid99999985.lock')));
    ageRoot(dead, 7200);
    const other = claim(reapEnv({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '1' }));
    assert.notStrictEqual(other, dead, 'a root adopted by a live launch must never be adopted again');
    assert.ok(existsSync(dead), 'a root adopted by a live launch must never be reaped');
  } finally {
    shared.child.kill();
    priv.child.kill();
  }
});

test('the background deleter never holds the launch\'s slot lock', async () => {
  // A launch execs into its build holding the slot lock on fd 8. A deleter that
  // inherited it would keep slot 0 "busy" for as long as a 60 GiB rm runs, and the
  // next launch would be pushed onto a cold slot. A slow rm makes the window certain.
  const realRm = execFileSync('sh', ['-c', 'command -v rm'], { encoding: 'utf8' }).trim();
  const bin = join(home, 'slow-bin');
  const trace = join(home, 'deleter.trace');
  mkdirSync(bin);
  writeFileSync(join(bin, 'rm'), `#!/bin/sh\ncase "$1" in -rf) printf 'started\\n' >> "$FIXTURE_RM_TRACE"; sleep 3; ${realRm} "$@"; status=$?; printf 'exit=%s\\n' "$status" >> "$FIXTURE_RM_TRACE"; exit "$status" ;; esac\nexec ${realRm} "$@"\n`);
  chmodSync(join(bin, 'rm'), 0o755);
  const dead = makePrivateRoot('pid99999988');
  const env = reapEnv({ PAPERCUSP_DESKTOP_PRIVATE_SLOT_REAP_SYNC: '0', PATH: `${bin}:${process.env.PATH}`, FIXTURE_RM_TRACE: trace });
  assert.strictEqual(claim(env), join(home, '.cargo-target'));
  assert.ok(!existsSync(dead), 'the dead root is renamed aside before the launch continues');
  const deadline = Date.now() + 30_000;
  const readTrace = () => existsSync(trace) ? readFileSync(trace, 'utf8') : 'rm was never entered';
  while (Date.now() < deadline && !readTrace().includes('started')) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.match(readTrace(), /started/, 'the original background deleter reaches its controlled slow rm');
  assert.ok(readdirSync(home).some((n) => n.includes('reaping')), 'the slow deletion must still be running');
  assert.strictEqual(claim(), join(home, '.cargo-target'), 'the background deleter kept slot 0 locked');
  // The slow rm alone is 3s; on a loaded box the detached deleter can take well over
  // 10s to finish, so wait against a wall-clock deadline rather than an iteration count.
  while (Date.now() < deadline && !readTrace().includes('exit=0')) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const deletionTrace = readTrace();
  assert.match(deletionTrace, /exit=0/, 'the original background deletion succeeds');
  assert.deepStrictEqual(readdirSync(home).filter((n) => n.includes('reaping')), [],
    `the background deletion completes; fixture rm trace: ${deletionTrace}`);
});

test('the reap-only entrypoint lists without deleting on --dry-run, then reaps', () => {
  const dead = makePrivateRoot('pid99999989');
  const script = join(__dirname, '..', 'bin', 'reap-private-target-slots.sh');
  const env = isolatedEnv(reapEnv({ ROOT: home }));
  const listed = execFileSync(script, ['--dry-run'], { cwd: home, env, encoding: 'utf8' });
  assert.match(listed, new RegExp(`would reap: ${dead.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.ok(existsSync(dead), '--dry-run must not delete');
  execFileSync(script, [], { cwd: home, env, encoding: 'utf8' });
  assert.ok(!existsSync(dead));
  assert.ok(!existsSync(join(home, '.papercusp', 'desktop-dev-slots', 'slot0.lock')),
    'reap-only must not claim a target slot');
});

test('a broken relocated target-dir symlink is healed in place for the same warm slot', async () => {
  const held = await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' });
  try {
    assert.strictEqual(held.dir, join(home, '.cargo-target'));
    const broken = join(home, '.cargo-target-dev2');
    const relocationParent = join(home, 'relocated-builds');
    const missingTarget = join(relocationParent, 'cargo-target-dev2');
    mkdirSync(relocationParent);
    symlinkSync(missingTarget, broken);

    assert.strictEqual(
      claim({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' }),
      broken,
    );
    assert.ok(lstatSync(broken).isSymbolicLink(), 'the allocator must preserve the relocation symlink');
    assert.strictEqual(readlinkSync(broken), missingTarget, 'the allocator must preserve its target');
    assert.ok(lstatSync(missingTarget).isDirectory(), 'the allocator must restore the missing referent directory');
  } finally {
    held.child.kill();
  }
});

test('a broken target-dir symlink with a missing relocation parent stays preserved and skipped', async () => {
  const held = await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' });
  try {
    assert.strictEqual(held.dir, join(home, '.cargo-target'));
    const broken = join(home, '.cargo-target-dev2');
    const missingTarget = join(home, 'missing-relocation-parent', 'cargo-target-dev2');
    symlinkSync(missingTarget, broken);

    assert.strictEqual(
      claim({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' }),
      join(home, '.cargo-target-dev3'),
    );
    assert.ok(lstatSync(broken).isSymbolicLink(), 'the allocator must preserve an unsafe symlink');
    assert.strictEqual(readlinkSync(broken), missingTarget, 'the allocator must preserve its target');
    assert.ok(!existsSync(missingTarget), 'the allocator must not manufacture a missing relocation hierarchy');
  } finally {
    held.child.kill();
  }
});

test('artifact collection restores only a missing relocation referent and preserves the symlink', () => {
  const relocationParent = join(home, 'relocated-builds');
  const referent = join(relocationParent, 'desktop-target');
  const link = join(home, 'source-target');
  mkdirSync(relocationParent);
  symlinkSync(referent, link);

  prepareCollectionTarget(link);

  assert.ok(lstatSync(link).isSymbolicLink(), 'collection recovery must preserve the relocation symlink');
  assert.strictEqual(readlinkSync(link), referent);
  assert.ok(lstatSync(referent).isDirectory(), 'collection recovery must recreate the missing referent');
});

test('artifact collection fails closed when the relocation parent is also missing', () => {
  const referent = join(home, 'missing-parent', 'desktop-target');
  const link = join(home, 'source-target');
  symlinkSync(referent, link);

  assert.throws(
    () => prepareCollectionTarget(link),
    /refusing to manufacture the relocation hierarchy/,
  );
  assert.ok(lstatSync(link).isSymbolicLink(), 'fail-closed recovery must preserve the symlink');
  assert.ok(!existsSync(referent), 'fail-closed recovery must not create an untrusted parent hierarchy');
});

test('Linux artifact collection invokes relocation recovery before creating bundle children', () => {
  const prepareAt = BUILD_LINUX.indexOf('papercusp_prepare_collection_target_root "$ROOT/src-tauri/target"');
  const mkdirAt = BUILD_LINUX.indexOf('mkdir -p "$DEST_BUNDLE/deb" "$DEST_BUNDLE/appimage"');
  assert.ok(prepareAt >= 0, 'build-linux-local must prepare its canonical collection target');
  assert.ok(prepareAt < mkdirAt, 'collection target recovery must precede mkdir through the symlink');
});

test('direct AppImage entrypoint claims a target slot before Cargo target discovery', () => {
  const claimAt = BUILD_APPIMAGE.indexOf('. "$ORCHESTRATOR_HERE/lib/claim-target-dir.sh"');
  const metadataAt = BUILD_APPIMAGE.indexOf('papercusp_cargo_target_root "$DESK/src-tauri"');
  assert.ok(claimAt >= 0, 'build-appimage must source claim-target-dir.sh');
  assert.ok(metadataAt >= 0, 'build-appimage must resolve its Cargo target root');
  assert.ok(claimAt < metadataAt, 'target-dir claim must precede Cargo metadata in the direct entrypoint');
});

test('a non-directory target-slot occupant is preserved and skipped', async () => {
  const held = await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' });
  try {
    assert.strictEqual(held.dir, join(home, '.cargo-target'));
    const occupied = join(home, '.cargo-target-dev2');
    writeFileSync(occupied, 'belongs to somebody else');

    assert.strictEqual(
      claim({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' }),
      join(home, '.cargo-target-dev3'),
    );
    assert.strictEqual(require('node:fs').readFileSync(occupied, 'utf8'), 'belongs to somebody else');
  } finally {
    held.child.kill();
  }
});

test('an explicitly preset CARGO_TARGET_DIR is honoured, not overridden', () => {
  // A .deb cut or a test harness deliberately picks its own isolated dir.
  const chosen = join(home, 'deliberate-choice');
  assert.strictEqual(claim({ CARGO_TARGET_DIR: chosen }), chosen);
});

test('lock files live outside the target dirs they guard', async () => {
  // A `cargo clean` (or an agent reclaiming disk) wipes a target dir. If the lock
  // lived inside it, it would vanish under a live holder and a second instance
  // would claim a slot that is still in use.
  const held = await holdSlotViaExec();
  try {
    assert.ok(existsSync(join(home, '.papercusp', 'desktop-dev-slots', 'slot0.lock')));
    assert.ok(!existsSync(join(held.dir, 'slot0.lock')));
  } finally {
    held.child.kill();
  }
});

// WI-6554700010011501: first-free handed a launch a COLD slot while a WARM one
// sat free, so the native-dev admission priced the cold budget (65 GiB) and a
// nearly-full data disk refused every verifier.
test('a free warm slot is claimed before a free cold slot', () => {
  mkdirSync(join(home, '.cargo-target-dev3', 'debug', 'deps'), { recursive: true });
  assert.strictEqual(claim(), join(home, '.cargo-target-dev3'));
});

test('a warm fallback root counts as warm only when the preferred sibling cannot be created', () => {
  const relocationParent = join(home, 'root-owned-warm');
  const relocated = join(relocationParent, 'cargo-target');
  const fallbackWarm = join(relocated, '.papercusp-target-slots', 'dev3');
  mkdirSync(join(fallbackWarm, 'debug', 'deps'), { recursive: true });
  configureTarget(relocated);
  chmodSync(relocationParent, 0o555);
  try {
    assert.strictEqual(claim(), fallbackWarm);
  } finally {
    chmodSync(relocationParent, 0o700);
  }
});

test('a creatable preferred sibling is cold even when a stale fallback root is warm', () => {
  mkdirSync(join(home, '.cargo-target', '.papercusp-target-slots', 'dev2', 'debug', 'deps'), { recursive: true });
  // The claim would create ~/.cargo-target-dev2 (cold), so slot 0 keeps first place.
  assert.strictEqual(claim(), join(home, '.cargo-target'));
});

test('index order still decides among warm slots, so a warm shared dir keeps slot 0', () => {
  mkdirSync(join(home, '.cargo-target', 'debug', 'deps'), { recursive: true });
  mkdirSync(join(home, '.cargo-target-dev3', 'debug', 'deps'), { recursive: true });
  assert.strictEqual(claim(), join(home, '.cargo-target'));
});

test('a held warm slot falls back to the next warm slot before any cold one', async () => {
  mkdirSync(join(home, '.cargo-target', 'debug', 'deps'), { recursive: true });
  mkdirSync(join(home, '.cargo-target-dev4', 'debug', 'deps'), { recursive: true });
  const held = await holdSlotViaExec();
  try {
    assert.strictEqual(held.dir, join(home, '.cargo-target'));
    assert.strictEqual(claim(), join(home, '.cargo-target-dev4'));
  } finally {
    held.child.kill();
  }
});

test('disabling slots is possible but says loudly what it costs', () => {
  const out = execFileSync(
    'bash',
    ['-c', `. "${HELPER}" 2>&1 >/dev/null; printf '%s' "\${CARGO_TARGET_DIR:-unset}"`],
    {
      env: { ...process.env, HOME: home, CARGO_TARGET_DIR: '', PAPERCUSP_DESKTOP_TARGET_SLOTS: '0' },
      encoding: 'utf8',
    },
  );
  // Legacy behaviour: no claim at all, cargo falls back to its configured dir.
  assert.ok(out.includes('unset') || out === 'unset', `expected no claim when disabled, got ${out}`);
});
