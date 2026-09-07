'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const bin = path.join(__dirname, '..', 'bin');
const release = fs.readFileSync(process.env.PROBE_RELEASE_LOCAL || path.join(bin, 'release-local.sh'), 'utf8');
const sidecar = fs.readFileSync(path.join(bin, 'build-desktop-sidecar.sh'), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing shell boundary: ${start}`);
  return text.slice(from, to);
}

const calls = {
  linux: section(release, 'export PAPERCUSP_RELEASE_AUDIT=1\n', '# P-004: the exact sha'),
  mac: section(release, '    env \\\n      TARGET_OS=darwin', '    # 2) universal .app'),
};

test('mac leg asserts the freshly built Darwin sidecar, not the Linux hash', () => {
  assert.match(release, /unset PAPERCUSP_EXPECTED_SERVE_SHA/);
  assert.match(calls.mac, /mac_expected_serve_sha=\"\$\(sha256sum \"\$MAC_SIDECAR_DIR\/serve\.mjs\"/);
  assert.match(calls.mac, /export PAPERCUSP_EXPECTED_SERVE_SHA=\"\$mac_expected_serve_sha\"/);
  assert.match(release, /PAPERCUSP_EXPECTED_SERVE_SHA=\$mac_expected_serve_sha/);
});
// Exercise the producer's real refusal, without compiling or altering the live tree.
const headGuard = section(sidecar, '  _provenance_current_head=', '  unset _provenance_current_head\nfi\n');

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function initRepo(root, content) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  fs.writeFileSync(path.join(root, 'source.txt'), content);
  git(root, 'add', 'source.txt');
  git(root, 'commit', '-qm', 'fixture');
  return git(root, 'rev-parse', 'HEAD');
}

for (const platform of Object.keys(calls)) {
  for (const drift of [false, true]) {
    test(`${platform} sidecar ${drift ? 'still refuses real superproject drift' : 'uses the superproject identity with a distinct desktop repository'}`, () => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sidecar-source-'));
      try {
        const workspace = path.join(temp, 'workspace');
        const desktop = path.join(workspace, 'papercusp-desktop');
        const expected = initRepo(workspace, 'operator source');
        const desktopHead = initRepo(desktop, 'desktop source');
        assert.notEqual(expected, desktopHead);
        if (drift) {
          fs.writeFileSync(path.join(workspace, 'source.txt'), 'moved operator source');
          git(workspace, 'commit', '-qam', 'source moved');
        }
        fs.mkdirSync(path.join(desktop, 'bin'));
        fs.writeFileSync(path.join(desktop, 'bin', 'build-desktop-sidecar.sh'), [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          headGuard,
          'if [[ -n "${PAPERCUSP_SIDECAR_OUT:-}" ]]; then mkdir -p "$PAPERCUSP_SIDECAR_OUT"; printf "fixture\\n" > "$PAPERCUSP_SIDECAR_OUT/serve.mjs"; fi',
          'printf "HEAD=%s DIRTY=%s BUILD=%s TARGET=%s\\n" "$PROVENANCE_SOURCE_GIT_HEAD" "$PROVENANCE_SOURCE_GIT_DIRTY" "$PAPERCUSP_BUILD_SHA" "${TARGET_OS:-linux}"',
        ].join('\n'));
        const result = spawnSync('bash', ['-c', 'set -euo pipefail\nPC_NICE=()\n' + calls[platform]], {
          encoding: 'utf8',
          env: {
            ...process.env,
            ROOT: desktop,
            REPO_ROOT: workspace,
            EXPECTED_SOURCE_SHA: expected,
            PROVENANCE_SOURCE_GIT_HEAD: desktopHead,
            PROVENANCE_SOURCE_GIT_DIRTY: 'false',
            PAPERCUSP_BUILD_SHA: desktopHead.slice(0, 8),
            BUILD_SHA: desktopHead.slice(0, 8),
            VERSION: '0.0.19',
            MAC_SIDECAR_DIR: path.join(temp, 'darwin-sidecar'),
          },
        });
        if (drift) {
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, /source HEAD moved during build/);
        } else {
          assert.equal(result.status, 0, result.stderr);
          assert.match(result.stdout, new RegExp(`HEAD=${expected} DIRTY=false BUILD=${desktopHead.slice(0, 8)} TARGET=${platform === 'mac' ? 'darwin' : 'linux'}`));
        }
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    });
  }
}
