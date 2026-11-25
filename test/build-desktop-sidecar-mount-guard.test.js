// Recurrence guard for WI-6554700010070220: build-desktop-sidecar.sh must never
// rename or recursively delete a sidecar output tree that contains a mount.
//
// WHY THIS TEST EXISTS
// The WI-6417 disk offload bind-mounted the canonical src-tauri/sidecar/node_modules.
// The publish swap (`mv sidecar sidecar.old.<pid>`) carried that mount along, and the
// plain `rm -rf "$OLD_DIR"` that discards the prior tree emptied the bind SOURCE before
// dying EBUSY on the mountpoint. That was the live-federation gate build leg's failure,
// and every retry deleted more of the offloaded data. GNU `rm --one-file-system` does
// not help on its own: a same-device bind mount has the same st_dev, so the mountinfo
// check in the helpers is the real guard.
//
// The behavioural cases run the REAL helper functions, extracted from the script,
// against real bind mounts made in a private mount namespace (nothing leaks to the
// host). They need `sudo -n` or an unprivileged user namespace; with neither they skip
// with the reason, and the static pins still run everywhere.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');

/** The script with whole-line comments removed, so prose about `rm -rf` cannot satisfy or trip a pin. */
const code = builder
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

function fnBody(name) {
  const re = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}$`, 'm');
  const match = builder.match(re);
  assert.ok(match, `${name}() must remain a top-level function in build-desktop-sidecar.sh`);
  return match[0];
}

function helpersBlock() {
  const start = builder.indexOf('__pc_mounts_under() {');
  const end = builder.indexOf('# Fail fast, before any build or publish mutation', start);
  assert.ok(start >= 0 && end > start, 'the mount-guard helpers must stay one block ending at the preflight comment');
  return builder.slice(start, end);
}

test('the preflight refuses a mounted output before any sweep or staging delete', () => {
  const preflight = code.indexOf('__pc_refuse_mounts_under "$SIDECAR_FINAL_DIR" "preflight" || exit 1');
  assert.ok(preflight >= 0, 'the top-level mount preflight must exist');
  const sweep = code.indexOf('\n__pc_sweep_stale_staging\n');
  const stagingReset = code.indexOf('\nrm -rf "$SIDECAR_DIR"\n');
  assert.ok(sweep > preflight, 'the preflight must run before the stale-staging sweep');
  assert.ok(stagingReset > preflight, 'the preflight must run before the staging tree is reset');
  assert.ok(code.indexOf('SIDECAR_FINAL_DIR="$SIDECAR_DIR"') < preflight, 'the preflight must check the resolved final output');
});

test('the publish swap re-checks for a mount immediately before the rename', () => {
  assert.match(
    code,
    /__pc_refuse_mounts_under "\$SIDECAR_FINAL_DIR" "publish swap" \|\| exit 1\n\s*mv "\$SIDECAR_FINAL_DIR" "\$OLD_DIR"/,
    'the swap rename must be guarded by the mount re-check on the line before it',
  );
});

test('no code path discards a sidecar tree with a plain recursive delete that can cross a mount', () => {
  assert.doesNotMatch(code, /rm -rf[^\n]*OLD_DIR/, 'OLD_DIR must only be deleted through __pc_rm_tree_no_cross');
  assert.match(code, /__pc_rm_tree_no_cross "\$OLD_DIR" \|\| \{/, 'the success epilogue must use the no-cross delete');
  const sweep = fnBody('__pc_sweep_stale_staging');
  assert.doesNotMatch(sweep, /rm -rf "\$d"/, 'the stale-staging sweep must not plain-rm-rf sidecar.old.<pid> dirs');
  assert.match(sweep, /__pc_mounts_under "\$d"/, 'the sweep must keep a stale dir that still carries a mount');
  assert.match(sweep, /__pc_rm_tree_no_cross "\$d"/);
  assert.match(fnBody('__pc_rm_tree_no_cross'), /--one-file-system[\s\S]*rm -rfx/, 'GNU and BSD no-crossing flags stay as defence in depth');
});

/** How to get a private mount namespace here, or why we cannot. */
function namespaceRunner() {
  const probe = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 }).status === 0;
  if (probe('sudo', ['-n', 'unshare', '-m', '--propagation', 'private', 'true'])) {
    return { cmd: 'sudo', prefix: ['-n', 'unshare', '-m', '--propagation', 'private'] };
  }
  if (probe('unshare', ['-rm', '--propagation', 'private', 'true'])) {
    return { cmd: 'unshare', prefix: ['-rm', '--propagation', 'private'] };
  }
  return { skip: 'needs `sudo -n` or an unprivileged user namespace to make a real bind mount' };
}

const HARNESS = String.raw`
set -u
T="$(cd "$1" && pwd -P)" || exit 1   # mountinfo paths are canonical
source "$2"
OWNER="$3"   # the test's uid:gid; inside a function $3 would be the function's own argument
cleanup() { chown -R "$OWNER" "$T" 2>/dev/null; }
trap cleanup EXIT
SRC="$T/src"; mkdir -p "$SRC" "$T/m"; echo keep > "$SRC/keep.txt"
mkdir -p "$T/m/sidecar/node_modules" "$T/m/plain/sub" "$T/m/ctl/node_modules" "$T/m/sp ace/mnt"
echo out > "$T/m/sidecar/out.txt"; echo x > "$T/m/plain/sub/x.txt"
mount --bind "$SRC" "$T/m/sidecar/node_modules" || { echo mount_failed=1; exit 0; }
echo "detect=$(__pc_mounts_under "$T/m/sidecar" | sed "s#^$T/m/##")"
echo "detect_plain=$(__pc_mounts_under "$T/m/plain" | wc -l)"
__pc_refuse_mounts_under "$T/m/sidecar" "unit" 2>"$T/refuse.err"; echo "refuse_rc=$?"
grep -q '^FATAL: unit: ' "$T/refuse.err" && echo refuse_msg=1
__pc_rm_tree_no_cross "$T/m/sidecar" 2>/dev/null; echo "rm_mounted_rc=$?"
[[ -f "$SRC/keep.txt" && -f "$T/m/sidecar/out.txt" ]] && echo mounted_intact=1
mv "$T/m/sidecar" "$T/m/sidecar.old.123"
echo "detect_after_rename=$(__pc_mounts_under "$T/m/sidecar.old.123" | wc -l)"
__pc_rm_tree_no_cross "$T/m/sidecar.old.123" 2>/dev/null; echo "rm_renamed_rc=$?"
[[ -f "$SRC/keep.txt" ]] && echo renamed_src_intact=1
__pc_rm_tree_no_cross "$T/m/plain"; echo "rm_plain_rc=$?"; [[ -e "$T/m/plain" ]] || echo plain_removed=1
__pc_rm_tree_no_cross "$T/m/missing"; echo "rm_missing_rc=$?"
mount --bind "$SRC" "$T/m/sp ace/mnt" && echo "detect_space=$(__pc_mounts_under "$T/m/sp ace" | wc -l)"
umount "$T/m/sp ace/mnt"
# The stale-staging sweep keeps a dead run's old dir that still carries a mount.
SIDECAR_FINAL_DIR="$T/m/out/sidecar"; SIDECAR_TMP_DIR="$SIDECAR_FINAL_DIR.tmp.$$"
mkdir -p "$SIDECAR_FINAL_DIR.old.2147483646/node_modules" "$SIDECAR_FINAL_DIR.old.2147483645/x"
mount --bind "$SRC" "$SIDECAR_FINAL_DIR.old.2147483646/node_modules"
__pc_sweep_stale_staging >/dev/null 2>"$T/sweep.err"; echo "sweep_rc=$?"
[[ -d "$SIDECAR_FINAL_DIR.old.2147483646" && -f "$SRC/keep.txt" ]] && echo sweep_kept_mounted=1
[[ -e "$SIDECAR_FINAL_DIR.old.2147483645" ]] || echo sweep_reaped_plain=1
grep -q 'WARN kept sidecar.old.2147483646' "$T/sweep.err" && echo sweep_warned=1
umount "$SIDECAR_FINAL_DIR.old.2147483646/node_modules"
umount "$T/m/sidecar.old.123/node_modules"
__pc_rm_tree_no_cross "$T/m/sidecar.old.123"; echo "rm_after_umount_rc=$?"
[[ -e "$T/m/sidecar.old.123" ]] || echo renamed_removed=1
# Positive control: the plain rm -rf this guard replaced really empties the bind source.
echo keep2 > "$SRC/keep2.txt"; mount --bind "$SRC" "$T/m/ctl/node_modules"
rm -rf "$T/m/ctl" 2>/dev/null; echo "control_rm_rc=$?"
[[ -e "$SRC/keep.txt" ]] || echo control_emptied_source=1
`;

test('real bind mounts: detected, refused untouched, kept by the sweep, deleted only after unmount', (t) => {
  const runner = namespaceRunner();
  if (runner.skip) {
    t.skip(runner.skip);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-mount-guard-'));
  try {
    const helpers = path.join(tmp, 'helpers.sh');
    fs.writeFileSync(
      helpers,
      [helpersBlock(), fnBody('__pc_pid_is_sidecar_builder'), fnBody('__pc_sweep_stale_staging')].join('\n\n'),
    );
    const harness = path.join(tmp, 'harness.sh');
    fs.writeFileSync(harness, HARNESS);
    const work = path.join(tmp, 'work');
    fs.mkdirSync(work);
    const owner = `${process.getuid()}:${process.getgid()}`;
    const run = spawnSync(runner.cmd, [...runner.prefix, 'bash', harness, work, helpers, owner], {
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(run.status, 0, `harness failed: ${run.stderr}`);
    const out = Object.fromEntries(
      run.stdout
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    if (out.mount_failed) {
      t.skip(`bind mount refused inside the namespace: ${run.stderr.trim()}`);
      return;
    }
    assert.deepEqual(out, {
      detect: 'sidecar/node_modules',
      detect_plain: '0',
      refuse_rc: '2',
      refuse_msg: '1',
      rm_mounted_rc: '2',
      mounted_intact: '1',
      detect_after_rename: '1',
      rm_renamed_rc: '2',
      renamed_src_intact: '1',
      rm_plain_rc: '0',
      plain_removed: '1',
      rm_missing_rc: '0',
      detect_space: '1',
      sweep_rc: '0',
      sweep_kept_mounted: '1',
      sweep_reaped_plain: '1',
      sweep_warned: '1',
      rm_after_umount_rc: '0',
      renamed_removed: '1',
      control_rm_rc: '1',
      control_emptied_source: '1',
    });
    const real = fs.realpathSync(tmp);
    const leaked = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').filter((l) => l.includes(real));
    assert.deepEqual(leaked, [], 'no test mount may leak into the host namespace');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (err) {
      // A root-owned leftover must not mask the real assertion outcome above.
      if (runner.cmd !== 'sudo') throw err;
      spawnSync('sudo', ['-n', 'rm', '-rf', '--one-file-system', '--', tmp]);
    }
  }
});
