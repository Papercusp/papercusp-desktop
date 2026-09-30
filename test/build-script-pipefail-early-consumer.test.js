// Guards bin/build-desktop-sidecar.sh against the pipefail EARLY-CONSUMER class
// (WI-10003960 R-15, fresh-clone build4 died with a silent EXIT=141).
//
// Under `set -o pipefail`, a consumer that exits before draining its input
// (`head -N`, `grep -q`, `awk '… {…; exit}'`) SIGPIPEs a producer that is still
// writing. The pipeline then reports 141: inside `x="$(…)"` under `set -e` that
// kills the whole build; inside `if …` it silently takes the wrong branch. Whether
// the producer is still writing is a scheduling race, so the same build passes on
// one run and dies on the next (build3 passed `ldconfig -p | awk …exit`, build4 did
// not). The fix is a consumer that reads all input (`sed -n 1p`, `grep -c … >/dev/null`,
// awk with a latch instead of `exit`). This test keeps the script free of the class.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '..', 'bin/build-desktop-sidecar.sh');

// A pipe into an early-exiting consumer. Anchored on `|` so a producer such as
// `head -c 2 FILE | …` is not flagged.
const EARLY_CONSUMER = /\|\s*(head\b|grep\s+-[A-Za-z]*q|awk\b[^|]*[{;]\s*exit\b)/;

function codeLines(src) {
  return src.split('\n').map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => !/^\s*#/.test(text));
}

test('build-desktop-sidecar.sh has no pipe into an early-exiting consumer', () => {
  const offenders = codeLines(fs.readFileSync(script, 'utf8'))
    .filter(({ text }) => EARLY_CONSUMER.test(text))
    .map(({ line, text }) => `${line}: ${text.trim()}`);
  assert.deepEqual(offenders, [],
    'use a draining consumer (sed -n 1p / grep -c … >/dev/null / awk latch) instead');
});

test('the detector recognises each early-consumer shape (control)', () => {
  for (const bad of [
    'x="$(ldconfig -p | awk \'$1==l {print $NF; exit}\')"',
    'x="$(find "$d" -name y | head -1)"',
    'if find p -name "*.node" | grep -q .; then',
    'kopia --version | grep -Fq "$V" || {',
  ]) assert.match(bad, EARLY_CONSUMER, bad);
  for (const ok of [
    'x="$(ldconfig -p | awk \'$1==l && !f {print $NF; f=1}\')"',
    'x="$(find "$d" -name y | sed -n 1p)"',
    'if ! head -c 2 "$f" | grep -c \'#!\' >/dev/null; then',
  ]) assert.doesNotMatch(ok, EARLY_CONSUMER, ok);
});

test('the class is real: head -1 under pipefail dies 141, sed -n 1p does not', () => {
  // A producer far larger than a pipe buffer, like `ldconfig -p`.
  const run = (consumer) => spawnSync('bash', ['-c',
    `set -euo pipefail; x="$(seq 1 2000000 | ${consumer})"; echo "got=$x"`],
    { encoding: 'utf8' });
  const bad = run('head -1');
  assert.equal(bad.status, 141, `early consumer should SIGPIPE the producer: ${bad.stdout}${bad.stderr}`);
  const good = run('sed -n 1p');
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /got=1\b/);
});

test('build-desktop-sidecar.sh still parses', () => {
  const r = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
