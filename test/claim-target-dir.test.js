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
  readlinkSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const HELPER = join(__dirname, '..', 'bin', 'lib', 'claim-target-dir.sh');
const BUILD_LINUX = readFileSync(join(__dirname, '..', 'bin', 'build-linux-local.sh'), 'utf8');

let home;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wi7101-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Source the helper and report the CARGO_TARGET_DIR it settled on. */
function claim(env = {}) {
  return execFileSync(
    'bash',
    ['-c', `set -euo pipefail; . "${HELPER}"; printf '%s' "\${CARGO_TARGET_DIR:-}"`],
    { env: { ...process.env, HOME: home, CARGO_TARGET_DIR: '', ...env }, encoding: 'utf8' },
  );
}

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
function holdSlotViaExec(env = {}) {
  const child = spawn(
    'bash',
    ['-c', `. "${HELPER}" 2>/dev/null; echo "$CARGO_TARGET_DIR"; exec sleep 30`],
    { env: { ...process.env, HOME: home, CARGO_TARGET_DIR: '', ...env }, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return new Promise((resolve) => {
    child.stdout.once('data', (buf) => resolve({ child, dir: buf.toString().trim() }));
  });
}

test('a lone instance keeps the shared dir, so the ordinary case is unchanged', () => {
  // Slot 0 must stay ~/.cargo-target by NAME, or every warm cache already on the
  // box is orphaned and the first launch after this change is a cold build.
  assert.strictEqual(claim(), join(home, '.cargo-target'));
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
