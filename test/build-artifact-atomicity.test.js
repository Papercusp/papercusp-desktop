'use strict';

// Release guards historically checked only `[[ -f ]]`. If an interrupted
// producer streams directly into that path, the next packaging run cannot tell
// a complete archive from a truncated one. These assertions keep the durable
// fix at the producer boundary: final paths are removed before a build, written
// through same-directory temporary files, and published only after success.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const stageSource = fs.readFileSync(path.join(root, 'bin/stage-source-tree.sh'), 'utf8');
const buildRootfs = fs.readFileSync(path.join(root, 'scripts/build-rootfs.sh'), 'utf8');

function executableLines(source) {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

test('source archive is audited before atomic publication', () => {
  const executable = executableLines(stageSource);

  assert.match(executable, /rm -f "\$OUT"/);
  assert.match(executable, /OUT_TMP="\$\(mktemp "\$\{OUT\}\.tmp\.XXXXXX"\)"/);
  assert.match(executable, /\| zstd [^\n]* -o "\$OUT_TMP"/);
  assert.match(executable, /python3 "\$HERE\/audit-release-bundle\.py" "\$OUT_TMP"/);
  assert.match(executable, /mv -f "\$OUT_TMP" "\$OUT"/);
  assert.doesNotMatch(
    executable,
    /\| zstd [^\n]* -o "\$OUT"/,
    'zstd must never stream into the final archive path',
  );
});

test('Windows rootfs export is published only after gzip succeeds', () => {
  const executable = executableLines(buildRootfs);

  assert.match(executable, /rm -f "\$OUT_TARBALL"/);
  assert.match(executable, /OUT_TMP="\$\(mktemp "\$\{OUT_TARBALL\}\.tmp\.XXXXXX"\)"/);
  assert.match(executable, /docker export "\$CONTAINER" \| gzip -9 > "\$OUT_TMP"/);
  assert.match(executable, /mv -f "\$OUT_TMP" "\$OUT_TARBALL"/);
  assert.doesNotMatch(
    executable,
    /docker export "\$CONTAINER" \| gzip -9 > "\$OUT_TARBALL"/,
    'docker export must never stream into the final tarball path',
  );
});
