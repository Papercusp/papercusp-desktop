const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const linuxScript = fs.readFileSync(path.join(root, 'bin/build-linux-local.sh'), 'utf8');
const hetznerFederationScript = fs.readFileSync(
  path.join(root, 'bin/deb-hetzner-federation.sh'),
  'utf8',
);
const hetznerRigScript = fs.readFileSync(path.join(root, 'bin/lib/deb-hetzner-rig.sh'), 'utf8');
const vmConfig = JSON.parse(
  fs.readFileSync(path.join(root, 'src-tauri/tauri.vm-release.conf.json'), 'utf8'),
);

test('normal Linux collection attests final GUI, Server, split seed and AppImage bytes', () => {
  const crypto = require('node:crypto');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-linux-final-provenance-'));
  try {
    const captureStart = linuxScript.indexOf('# Capture the product before sidecar/source staging');
    const captureEnd = linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR', captureStart);
    const collectStart = linuxScript.indexOf('# ── COLLECT:');
    assert.ok(captureStart > 0 && captureEnd > captureStart && collectStart > captureEnd);
    assert.ok(collectStart > linuxScript.indexOf('papercusp_repack_linux_deb "$deb"'));
    assert.ok(collectStart > linuxScript.indexOf('bash "$ROOT/bin/build-appimage.sh"'));
    const artifacts = [
      'deb/papercusp_0.0.32_amd64.deb',
      'deb/papercusp-server_0.0.32_amd64.deb',
      'deb/papercusp-server-seed_0.0.32_all.deb',
      'appimage/Papercusp_0.0.32_amd64.AppImage',
    ].flatMap(name => [name, `${name}.sig`]);
    for (const relocated of [false, true]) {
      const workspace = path.join(fixture, String(relocated));
      const product = path.join(workspace, 'desktop');
      const snapshot = path.join(fixture, `snapshot-${relocated}`);
      fs.mkdirSync(product, { recursive: true });
      fs.mkdirSync(snapshot);
      for (const repo of [workspace, product]) {
        for (const args of [['init', '-q'], ['config', 'user.name', 'Fixture'],
          ['config', 'user.email', 'fixture@example.invalid']]) {
          const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
          assert.equal(r.status, 0, r.stderr);
        }
        fs.writeFileSync(path.join(repo, 'input'), 'accepted source');
        fs.writeFileSync(path.join(repo, '.gitignore'), 'desktop/\nsrc-tauri/\n');
        assert.equal(spawnSync('git', ['-C', repo, 'add', 'input', '.gitignore']).status, 0);
        assert.equal(spawnSync('git', ['-C', repo, 'commit', '-qm', 'fixture']).status, 0);
      }
      const head = spawnSync('git', ['-C', product, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
      const dest = path.join(product, 'src-tauri/target/release/bundle');
      const cargo = relocated ? path.join(fixture, 'external-cargo') : path.join(product, 'src-tauri/target');
      const src = path.join(cargo, 'release/bundle');
      for (const name of [...artifacts, 'deb/stale_0.0.31_amd64.deb']) {
        fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
        fs.writeFileSync(path.join(src, name), `final signed bytes: ${name}`);
      }
      const result = spawnSync('bash', ['-c', [
        'set -euo pipefail',
        linuxScript.slice(captureStart, captureEnd),
        'printf build-mutation > "$ROOT/input"',
        'papercusp_prepare_collection_target_root() { mkdir -p "$1"; }',
        'papercusp_retain_release_paths() { test ! -f "$DEST_BUNDLE/build-provenance.json"; }',
        linuxScript.slice(collectStart),
      ].join('\n')], { encoding: 'utf8', timeout: 30_000, env: { ...process.env,
        ROOT: product, HERE: path.join(root, 'bin'), SRC_ROOT: cargo, DEST_BUNDLE: dest,
        VERSION: '0.0.32', BUILD_SHA: head.slice(0, 8), DISTRIBUTION_PROFILE: 'public',
        PAPERCUSP_BUILD_LINUX_SNAPSHOT_DIR: snapshot,
        PROVENANCE_SOURCE_GIT_HEAD: 'f'.repeat(40), PROVENANCE_SOURCE_GIT_DIRTY: 'true',
        PROVENANCE_SOURCE_DIRTY_MANIFEST: '/wrong-caller-manifest',
        PROVENANCE_REQUIRE_CANDIDATE_PIN: '1',
      } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const provenance = JSON.parse(fs.readFileSync(path.join(dest, 'build-provenance.json')));
      assert.equal(provenance.buildSha, head.slice(0, 8));
      assert.equal(provenance.gitHead, head);
      assert.equal(provenance.gitDirty, false);
      assert.equal(provenance.gitDirtyAtEmit, true);
      assert.equal(provenance.reused, false);
      assert.deepEqual(provenance.artifacts.map(row => row.name).sort(), artifacts.sort());
      for (const row of provenance.artifacts) {
        const bytes = fs.readFileSync(path.join(dest, row.name));
        assert.equal(row.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
        assert.equal(row.bytes, bytes.length);
      }
      assert.equal(provenance.dirtySource.repositories.find(row => row.label === 'workspace').gitHead.length, 40);
      if (relocated) assert.ok(!fs.existsSync(path.join(src, artifacts[0])));
      assert.match(result.stdout, /LINUX BUILD DONE/);
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('normal Linux producer cannot report success when final provenance emission fails', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-linux-provenance-failure-'));
  try {
    fs.writeFileSync(path.join(fixture, 'emit-build-provenance.sh'), 'exit 19\n');
    const start = linuxScript.indexOf('# Attest the final collected bytes');
    assert.ok(start > linuxScript.indexOf('papercusp_retain_release_paths "$SRC_ROOT"'));
    const result = spawnSync('bash', ['-c', ['set -euo pipefail', 'collected=(package.deb package.deb.sig)',
      linuxScript.slice(start)].join('\n')], { encoding: 'utf8', env: { ...process.env,
      HERE: fixture, ROOT: fixture, DEST_BUNDLE: fixture, VERSION: '0.0.32', BUILD_SHA: '12345678',
      LINUX_PROVENANCE_SOURCE_HEAD: '1'.repeat(40), LINUX_PROVENANCE_SOURCE_DIRTY: 'false',
      LINUX_PROVENANCE_SOURCE_MANIFEST: path.join(fixture, 'source.json'),
    } });
    assert.equal(result.status, 19, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /LINUX BUILD DONE/);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('standalone Linux installers survive guarded cleanup under a bounded lease', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-linux-installer-retention-'));
  try {
    const start = linuxScript.indexOf('if [[ -z "${PAPERCUSP_RELEASE_TAG:-}" ]]; then');
    const end = linuxScript.indexOf('# WI-5083:', start);
    assert.ok(start >= 0 && end > start, 'retention must be configured before claiming a Cargo slot');
    assert.ok(end < linuxScript.indexOf('source "$HERE/lib/claim-target-dir.sh"'));
    const setup = linuxScript.slice(start, end);
    for (const [name, tag, ttl] of [['standalone', '', ''], ['cut', 'explicit-cut', '3600']]) {
      const artifacts = path.join(fixture, name);
      const retention = path.join(fixture, `${name}-leases`);
      fs.mkdirSync(artifacts);
      fs.writeFileSync(path.join(artifacts, 'installer.deb'), 'finished installer');
      const result = spawnSync('bash', ['-c', [
        'set -euo pipefail',
        'source "$1"',
        setup,
        'tag="$PAPERCUSP_RELEASE_TAG"',
        'papercusp_retain_release_paths "$2"',
        'cat "$(release_artifacts_retention_lease_path "$tag")"',
        'unset PAPERCUSP_RELEASE_TAG',
        'if release_artifacts_guarded_delete "$2"; then exit 70; fi',
        'test -f "$2/installer.deb"',
      ].join('\n'), 'retention-fixture', path.join(root, 'bin/lib/release-artifacts.sh'), artifacts], {
        encoding: 'utf8', env: { ...process.env,
          PAPERCUSP_RELEASE_TAG: tag, PAPERCUSP_RELEASE_RETENTION_TTL_SEC: ttl,
          PAPERCUSP_RELEASE_RETENTION_ROOT: retention,
          PAPERCUSP_RELEASE_DELETION_AUDIT_PATH: path.join(retention, 'audit.tsv'),
        },
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, name === 'cut' ? /tag=explicit-cut\n/ : /tag=local-linux-[\w-]+\n/);
      const created = BigInt(result.stdout.match(/^created_ns=(\d+)$/m)[1]);
      const expiry = BigInt(result.stdout.match(/^expires_ns=(\d+)$/m)[1]);
      assert.equal(expiry - created, BigInt(ttl || 604800) * 1_000_000_000n, result.stdout);
      assert.ok(fs.existsSync(path.join(artifacts, 'installer.deb')));
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('Linux self-snapshot keeps current helpers while selecting a frozen product root', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-linux-source-seam-'));
  try {
    const tooling = path.join(fixture, 'tooling');
    const product = path.join(fixture, 'product');
    for (const dir of [tooling, product]) fs.mkdirSync(path.join(dir, 'bin/lib'), { recursive: true });
    const entry = path.join(tooling, 'bin/build-linux-local.sh');
    fs.writeFileSync(entry, linuxScript);
    fs.writeFileSync(path.join(tooling, 'bin/lib/distribution-profile.sh'), 'printf "tooling=%s\\nproduct=%s\\n" "$HERE" "$ROOT"\nexit 0\n');
    fs.writeFileSync(path.join(product, 'bin/lib/distribution-profile.sh'), 'echo wrong-frozen-helper\nexit 71\n');
    for (const target of ['', product]) {
      const result = spawnSync('bash', [entry], { encoding: 'utf8', env: { ...process.env,
        PAPERCUSP_BUILD_LINUX_SELF_SNAPSHOT: '', PAPERCUSP_BUILD_LINUX_ROOT: '',
        PAPERCUSP_DESKTOP_TARGET_ROOT: target,
      } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.stdout, `tooling=${tooling}/bin\nproduct=${target || tooling}\n`);
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('Linux help and invalid arguments exit before snapshot or build side effects', { skip: process.platform !== 'linux' }, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-linux-cli-help-'));
  try {
    const fakeBin = path.join(fixture, 'bin');
    fs.mkdirSync(fakeBin);
    const sedSource = process.env.PATH.split(path.delimiter)
      .map((dir) => path.join(dir, 'sed'))
      .find((candidate) => {
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return fs.statSync(candidate).isFile();
        } catch {
          return false;
        }
      });
    assert.ok(sedSource, 'the help printer needs a read-only sed executable');
    fs.symlinkSync(sedSource, path.join(fakeBin, 'sed'));

    const env = {
      ...process.env,
      PATH: fakeBin,
      PAPERCUSP_BUILD_LINUX_SELF_SNAPSHOT: '',
      PAPERCUSP_BUILD_LINUX_ROOT: '',
      PAPERCUSP_DESKTOP_TARGET_ROOT: '',
    };
    const run = (args) => spawnSync('/bin/bash', [path.join(root, 'bin/build-linux-local.sh'), ...args], {
      encoding: 'utf8',
      env,
    });

    for (const flag of ['-h', '--help']) {
      const result = run([flag]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Usage:/);
      assert.match(result.stdout, /--finalize-deb/);
      assert.match(result.stdout, /Env passthrough/);
    }

    const unknown = run(['--not-a-build-option']);
    assert.equal(unknown.status, 2, unknown.stdout + unknown.stderr);
    assert.match(unknown.stderr, /unknown argument: --not-a-build-option/);

    const malformedFinalize = run(['--finalize-deb']);
    assert.equal(malformedFinalize.status, 2, malformedFinalize.stdout + malformedFinalize.stderr);
    assert.match(malformedFinalize.stderr, /--finalize-deb requires/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('Linux fresh staging binds source and environment sidecars to the selected product', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-linux-stage-source-'));
  try {
    const tooling = path.join(fixture, 'tooling');
    const product = path.join(fixture, 'product');
    const freshStart = linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"');
    const reuseStart = linuxScript.indexOf('\n  1)', freshStart);
    assert.ok(freshStart >= 0 && reuseStart > freshStart);
    const freshBranch = `${linuxScript.slice(freshStart, reuseStart)}\nesac\n`;
    fs.mkdirSync(path.join(tooling, 'bin'), { recursive: true });
    fs.copyFileSync(path.join(root, 'bin/stage-env-sidecars.sh'), path.join(tooling, 'bin/stage-env-sidecars.sh'));
    fs.writeFileSync(path.join(tooling, 'bin/build-desktop-sidecar.sh'), 'exit 0\n');
    fs.writeFileSync(path.join(tooling, 'bin/stage-source-tree.sh'),
      'printf "source=%s\\nsidecar=%s\\n" "${PAPERCUSP_STAGE_SOURCE_ROOT:-unset}" "${PAPERCUSP_STAGE_SOURCE_SIDECAR:-unset}"\n');
    for (const selected of [tooling, product]) {
      const sidecar = path.join(selected, 'src-tauri/sidecar');
      fs.mkdirSync(path.join(sidecar, 'spa'), { recursive: true });
      fs.mkdirSync(path.join(sidecar, 'db-sql'), { recursive: true });
      fs.writeFileSync(path.join(sidecar, 'serve.mjs'), `// ${selected}\n`);
      const result = spawnSync('bash', ['-c', [
        'set -euo pipefail',
        'ROOT="$1"; HERE="$2"; BUILD_SHA=fixture; VERSION=0.0.0; DISTRIBUTION_PROFILE=dogfood',
        'hold_sidecar_read_lock() { :; }',
        freshBranch,
      ].join('\n'), 'stage-fixture', selected, path.join(tooling, 'bin')], {
        encoding: 'utf8', env: { ...process.env, PAPERCUSP_REUSE_SIDECAR: '0',
          PAPERCUSP_DESKTOP_TARGET_ROOT: selected,
          PAPERCUSP_STAGE_SOURCE_ROOT: '/stale/source', PAPERCUSP_STAGE_SOURCE_SIDECAR: '/stale/sidecar' },
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(result.stdout.includes(`source=${selected}/..\nsidecar=${sidecar}\n`), result.stdout);
      assert.equal(fs.readFileSync(path.join(sidecar, 'env-sidecars/staging/serve.mjs'), 'utf8'),
        `// ${selected}\n`);
    }
    assert.equal(fs.readFileSync(path.join(tooling, 'src-tauri/sidecar/env-sidecars/staging/serve.mjs'), 'utf8'),
      `// ${tooling}\n`, 'staging the other product must preserve the tooling sidecar');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('Linux reuse qualification runs the maintained tooling verifier and audit', () => {
  const reuse = linuxScript.slice(linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"'), linuxScript.indexOf('echo "==> [4/5]'));
  assert.match(reuse, /bash "\$HERE\/verify-provenance.sh"/);
  assert.match(reuse, /bash "\$HERE\/verify-sidecar-bundle.sh"/);
  assert.match(reuse, /python3 "\$HERE\/audit-release-bundle.py"/);
  assert.doesNotMatch(reuse, /\$ROOT\/bin\//);
});

test('current Debian repacker invokes Tauri from the frozen product directory', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-repacker-source-seam-'));
  try {
    const tooling = path.join(fixture, 'tooling');
    const product = path.join(fixture, 'product');
    const cargoTarget = path.join(fixture, 'cargo-target');
    const fakeBin = path.join(fixture, 'fake-bin');
    const receipt = path.join(fixture, 'cwd.txt');
    fs.mkdirSync(path.join(tooling, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(tooling, 'bin/lib'), { recursive: true });
    fs.mkdirSync(product);
    fs.mkdirSync(cargoTarget);
    fs.mkdirSync(fakeBin);
    const entry = path.join(tooling, 'bin/build-deb-repacked.sh');
    fs.copyFileSync(path.join(root, 'bin/build-deb-repacked.sh'), entry);
    // Freeze every lib helper the entry script names, derived from the script itself:
    // a hand-kept list went red when build-deb-repacked.sh gained spa-freshness.js
    // (WI-6554700010012587). The known helpers pin the derivation against matching nothing.
    const helpers = [...new Set([...fs.readFileSync(entry, 'utf8')
      .matchAll(/\$SCRIPT_DIR\/lib\/([\w.-]+)/g)].map((match) => match[1]))];
    for (const known of ['spa-freshness.js', 'release-host.sh', 'rust-path-remap.sh', 'cargo-target-root.sh']) {
      assert.ok(helpers.includes(known), `derived helper list ${JSON.stringify(helpers)} lacks ${known}`);
    }
    for (const helper of helpers) {
      fs.copyFileSync(path.join(root, 'bin/lib', helper), path.join(tooling, 'bin/lib', helper));
    }
    // The repacker refuses a non-legacy public interface before invoking Tauri.
    const spaIndex = path.join(product, 'src-tauri/sidecar/spa/index.html');
    fs.mkdirSync(path.dirname(spaIndex), { recursive: true });
    fs.writeFileSync(spaIndex, '<!doctype html><meta name="papercusp-desktop-interface" content="legacy"><script type="module" src="/assets/index-fixture.js"></script>');
    fs.writeFileSync(path.join(fakeBin, 'cargo'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(fakeBin, 'tauri'), '#!/bin/sh\nprintf "%s" "$PWD" > "$PC_TEST_CWD"\nexit 77\n', { mode: 0o755 });
    const result = spawnSync('bash', [entry], { encoding: 'utf8', env: { ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`, PAPERCUSP_DESKTOP_TARGET_ROOT: product,
      CARGO_TARGET_DIR: cargoTarget,
      PAPERCUSP_RELEASE_HOST: 'https://updates.example.invalid',
      PAPERCUSP_UPDATE_BASE_URL: 'https://downloads.example.invalid',
      PAPERCUSP_RELEASE_HOST_ENV: path.join(fixture, 'unused-release-host.env'),
      TAURI_SIGNING_PRIVATE_KEY: 'fixture-only', PC_TEST_CWD: receipt,
    } });
    assert.equal(result.status, 77, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(receipt, 'utf8'), product);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

const expectedVmResources = [
  'sidecar/apps/**/*',
  'sidecar/bin/**/*',
  'sidecar/build-provenance.json',
  'sidecar/cpu-task-worker.script.mjs',
  'sidecar/db-seed.dump',
  'sidecar/db-sql/**/*',
  'sidecar/event-loop-sentinel.worker.mjs',
  'sidecar/git-ext-bridge.mjs',
  'sidecar/harness/**/*',
  'sidecar/internal-docs/**/*',
  'sidecar/local-embedder-worker.script.mjs',
  'sidecar/local-reranker-worker.script.mjs',
  'sidecar/mcp-proxy.mjs',
  'sidecar/node_modules/**/*',
  'sidecar/opusscript_native_wasm.wasm',
  'sidecar/orchestrator/**/*',
  'sidecar/pui-companion.wasm',
  'sidecar/pui-install.json',
  'sidecar/scripts/**/*',
  'sidecar/serve.mjs',
  'sidecar/sidecar-preload.js',
  'sidecar/spa/**/*',
  'sidecar/sql/**/*',
];

test('Hetzner .deb federation defaults to the Ubuntu 24.04 ABI while retaining an explicit image override', () => {
  assert.match(
    hetznerFederationScript,
    /LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24\.04"/,
    'the packaged-.deb proof must not fall back to Ubuntu 22.04 (glibc 2.35)',
  );
  assert.match(
    hetznerFederationScript,
    /--image=\*\) IMAGE="\$\{arg#--image=\}" ;;/,
    'deliberate compatibility probes must retain the --image override',
  );
  assert.match(hetznerRigScript, /GLIBC_2\.38[\s\S]*ubuntu-24\.04/);
  assert.match(
    hetznerRigScript,
    /RIG_IMAGE="\$\{2:-\$\{RIG_IMAGE:-ubuntu-24\.04\}\}"/,
    'direct rig consumers need the same ABI-safe fallback as the two-frame driver',
  );
});

// open-source-release-2026-09-29 D-005 / P-019 moved the absent-knob default into
// bin/lib/distribution-profile.sh (`dogfood` unless a public MANIFEST.json says `public`).
// The helper's behaviour — including "no manifest keeps dogfood" — is exercised in
// test/distribution-profile.test.js; here we pin that this entrypoint actually uses it.
const PROFILE_DEFAULT_LINE =
  'DISTRIBUTION_PROFILE="${PAPERCUSP_DISTRIBUTION_PROFILE:-$(default_distribution_profile "$ROOT")}"';

test('dogfood remains the absent-knob default with both roles and developer staging', () => {
  assert.match(linuxScript, /\. "\$HERE\/lib\/distribution-profile\.sh"/);
  assert.ok(
    linuxScript.includes(PROFILE_DEFAULT_LINE),
    'the absent knob must resolve through default_distribution_profile (dogfood in the private tree)',
  );
  assert.match(linuxScript, /dogfood\|public\)\n\s+ROLES="\$\{PAPERCUSP_BUILD_ROLES:-gui server\}"/);

  const freshSidecar = linuxScript.slice(
    linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"'),
    linuxScript.indexOf('# Never clobber a caller-supplied key'),
  );
  assert.match(freshSidecar, /DISTRIBUTION_PROFILE" == "dogfood"/);
  assert.match(freshSidecar, /bash "\$HERE\/stage-env-sidecars\.sh"/);
  assert.match(freshSidecar, /bash "\$HERE\/stage-source-tree\.sh"/);
  assert.match(freshSidecar, /src-tauri\/sidecar\/env-sidecars\/staging/);
  assert.match(freshSidecar, /src-tauri\/sidecar\/source\.tar\.zst/);
  assert.match(
    linuxScript,
    /else\n\s+role_cfg=\(--config src-tauri\/tauri\.server\.conf\.json\)/,
    'dogfood Server builds must retain the established broad Server overlay',
  );
});

test('vm-release is fail-closed, Server-only and disables source staging', () => {
  const blockStart = linuxScript.indexOf(PROFILE_DEFAULT_LINE);
  // D-112 renamed the section that follows the profile block.
  const blockEnd = linuxScript.indexOf('# ── IDENTITY-POLICY COMPATIBILITY PREFLIGHT');
  // A moved anchor must fail HERE, loudly — a -1 start silently slices to '' and every
  // assertion below then reads as "the block lost its vm-release arm".
  assert.ok(blockStart >= 0 && blockEnd > blockStart, 'profile block anchors not found');
  const profileBlock = linuxScript.slice(blockStart, blockEnd);
  assert.match(profileBlock, /vm-release\)/);
  assert.match(profileBlock, /PAPERCUSP_BUILD_ROLES\+x/);
  assert.match(profileBlock, /PAPERCUSP_BUILD_ROLES" != "server"/);
  assert.match(profileBlock, /ROLES="server"/);
  assert.match(profileBlock, /export PAPERCUSP_BUILD_ROLES="\$ROLES"/);
  assert.match(profileBlock, /export PAPERCUSP_STAGE_SOURCE=0/);
  assert.match(profileBlock, /must be dogfood, public or vm-release/);

  assert.match(
    linuxScript,
    /role_cfg=\(--config src-tauri\/tauri\.vm-release\.conf\.json\)/,
  );
  assert.match(linuxScript, /vm-release — skipping env-sidecars and editable source staging/);
});

test('the sidecar provenance receives the immutable build SHA and version', () => {
  assert.match(
    linuxScript,
    /PAPERCUSP_BUILD_SHA="\$BUILD_SHA" PAPERCUSP_DESKTOP_VERSION="\$VERSION" \\\n\s+bash "\$HERE\/build-desktop-sidecar\.sh"/,
    'the sidecar provenance emitter must not fall back to empty SHA or unknown version',
  );
});

test('vm-release sidecar reuse rejects provenance that differs from the launcher build SHA', () => {
  const reuseBlock = linuxScript.slice(
    linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"'),
    linuxScript.indexOf('# Never clobber a caller-supplied key'),
  );
  const verifierAt = reuseBlock.indexOf('verify-provenance.sh');
  const structureAt = reuseBlock.indexOf('verify-sidecar-bundle.sh');

  assert.ok(verifierAt >= 0, 'vm-release reuse must run the maintained provenance verifier');
  assert.ok(
    verifierAt < structureAt,
    'mixed-SHA reuse must fail before the broader sidecar validation and Tauri build',
  );
  assert.match(
    reuseBlock,
    /if \[\[ "\$DISTRIBUTION_PROFILE" == "vm-release" \]\]; then[\s\S]*verify-provenance\.sh" "\$ROOT\/src-tauri\/sidecar" \\\n\s+--health-sha "\$BUILD_SHA" --allow-dirty/,
  );
  assert.match(
    reuseBlock,
    /vm-release sidecar reuse must match build SHA \$BUILD_SHA; rebuild without PAPERCUSP_REUSE_SIDECAR=1/,
  );
});

test('vm-release Tauri overlay is an exact runtime allowlist with Server identity', () => {
  assert.equal(vmConfig.productName, 'Papercusp Server');
  assert.equal(vmConfig.mainBinaryName, 'papercusp-server');
  assert.equal(vmConfig.identifier, 'com.papercusp.server');
  assert.deepEqual(vmConfig.bundle.resources, expectedVmResources);
  assert.deepEqual(vmConfig.bundle.linux.deb.files, {
    '/usr/lib/systemd/user/papercusp-server.service': 'systemd/papercusp-server.service',
    '/usr/sbin/papercusp-server-enable-boot-start': 'systemd/enable-boot-start.sh',
  });

  for (const forbidden of [
    'sidecar/**/*',
    'sidecar/source.tar.zst',
    'sidecar/env-sidecars/**/*',
    'resources/*',
    'seed/**/*',
  ]) {
    assert.equal(
      vmConfig.bundle.resources.includes(forbidden),
      false,
      `vm-release must not admit dogfood/dev resource glob ${forbidden}`,
    );
  }
});

test('vm-release collects only one fresh Debian-identified Server artifact', () => {
  const selectionAt = linuxScript.indexOf('vm_release_debs=()');
  const appImageAt = linuxScript.indexOf('if [[ " $ROLES " == *" gui "* ]]');
  const selection = linuxScript.slice(selectionAt, appImageAt);

  assert.match(selection, /VM_RELEASE_FRESHNESS_MARKER/);
  assert.match(selection, /"\$deb" -nt "\$VM_RELEASE_FRESHNESS_MARKER"/);
  assert.match(selection, /dpkg-deb -f "\$deb" Package/);
  assert.match(selection, /== "papercusp-server"/);
  assert.match(selection, /\$\{#vm_release_debs\[@\]\} -eq 1/);
  assert.match(selection, /for deb in "\$\{vm_release_debs\[@\]\}"/);
  assert.match(selection, /assert_vm_release_deb_runtime_only "\$deb"/);

  const collectorAt = linuxScript.indexOf('collected=()');
  const retainedAt = linuxScript.indexOf('papercusp_retain_release_paths');
  const collector = linuxScript.slice(collectorAt, retainedAt);
  assert.match(collector, /DISTRIBUTION_PROFILE" == "vm-release"/);
  assert.match(collector, /for f in "\$\{vm_release_debs\[@\]\}"/);
  assert.match(collector, /for deb in "\$\{vm_release_debs\[@\]\}"/);
  assert.match(collector, /collected\+=\("\$f" "\$f\.sig"\)/);
});

test('finished vm-release deb inspection rejects every dogfood-only payload class', () => {
  const audit = linuxScript.slice(
    linuxScript.indexOf('assert_vm_release_deb_runtime_only()'),
    linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"'),
  );
  for (const forbidden of [
    '/sidecar/source.tar.zst',
    '/sidecar/env-sidecars',
    '/seed',
    '/resources/',
  ]) {
    assert.match(audit, new RegExp(forbidden.replaceAll('/', '\\/')));
  }
  assert.match(audit, /dpkg-deb --fsys-tarfile/);
  assert.match(audit, /audit-release-bundle\.py" --scan-artifact --licenses "\$deb"/);
});
