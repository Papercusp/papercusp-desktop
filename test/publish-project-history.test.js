const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Execute the publisher's real public-readback block with a fake HTTPS seam.
function verify({ missing = false, mismatch = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-history-'));
  try {
    const site = path.join(dir, 'site');
    const served = path.join(dir, 'served');
    const temporary = path.join(dir, 'readback');
    const files = ['changes/desktop-v1.2.3-alpha.html', 'changes/desktop-v1.2.3-alpha.json',
      'assets/project-history.js', 'assets/project-history.css', 'assets/vditor/dist/js/lute/lute.min.js'];
    for (const root of [site, served, temporary]) fs.mkdirSync(root, { recursive: true });
    for (const root of [site, served]) for (const relative of files) {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), `fixture ${relative}`);
    }
    fs.writeFileSync(path.join(temporary, 'index.html'), '<a href="changes/desktop-v1.2.3-alpha.html">Changes</a>');
    if (missing) fs.unlinkSync(path.join(served, files[1]));
    if (mismatch) fs.writeFileSync(path.join(served, files[2]), 'stale renderer');
    const source = fs.readFileSync(path.join(__dirname, '../bin/publish-release-history.sh'), 'utf8');
    const marker = '# Follow the current release\'s actual link';
    const start = source.lastIndexOf('if [[ "$IS_HOLDING_PAGE" == "0" ]]; then', source.indexOf(marker));
    const end = source.indexOf('\n# Follow one REAL link', start);
    assert.ok(start >= 0 && end > start);
    // The verification block calls uploaded_by_this_run(), defined far above the slice. Carry
    // the REAL definition in (never a stub) and run it as a FULL publish (DELTA_MODE=full),
    // where every file was re-uploaded and so must match the local copy — the property under test.
    const helperStart = source.indexOf('uploaded_by_this_run() {');
    const helperEnd = source.indexOf('\n}\n', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'uploaded_by_this_run() definition not found');
    const helper = source.slice(helperStart, helperEnd + 2);
    const script = `set -euo pipefail\nIS_HOLDING_PAGE=0\nDELTA_MODE=full\nBASE=https://example.invalid/unlisted\ncurl() { local url out; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; https:*) url="$1"; shift;; *) shift;; esac; done; cp "$SERVED/\${url#"$BASE"/}" "$out"; }\n${helper}\n${source.slice(start, end)}`;
    return spawnSync('bash', ['-c', script], { encoding: 'utf8', env: {
      ...process.env, SITE_DIR: site, SERVED: served, TMP_PAGE: temporary,
    } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('public History verification follows the served link and compares all required bytes', () => {
  const result = verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /served byte-identically/);
});
test('missing History data and stale renderer bytes refuse successful publication', () => {
  assert.notEqual(verify({ missing: true }).status, 0);
  assert.notEqual(verify({ mismatch: true }).status, 0);
});

// Full entrypoint acceptance complements the readback slice above. Reuse the
// storage contract's provider emulator and the uploader suite's object/HTTP
// fixture pattern. The real interface guard, delta planner, identity gates,
// storage adapter, link checker and readback execute without replacements.
async function publishPage({ channel, selection, artifactKind = 'legacy',
  missingInstaller = false, staleHistory = false, identityLeak = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-page-journey-'));
  const repo = path.resolve(__dirname, '../..');
  const version = `9.8.7${channel === 'stable' ? '' : `-${channel}`}`;
  const tag = `desktop-v${version}`;
  const bucket = 'test-release-bucket';
  const prefix = 'fixture-release';
  const objects = path.join(dir, 'objects');
  const site = path.join(dir, 'site');
  const home = path.join(dir, 'home');
  const bin = path.join(dir, 'bin');
  const desktopBin = path.join(dir, 'papercusp-desktop/bin');
  const manifest = path.join(home, '.papercusp/release-history-publish-manifest.json');
  const requests = [];
  const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
  const lines = file => fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
  const writes = () => lines(path.join(objects, 'writes'))
    .map(uri => uri.replace(`gs://${bucket}/`, ''));
  const objectFiles = key => {
    const id = sha256(`gs://${bucket}/${key}`);
    return { data: path.join(objects, `${id}.data`), meta: path.join(objects, `${id}.json`) };
  };
  const putFixture = (key, body) => {
    const files = objectFiles(key);
    fs.writeFileSync(files.data, body);
    fs.writeFileSync(files.meta, JSON.stringify({ generation: '41',
      size: String(Buffer.byteLength(body)), metadata: { sha256: sha256(body) } }));
  };
  const snapshot = keys => Object.fromEntries(keys.map(key => {
    const files = objectFiles(key);
    return [key, fs.existsSync(files.data)
      ? { body: sha256(fs.readFileSync(files.data)), metadata: fs.readFileSync(files.meta, 'utf8') }
      : null];
  }));
  const server = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.slice(1));
    const file = objectFiles(key).data;
    const status = fs.existsSync(file) ? 200 : 404;
    const body = status === 200
      ? staleHistory && key === `${prefix}/history.json` ? 'stale history' : fs.readFileSync(file)
      : 'missing fixture object';
    requests.push({ key, method: req.method, status, body: sha256(body), writes: writes() });
    res.writeHead(status);
    res.end(body);
  });
  try {
    for (const directory of [objects, site, bin, path.join(home, '.papercusp'),
      path.join(desktopBin, 'lib'), path.join(dir, 'apps/operator/lib')]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}/${prefix}`;
    for (const file of ['publish-release-history.sh', 'check-page-links.mjs',
      'lib/spa-freshness.js', 'lib/release-storage.sh']) {
      fs.copyFileSync(path.join(__dirname, '../bin', file), path.join(desktopBin, file));
    }
    // Resolve the actual TypeScript CLIs and their imports in the monorepo.
    // A recorder delegates to the installed tsx; it never invents a gate or plan.
    fs.symlinkSync(path.join(repo, 'apps/operator/lib/release'),
      path.join(dir, 'apps/operator/lib/release'), 'dir');
    fs.writeFileSync(path.join(bin, 'npx'), [
      '#!/usr/bin/env node',
      'const fs = require("node:fs"), path = require("node:path");',
      'const { spawnSync } = require("node:child_process");',
      'const args = process.argv.slice(2), root = process.env.PAGE_FIXTURE;',
      'const approved = ["release-site-delta.ts", "gate-release-site.ts"];',
      'if (args[0] !== "tsx" || !approved.some(name => args[1] === path.join(root, "apps/operator/lib/release", name))) process.exit(91);',
      'const result = spawnSync(process.execPath, [process.env.PAGE_FIXTURE_TSX, ...args.slice(1)], { stdio: "inherit", env: process.env });',
      'fs.appendFileSync(path.join(root, "cli.jsonl"), JSON.stringify({ cli: path.basename(args[1]), command: args[2], status: result.status }) + "\\n");',
      'process.exit(result.status ?? 92);',
    ].join('\n'), { mode: 0o755 });
    const storageContract = fs.readFileSync(path.join(__dirname, '../bin/lib/remote-object-state.selftest.sh'), 'utf8');
    const provider = storageContract.match(/cat > "\$TEST_ROOT\/bin\/gcloud" <<'PY'\n([\s\S]*?)\nPY\n/);
    assert.ok(provider, 'maintained release-storage provider fixture must exist');
    const boundary = 'args = sys.argv[1:]';
    assert.equal(provider[1].split(boundary).length, 2);
    fs.writeFileSync(path.join(bin, 'gcloud'), provider[1].replace(boundary, [
      boundary, "with (root / 'calls').open('a') as log: log.write(json.dumps(args) + '\\n')",
    ].join('\n')), { mode: 0o755 });
    fs.writeFileSync(path.join(home, '.papercusp/release-host.env'), `PAPERCUSP_UPDATE_BASE_URL=${base}\n`);

    const registry = spawnSync('bash', ['-c', [
      '. "$1"',
      'for channel in alpha beta stable nightly; do',
      '  desktop_channel_feed_paths "$channel" latest.json',
      '  desktop_channel_feed_paths "$channel" latest-server.json',
      'done',
    ].join('\n'), '--', path.join(__dirname, '../bin/lib/gen-latest-manifest.sh')],
    { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(registry.status, 0, registry.stderr);
    const installer = `${tag}/installer.exe`;
    const protectedArtifacts = ['alpha', 'beta', 'stable', 'nightly'].flatMap(lane => {
      const key = `desktop-v9.8.7${lane === 'stable' ? '' : `-${lane}`}/installer.exe`;
      return [key, `${key}.sig`];
    });
    const protectedKeys = [...new Set(registry.stdout.trim().split('\n')),
      'index.html', 'history.json', 'instructions.html', ...protectedArtifacts,
      'desktop-vprevious/installer.exe', 'desktop-vprevious/installer.exe.sig']
      .map(key => `${prefix}/${key}`);
    for (const key of protectedKeys) putFixture(key, `previous bytes for ${key}\n`);
    if (missingInstaller) {
      const files = objectFiles(`${prefix}/${installer}`);
      fs.unlinkSync(files.data);
      fs.unlinkSync(files.meta);
    }
    const files = {
      'index.html': `<section class="rel" data-newest-release="${version}">` +
        `<a href="work-items/fixture.html">Details</a><a href="changes/${tag}.html">Changes</a>` +
        `<a href="plans/fixture.html">Plan</a><a href="${installer}">Download</a></section>`,
      'history.json': JSON.stringify({ releases: [{ version, artifacts: [{
        desktopInterface: { kind: artifactKind, spaIndexSha256: sha256('measured fixture SPA') },
      }] }] }),
      'plans/fixture.html': '<p>Release plan</p>',
      'work-items/fixture.html': `<p>${identityLeak ? 'Synthetic Release Custodian' : 'Release detail'}</p>`,
      [`changes/${tag}.html`]: '<p>Release changes</p>',
      [`changes/${tag}.json`]: JSON.stringify({ title: 'Release changes' }),
      'assets/project-history.js': '/* history renderer fixture */',
      'assets/project-history.css': 'body { color: black; }',
      'assets/vditor/dist/js/lute/lute.min.js': '/* history parser fixture */',
    };
    for (const [relative, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(site, relative)), { recursive: true });
      fs.writeFileSync(path.join(site, relative), body);
    }
    const keys = [...new Set([...protectedKeys, ...Object.keys(files).map(key => `${prefix}/${key}`)])];
    const before = snapshot(keys);
    // Keep the committed-source enforcement and audit channels in every Node
    // descendant, while excluding real release config and credentials.
    const sourceEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      key === 'NODE_OPTIONS' || key.startsWith('PAPERCUSP_COMMITTED_SOURCE')));
    const env = {
      ...sourceEnv, PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: dir,
      PAPERCUSP_RELEASE_SITE_DIR: site, PAPERCUSP_RELEASE_PUBLISH_MANIFEST: manifest,
      PAPERCUSP_RELEASE_GCS_BUCKET: bucket,
      PAPERCUSP_RELEASE_STORAGE_ENV: path.join(dir, 'absent-storage-config'),
      PAPERCUSP_RELEASE_IDENTITY_ENV: path.join(dir, 'absent-identity-config'),
      PAPERCUSP_RELEASE_OWNER_NAME: 'Synthetic Release Custodian',
      PAPERCUSP_RELEASE_OWNER_EMAIL: 'custodian@example.invalid',
      RELEASE_STORAGE_FIXTURE_ROOT: objects, PAGE_FIXTURE: dir,
      PAGE_FIXTURE_TSX: path.join(repo, 'node_modules/tsx/dist/cli.mjs'),
    };
    if (selection !== undefined) env.PAPERCUSP_DESKTOP_INTERFACE = selection;
    const result = await new Promise((resolve, reject) => {
      // timeout owns its process group and bounds the complete shell/CLI tree.
      const child = spawn('timeout', ['--signal=TERM', '--kill-after=2s', '45s',
        'bash', path.join(desktopBin, 'publish-release-history.sh'), version], { cwd: repo, env });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
    });
    return { ...result, before, after: snapshot(keys), writes: writes(), requests,
      expected: Object.fromEntries(Object.entries(files).map(([key, body]) => [`${prefix}/${key}`, sha256(body)])),
      providerCalls: lines(path.join(objects, 'calls')).map(row => JSON.parse(row)),
      cliCalls: lines(path.join(dir, 'cli.jsonl')).map(row => JSON.parse(row)),
      manifest: fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : null };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const channel of ['alpha', 'beta', 'stable', 'nightly']) {
  test(`full release-page ${channel} defaults to legacy and publishes verified pages before index`, async () => {
    const result = await publishPage({ channel });
    assert.equal(result.status, 0, `${result.signal || ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /done — the release-history page is LIVE/);
    assert.equal(result.writes.at(-1), 'fixture-release/index.html');
    assert.deepEqual([...result.writes].sort(), Object.keys(result.expected).sort());
    assert.ok(result.providerCalls.length > 0);
    for (const [key, before] of Object.entries(result.before)) {
      if (!result.writes.includes(key)) assert.deepEqual(result.after[key], before, `${key} must remain untouched`);
    }
    for (const [key, hash] of Object.entries(result.expected)) {
      assert.equal(result.after[key].body, hash, key);
      assert.ok(result.requests.some(row => row.key === key && row.status === 200 && row.body === hash), key);
    }
    const linkChecks = result.requests.filter(row => row.method === 'HEAD');
    assert.ok(linkChecks.length >= 4, 'real link checker must run before advertising the index');
    assert.ok(linkChecks.every(row => !row.writes.includes('fixture-release/index.html')));
    assert.deepEqual(result.cliCalls.map(row => row.cli), [
      'release-site-delta.ts', 'gate-release-site.ts', 'gate-release-site.ts', 'release-site-delta.ts',
    ]);
    assert.ok(result.cliCalls.every(row => row.status === 0));
    assert.deepEqual(result.manifest.files, Object.fromEntries(Object.entries(result.expected)
      .map(([key, hash]) => [key.slice('fixture-release/'.length), hash])));
  });
  for (const candidate of [
    { selection: 'portal-candidate', artifactKind: 'legacy' },
    { selection: 'legacy', artifactKind: 'portal-candidate' },
  ]) {
    test(`full release-page ${channel} candidate ${candidate.selection === 'legacy' ? 'history' : 'selection'} preserves protected objects without I/O`, async () => {
      const result = await publishPage({ channel, ...candidate });
      assert.equal(result.status, 4, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /PUBLIC DESKTOP INTERFACE HOLD/);
      assert.deepEqual(result.providerCalls, []);
      assert.deepEqual(result.requests, []);
      assert.deepEqual(result.writes, []);
      assert.deepEqual(result.cliCalls, []);
      assert.deepEqual(result.after, result.before);
      assert.equal(result.manifest, null);
    });
  }
}

for (const [name, options, diagnostic] of [
  ['identity leak', { identityLeak: true }, /REFUSING TO UPLOAD/],
  ['missing linked installer', { missingInstaller: true }, /refusing to upload index.html/],
  ['stale served history', { staleHistory: true }, /served history.json does NOT match/],
]) {
  test(`full release-page ${name} refuses certification and manifest commit`, async () => {
    const result = await publishPage({ channel: 'stable', ...options });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, diagnostic);
    assert.equal(result.manifest, null);
    assert.equal(result.cliCalls.some(row => row.command === 'commit'), false);
    if (options.identityLeak) assert.deepEqual(result.writes, []);
    if (!options.staleHistory) assert.deepEqual(result.after['fixture-release/index.html'], result.before['fixture-release/index.html']);
  });
}
