// Recurrence guard for WI-6554700010070220: the live-federation gate builds and reads
// the sidecar in a run-private output tree, never in the shared canonical one.
//
// WHY THIS TEST EXISTS
// The gate's rebuild wrote straight into papercusp-desktop/src-tauri/sidecar, the tree
// attended desktop and package builds also publish to. It shared sidecar.lock with them,
// and the WI-6417 disk offload had bind-mounted that tree's node_modules: the publish
// swap carried the mount along and the old-tree delete emptied the bind source (the
// build leg's EBUSY red). The gate now builds into $WORK/sidecar-out/sidecar
// (PAPERCUSP_SIDECAR_OUT), reads through GATE_SIDECAR_SRC, hands the selected node to
// local-matrix.sh (PCUSP_LOCAL_RIG_SIDECAR_NODE) and deletes the private tree at EXIT
// without crossing a mount.
//
// The static pins run everywhere. The behavioural cases run the REAL
// cleanup_gate_sidecar_out, extracted from the script. The bind-mount case needs
// `sudo -n` or an unprivileged user namespace for a private mount namespace (nothing
// leaks to the host); with neither it skips with the reason.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const gate = fs.readFileSync(path.join(root, 'bin/live-federation-gate.sh'), 'utf8');
const matrix = fs.readFileSync(path.join(root, 'bin/local-matrix.sh'), 'utf8');

/** Lines with whole-line comments removed, so prose cannot satisfy or trip a pin. */
const codeLines = (src) => src.split('\n').filter((line) => !line.trimStart().startsWith('#'));
const gateCode = codeLines(gate).join('\n');

function fnBody(name) {
  const re = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}$`, 'm');
  const match = gate.match(re);
  assert.ok(match, `${name}() must remain a top-level function in live-federation-gate.sh`);
  return match[0];
}

test('the rebuild builds into the run-private output, not the canonical sidecar', () => {
  assert.match(gateCode, /^GATE_SIDECAR_ROOT="\$WORK\/sidecar-out"$/m);
  assert.match(gateCode, /^GATE_SIDECAR_DIR="\$GATE_SIDECAR_ROOT\/sidecar"$/m);
  // New build env sits ABOVE the lock-wait line: build-desktop-sidecar-lock.test.js pins
  // that line's adjacency to the build command.
  assert.match(
    gateCode,
    /PAPERCUSP_SIDECAR_OUT="\$GATE_SIDECAR_DIR" \\\n\s*PAPERCUSP_SIDECAR_LOCK_WAIT_SEC="[^"\n]*" \\\n\s*bash bin\/build-desktop-sidecar\.sh \)/,
    'the gate build must receive PAPERCUSP_SIDECAR_OUT="$GATE_SIDECAR_DIR"',
  );
  const select = gateCode.indexOf('GATE_SIDECAR_SRC="$GATE_SIDECAR_DIR"');
  const build = gateCode.indexOf('bash bin/build-desktop-sidecar.sh )');
  assert.ok(select >= 0 && select < build, 'the rebuild must select its private output before it builds');
});

test('only the GATE_SIDECAR_SRC default names the canonical sidecar; every read goes through it', () => {
  const canonical = codeLines(gate)
    .filter((line) => line.includes('src-tauri/sidecar'))
    .map((line) => line.trim());
  assert.deepEqual(
    canonical,
    ['GATE_SIDECAR_SRC="$DESKTOP_DIR/src-tauri/sidecar"'],
    'read the sidecar through "$GATE_SIDECAR_SRC" so a rebuild run reads the tree it built',
  );
});

test('the from-repo smoke and local-matrix.sh are handed the selected sidecar', () => {
  assert.match(gateCode, /^\s*FROMREPO_SIDECAR_ENV=\(PAPERCUSP_SMOKE_SIDECAR_DIR="\$GATE_SIDECAR_SRC"\)$/m);
  assert.match(
    gateCode,
    /run_smoke from-repo two-instance-hive-from-repo-smoke\.sh "" \\\n\s*"\$\{FROMREPO_SIDECAR_ENV\[@\]\}" \\/,
    'the from-repo smoke must receive FROMREPO_SIDECAR_ENV',
  );
  // A private tree lives under /tmp, so the smoke's hardlink snapshot must sit on the same device.
  assert.match(
    gateCode,
    /FROMREPO_SIDECAR_ENV\+=\(PAPERCUSP_SMOKE_SIDECAR_SNAPSHOT_PARENT="\$GATE_SIDECAR_ROOT\/smoke-snapshots"\)/,
  );
  assert.match(
    gateCode,
    /PCUSP_LOCAL_RIG_SIDECAR_NODE="\$GATE_SIDECAR_SRC\/bin\/node" bash "papercusp-desktop\/bin\/local-matrix\.sh"/,
    'local-matrix.sh must run the node of the sidecar this run selected',
  );
});

test('the EXIT trap deletes the private output after reaping the run sidecars', () => {
  assert.match(gateCode, /^trap '[^'\n]*reap_gate_sidecars; cleanup_gate_sidecar_out;[^'\n]*' EXIT$/m);
});

test('cleanup_gate_sidecar_out checks the path, then mountinfo, then deletes without crossing', () => {
  const body = fnBody('cleanup_gate_sidecar_out');
  const pathCheck = body.indexOf('[ "$real" != "$work_real/sidecar-out" ]');
  const mountCheck = body.indexOf('/proc/self/mountinfo');
  const del = body.indexOf('rm -rf --one-file-system -- "$real"');
  assert.ok(pathCheck >= 0, 'the expected-path check must remain');
  assert.ok(mountCheck > pathCheck, 'the mount check must follow the path check');
  assert.ok(del > mountCheck, 'the delete must follow the mount check');
  assert.equal((body.match(/rm -rf/g) || []).length, 1, 'the guarded delete must be the only recursive delete');
});

test('both local-matrix.sh node sites honour PCUSP_LOCAL_RIG_SIDECAR_NODE', () => {
  const override = '${PCUSP_LOCAL_RIG_SIDECAR_NODE:-$DESKTOP_DIR/src-tauri/sidecar/bin/node}';
  for (const line of codeLines(matrix).filter((l) => l.includes('src-tauri/sidecar'))) {
    assert.ok(line.includes(override), `local-matrix.sh reads the canonical sidecar without the override: ${line.trim()}`);
  }
  const code = codeLines(matrix).join('\n');
  assert.match(code, /^\s*local sidecar_node="\$\{PCUSP_LOCAL_RIG_SIDECAR_NODE:-/m, 'the preflight node site');
  assert.match(code, /^SIDECAR_NODE="\$\{PCUSP_LOCAL_RIG_SIDECAR_NODE:-/m, 'the global node site');
});

function parse(stdout) {
  return Object.fromEntries(
    stdout
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

/** Writes the real function, extracted from the script, for a harness to source. */
function writeCleanupFn(dir) {
  const file = path.join(dir, 'cleanup.sh');
  fs.writeFileSync(file, `${fnBody('cleanup_gate_sidecar_out')}\n`);
  return file;
}

const PLAIN_HARNESS = String.raw`
set -u
T="$(cd "$1" && pwd -P)" || exit 1
source "$2"
log() { printf 'LOG %s\n' "$*" >&2; }
WORK="$T/work"; mkdir -p "$WORK"
GATE_SIDECAR_ROOT="$WORK/sidecar-out"
mkdir -p "$GATE_SIDECAR_ROOT/sidecar/bin" "$GATE_SIDECAR_ROOT/smoke-snapshots/s1"
echo n > "$GATE_SIDECAR_ROOT/sidecar/bin/node"; echo log > "$WORK/build.log"
cleanup_gate_sidecar_out; echo "plain_rc=$?"
[ -e "$GATE_SIDECAR_ROOT" ] || echo plain_removed=1
[ -f "$WORK/build.log" ] && echo logs_kept=1
cleanup_gate_sidecar_out; echo "missing_rc=$?"
GATE_SIDECAR_ROOT=""; cleanup_gate_sidecar_out; echo "unset_rc=$?"
# A root that is not $WORK/sidecar-out is refused untouched.
mkdir -p "$T/other/keep"; echo k > "$T/other/keep/k.txt"
GATE_SIDECAR_ROOT="$T/other"; cleanup_gate_sidecar_out 2>"$T/foreign.err"; echo "foreign_rc=$?"
[ -f "$T/other/keep/k.txt" ] && echo foreign_kept=1
grep -q 'refusing unexpected path' "$T/foreign.err" && echo foreign_logged=1
# A sidecar-out symlink that resolves outside $WORK is refused; its target survives.
ln -s "$T/other" "$WORK/sidecar-out"
GATE_SIDECAR_ROOT="$WORK/sidecar-out"; cleanup_gate_sidecar_out 2>"$T/link.err"; echo "link_rc=$?"
[ -f "$T/other/keep/k.txt" ] && echo link_target_kept=1
grep -q 'refusing unexpected path' "$T/link.err" && echo link_logged=1
`;

test('cleanup_gate_sidecar_out deletes the private tree, keeps the logs and refuses any other path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-sidecar-cleanup-'));
  try {
    const fn = writeCleanupFn(tmp);
    const harness = path.join(tmp, 'harness.sh');
    fs.writeFileSync(harness, PLAIN_HARNESS);
    const work = path.join(tmp, 't');
    fs.mkdirSync(work);
    const run = spawnSync('bash', [harness, work, fn], { encoding: 'utf8', timeout: 60000 });
    assert.equal(run.status, 0, `harness failed: ${run.stderr}`);
    assert.deepEqual(parse(run.stdout), {
      plain_rc: '0',
      plain_removed: '1',
      logs_kept: '1',
      missing_rc: '0',
      unset_rc: '0',
      foreign_rc: '0',
      foreign_kept: '1',
      foreign_logged: '1',
      link_rc: '0',
      link_target_kept: '1',
      link_logged: '1',
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

const MOUNT_HARNESS = String.raw`
set -u
T="$(cd "$1" && pwd -P)" || exit 1   # mountinfo paths are canonical
source "$2"
OWNER="$3"   # the test's uid:gid; inside a function $3 would be the function's own argument
cleanup() { chown -R "$OWNER" "$T" 2>/dev/null; }
trap cleanup EXIT
log() { printf 'LOG %s\n' "$*" >&2; }
SRC="$T/src"; mkdir -p "$SRC"; echo keep > "$SRC/keep.txt"
# Prints one "<label>_<key>=<value>" line; $label is run_case's local (bash scoping is
# dynamic). This harness is a JS template, which interpolates a dollar-brace even inside
# String.raw, so it must never contain one: say() is how it avoids the braced form.
say() { printf '%s_%s\n' "$label" "$1"; }
run_case() {   # <label> <work dir>
  local label="$1"
  WORK="$2"; GATE_SIDECAR_ROOT="$WORK/sidecar-out"
  mkdir -p "$GATE_SIDECAR_ROOT/sidecar/node_modules"; echo out > "$GATE_SIDECAR_ROOT/sidecar/out.txt"
  mount --bind "$SRC" "$GATE_SIDECAR_ROOT/sidecar/node_modules" || { echo mount_failed=1; exit 0; }
  cleanup_gate_sidecar_out 2>"$T/$label.err"; say "rc=$?"
  [[ -f "$SRC/keep.txt" && -f "$GATE_SIDECAR_ROOT/sidecar/out.txt" ]] && say intact=1
  grep -q 'is a mount under' "$T/$label.err" && say logged=1
  umount "$GATE_SIDECAR_ROOT/sidecar/node_modules"
  cleanup_gate_sidecar_out; say "unmounted_rc=$?"
  [[ -e "$GATE_SIDECAR_ROOT" ]] || say removed=1
  [[ -f "$SRC/keep.txt" ]] && say source_kept=1
}
run_case plain "$T/work"
mkdir -p "$T/w ork"   # mountinfo octal-escapes the space (\040)
run_case space "$T/w ork"
`;

test('a bind mount under the private output leaves the tree and the mount source intact', (t) => {
  const runner = namespaceRunner();
  if (runner.skip) {
    t.skip(runner.skip);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-sidecar-mount-'));
  try {
    const fn = writeCleanupFn(tmp);
    const harness = path.join(tmp, 'harness.sh');
    fs.writeFileSync(harness, MOUNT_HARNESS);
    const work = path.join(tmp, 't');
    fs.mkdirSync(work);
    const owner = `${process.getuid()}:${process.getgid()}`;
    const run = spawnSync(runner.cmd, [...runner.prefix, 'bash', harness, work, fn, owner], {
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(run.status, 0, `harness failed: ${run.stderr}`);
    const out = parse(run.stdout);
    if (out.mount_failed) {
      t.skip(`bind mount refused inside the namespace: ${run.stderr.trim()}`);
      return;
    }
    const expected = {};
    for (const label of ['plain', 'space']) {
      Object.assign(expected, {
        [`${label}_rc`]: '0',
        [`${label}_intact`]: '1',
        [`${label}_logged`]: '1',
        [`${label}_unmounted_rc`]: '0',
        [`${label}_removed`]: '1',
        [`${label}_source_kept`]: '1',
      });
    }
    assert.deepEqual(out, expected);
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
