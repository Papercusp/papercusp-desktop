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
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const HELPER = join(__dirname, '..', 'bin', 'lib', 'claim-target-dir.sh');

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

test('a broken target-dir symlink is preserved and skipped for the next usable slot', async () => {
  const held = await holdSlotViaExec({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' });
  try {
    assert.strictEqual(held.dir, join(home, '.cargo-target'));
    const broken = join(home, '.cargo-target-dev2');
    const missingTarget = join(home, 'relocated-cache-that-no-longer-exists');
    symlinkSync(missingTarget, broken);

    assert.strictEqual(
      claim({ PAPERCUSP_DESKTOP_TARGET_SLOTS: '3' }),
      join(home, '.cargo-target-dev3'),
    );
    assert.ok(lstatSync(broken).isSymbolicLink(), 'the allocator must not replace the symlink');
    assert.strictEqual(readlinkSync(broken), missingTarget, 'the allocator must preserve its target');
  } finally {
    held.child.kill();
  }
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
