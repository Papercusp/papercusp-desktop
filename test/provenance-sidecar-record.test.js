// EI-20086238555902880 — the shipped provenance must say WHICH SIDECAR it packed.
//
// THE BUG. A desktop build compiles fresh Rust but reuses whatever prebuilt sidecar
// happens to be on disk (rebuilding it is a separate manual step). On the 0.0.14
// Windows cut the installer was built 15:45:18Z from gitHead c5d848155a while its
// packed serve.mjs was baked 03:09:18Z — twelve and a half hours older — so a fix
// committed at 15:38:38Z was simply absent from the shipped payload.
//
// WHY IT WAS DANGEROUS BEYOND THE ONE MISSING FIX: build-provenance.json records
// gitHead + gitDirty and READS as a complete provenance claim. A reviewer who checks
// it — the right instinct — concludes the artifact carries everything at that commit.
// That is TRUE of the Rust layer and FALSE of the sidecar, and nothing surfaced the
// difference. The reporter nearly handed a peer a "the build carries the fix"
// assurance on exactly that basis.
//
// WHAT THIS FIX IS NOT. It is deliberately a RECORD, not a staleness assertion.
// bin/lib/sidecar-freshness.js already considered and rejected "sidecar older than
// sources" in writing: one shared checkout, HEAD moving every few minutes, so such a
// rule fires on nearly every build for every agent and trains the bypass. Recording
// has no false-positive rate; judging has a large one.
//
// Tests run the REAL emitter as a subprocess — the contract is what the script
// EMITS, and a source-text regex cannot tell a contract from a comment describing one.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin');
const EMITTER = path.join(BIN, 'emit-build-provenance.sh');
const VERIFIER = path.join(BIN, 'verify-provenance.sh');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prov-sidecar-'));
}

/** Run the real emitter; return the parsed build-provenance.json it wrote. */
function emit({ sidecarDir, gitRoot, extraEnv = {} } = {}) {
  const out = path.join(tmp(), 'out');
  fs.mkdirSync(out, { recursive: true });
  const artifact = path.join(out, 'App_0.0.0_amd64.deb');
  fs.writeFileSync(artifact, 'fixture');

  const env = { ...process.env, PROVENANCE_GIT_ROOT: gitRoot || path.join(BIN, '..'), ...extraEnv };
  if (sidecarDir) env.PROVENANCE_SIDECAR_DIR = sidecarDir;

  const r = spawnSync('bash', [EMITTER, out, '0.0.0', 'testsha', 'false', artifact], {
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 0, `emitter exited ${r.status}: ${r.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(out, 'build-provenance.json'), 'utf8'));
}

function captureSource(gitRoot) {
  const result = spawnSync('bash', [EMITTER, '--capture-source', gitRoot], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `source capture exited ${result.status}: ${result.stderr}`);
  const fields = result.stdout.trim().split('\n');
  assert.equal(fields.length, 2, `source capture returned ${fields.length} fields`);
  assert.match(fields[0], /^[0-9a-f]{40}$/);
  assert.match(fields[1], /^(?:true|false)$/);
  return { head: fields[0], dirty: fields[1] };
}

/** A sidecar dir carrying its OWN provenance, written by the same real emitter. */
function sidecarWithProvenance() {
  const dir = tmp();
  const serve = path.join(dir, 'serve.mjs');
  fs.writeFileSync(serve, 'sidecar-bytes');
  const r = spawnSync('bash', [EMITTER, dir, '0.0.0', 'sidecarsha', 'false', serve], {
    encoding: 'utf8',
    env: { ...process.env, PROVENANCE_GIT_ROOT: path.join(BIN, '..') },
  });
  assert.equal(r.status, 0, `sidecar provenance emit failed: ${r.stderr}`);
  return dir;
}

test('a leg that names no sidecar records null — present, not missing', () => {
  const doc = emit();
  assert.ok(
    'sidecar' in doc,
    'the key must ALWAYS be emitted: a missing key has to keep meaning "written by a ' +
      'pre-fix emitter", which is only readable if "no sidecar named" is a present null',
  );
  assert.equal(doc.sidecar, null);
});

test('a named sidecar is recorded by commit, build time, and CONTENT hash', () => {
  const dir = sidecarWithProvenance();
  const own = JSON.parse(fs.readFileSync(path.join(dir, 'build-provenance.json'), 'utf8'));
  const doc = emit({ sidecarDir: dir });

  assert.equal(doc.sidecar.gitHead, own.gitHead);
  assert.equal(doc.sidecar.builtAtUtc, own.builtAtUtc);
  // The content hash is the field that answers "are these the bytes I think they are"
  // without trusting a timestamp — the only one a clock skew cannot forge.
  const serveSha = own.artifacts.find((a) => a.name === 'serve.mjs').sha256;
  assert.equal(doc.sidecar.serveMjsSha256, serveSha);
  assert.match(doc.sidecar.serveMjsSha256, /^[0-9a-f]{64}$/);
});

test('a sidecar dir with NO provenance is "absent", never null', () => {
  // sidecar-freshness.js treats a missing provenance file as UNDECIDABLE and explicitly
  // not a pass. Collapsing that into the same null as "no sidecar named" would erase the
  // difference between "nothing was packed" and "something was packed, unidentified".
  const doc = emit({ sidecarDir: tmp() });
  assert.deepEqual(doc.sidecar, { status: 'absent' });
});

test('THE 0.0.14 SCENARIO: a stale packed sidecar is visible in the shipped record', () => {
  // Reconstruct the actual failure — an installer whose sidecar half came from a
  // DIFFERENT commit than its Rust half — and assert the artifact now exposes it.
  // Without this record both cuts produce byte-identical provenance, which is exactly
  // why the staleness was invisible for as long as it was.
  const dir = sidecarWithProvenance();
  const provPath = path.join(dir, 'build-provenance.json');
  const stale = JSON.parse(fs.readFileSync(provPath, 'utf8'));
  stale.gitHead = 'c5d848155a0000000000000000000000000000ff'; // the 0.0.14 sidecar commit
  stale.builtAtUtc = '2026-08-10T03:09:18Z'; // 12.5h before its installer
  fs.writeFileSync(provPath, JSON.stringify(stale, null, 2));

  const doc = emit({ sidecarDir: dir });
  assert.equal(doc.sidecar.gitHead, 'c5d848155a0000000000000000000000000000ff');
  assert.equal(doc.sidecar.builtAtUtc, '2026-08-10T03:09:18Z');
  assert.notEqual(
    doc.sidecar.gitHead,
    doc.gitHead,
    'the whole point: the two halves can disagree, and the artifact must now SAY so',
  );
});

test('the emitted document is valid JSON in every sidecar state', () => {
  // A hand-rolled printf emitter is one stray quote away from writing a file no
  // consumer can parse — and consumers here treat unparseable as "cannot judge",
  // which is indistinguishable from a clean read at a glance.
  for (const state of [undefined, tmp(), sidecarWithProvenance()]) {
    assert.doesNotThrow(() => emit({ sidecarDir: state }));
  }
});

test('gitDirty fails closed when a submodule path has no checked-out HEAD', () => {
  // Reproduce the clean-snapshot failure against a disposable superproject:
  // Git's root diff ignores an absent submodule path, but that path is not a
  // usable checkout and must not produce dirty=false provenance.
  const source = tmp();
  fs.mkdirSync(source, { recursive: true });
  const parent = tmp();
  fs.mkdirSync(parent, { recursive: true });

  const git = (cwd, args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const init = (dir) => {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'provenance@test']);
    git(dir, ['config', 'user.name', 'Provenance Test']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
  };

  init(source);
  fs.writeFileSync(path.join(source, 'desktop.txt'), 'desktop\n');
  git(source, ['add', '.']);
  git(source, ['commit', '-qm', 'submodule']);

  init(parent);
  fs.writeFileSync(path.join(parent, 'root.txt'), 'root\n');
  git(parent, ['add', '.']);
  git(parent, ['commit', '-qm', 'root']);
  git(parent, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'papercusp-desktop']);
  git(parent, ['commit', '-qm', 'pin submodule']);

  assert.equal(emit({ gitRoot: parent }).gitDirty, false, 'a fully checked-out pinned submodule is clean');

  const submodulePath = path.join(parent, 'papercusp-desktop');
  fs.rmSync(submodulePath, { recursive: true, force: true });
  fs.mkdirSync(submodulePath, { recursive: true });

  const doc = emit({ gitRoot: parent });
  assert.equal(doc.gitDirty, true, 'an absent submodule checkout is not a clean snapshot');
});

test('clean build-start provenance survives cutter-authored dirt at emit time', () => {
  const repo = tmp();
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'provenance@test']);
  git(['config', 'user.name', 'Provenance Test']);
  git(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'staging.txt'), 'clean input\n');
  git(['add', '.']);
  git(['commit', '-qm', 'clean source']);
  const source = captureSource(repo);
  assert.equal(source.head, git(['rev-parse', 'HEAD']));
  assert.equal(source.dirty, 'false');

  // Model the real cutter: its preflight accepted the clean commit, then its
  // own version/env-sidecar staging changed a tracked file before emit.
  fs.writeFileSync(path.join(repo, 'staging.txt'), 'cutter-generated output\n');
  const doc = emit({
    gitRoot: repo,
    extraEnv: {
      PROVENANCE_SOURCE_GIT_HEAD: source.head,
      PROVENANCE_SOURCE_GIT_DIRTY: source.dirty,
    },
  });

  assert.equal(doc.gitHead, source.head);
  assert.equal(doc.gitDirty, false, 'the ship gate must describe the source accepted at cut start');
  assert.equal(doc.gitHeadAtEmit, source.head);
  assert.equal(doc.gitDirtyAtEmit, true, 'post-preflight cutter mutations stay visible as diagnostics');
});

test('direct sidecar producer captures provenance before dependency mutations', () => {
  const builder = fs.readFileSync(path.join(BIN, 'build-desktop-sidecar.sh'), 'utf8');
  const captureAt = builder.indexOf('emit-build-provenance.sh" --capture-source');
  const dependencyMutationAt = builder.indexOf('node scripts/npm-install-safe.mjs install');
  const emitAt = builder.lastIndexOf('bash "$HERE/emit-build-provenance.sh"');

  assert.ok(captureAt > 0, 'direct sidecar builder never captures its source phase boundary');
  assert.ok(
    dependencyMutationAt > captureAt,
    'source provenance must be captured before npm/dependency generation can dirty tracked build state',
  );
  assert.ok(emitAt > dependencyMutationAt, 'final provenance must still be emitted after artifact assembly');
  assert.match(builder, /export PROVENANCE_SOURCE_GIT_HEAD=/);
  assert.match(builder, /export PROVENANCE_SOURCE_GIT_DIRTY=/);
});

test('verify-provenance gates build-start dirt, not later cutter mutations', () => {
  const dir = tmp();
  const artifact = path.join(dir, 'Papercusp_GUI_0.0.0_amd64.AppImage');
  fs.writeFileSync(artifact, 'verified fixture bytes');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  const base = {
    version: '0.0.0',
    buildSha: 'abc1234',
    reused: false,
    gitHead: 'a'.repeat(40),
    gitDirty: false,
    gitHeadAtEmit: 'a'.repeat(40),
    gitDirtyAtEmit: true,
    artifacts: [{ name: path.basename(artifact), sha256, sig: false }],
  };
  const provPath = path.join(dir, 'build-provenance.json');
  fs.writeFileSync(provPath, JSON.stringify(base));

  const clean = spawnSync('bash', [VERIFIER, dir, '--json'], { encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr || clean.stdout);
  const cleanVerdict = JSON.parse(clean.stdout);
  assert.equal(cleanVerdict.gitDirtyOk, true);
  assert.equal(cleanVerdict.gitDirtyAtEmit, true);
  assert.match(cleanVerdict.notes.join('\n'), /cutter-authored post-preflight mutations/);

  fs.writeFileSync(provPath, JSON.stringify({ ...base, gitDirty: true }));
  const dirty = spawnSync('bash', [VERIFIER, dir, '--json'], { encoding: 'utf8' });
  assert.equal(dirty.status, 1, 'a genuinely dirty build-start source must still fail');
  assert.match(JSON.parse(dirty.stdout).failures.join('\n'), /release INPUT was dirty at cut start/);
});

test('same artifact bytes cannot silently acquire a different baked buildSha', () => {
  const out = tmp();
  const artifact = path.join(out, 'Papercusp_GUI_0.0.18_x64-setup.exe');
  fs.writeFileSync(artifact, 'finished Windows installer bytes');
  const run = (buildSha, extraEnv = {}) =>
    spawnSync('bash', [EMITTER, out, '0.0.18', buildSha, 'false', artifact], {
      encoding: 'utf8',
      env: { ...process.env, PROVENANCE_GIT_ROOT: path.join(BIN, '..'), ...extraEnv },
    });

  const original = run('2363b77a');
  assert.equal(original.status, 0, original.stderr || original.stdout);
  const provPath = path.join(out, 'build-provenance.json');
  // Recovery tooling may reserialize the record through jq before invoking the
  // emitter. The production 0.0.18 record was formatted this way, so matching
  // only the emitter's compact one-artifact-per-line layout misses the incident.
  const originalDoc = JSON.parse(fs.readFileSync(provPath, 'utf8'));
  fs.writeFileSync(provPath, `${JSON.stringify(originalDoc, null, 2)}\n`);
  const originalRecord = fs.readFileSync(provPath, 'utf8');

  const silentRewrite = run('2363b77a68dee8d79528a4a6a94321cc324ed2f7');
  assert.notEqual(silentRewrite.status, 0, 'same-byte identity rewrite unexpectedly passed');
  assert.match(silentRewrite.stderr, /refusing to rewrite their baked identity/);
  assert.match(silentRewrite.stderr, /api\/health reports the exact compiled string/);
  assert.equal(
    fs.readFileSync(provPath, 'utf8'),
    originalRecord,
    'a refused rewrite must leave the existing attestation byte-identical',
  );

  const staleCas = run('corrected-sha', { PROVENANCE_REPLACE_BUILD_SHA_FROM: 'not-the-current-sha' });
  assert.notEqual(staleCas.status, 0, 'a stale compare-and-swap identity repair unexpectedly passed');
  assert.equal(fs.readFileSync(provPath, 'utf8'), originalRecord);

  const repaired = run('corrected-sha', { PROVENANCE_REPLACE_BUILD_SHA_FROM: '2363b77a' });
  assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout);
  const repairedDoc = JSON.parse(fs.readFileSync(provPath, 'utf8'));
  assert.equal(repairedDoc.buildSha, 'corrected-sha');
  assert.deepEqual(
    { ...repairedDoc, buildSha: originalDoc.buildSha },
    originalDoc,
    'an identity repair must not re-attest git state, build time, artifacts, or any other history',
  );

  fs.writeFileSync(artifact, 'a genuinely new Windows installer build');
  const freshBuild = run('fresh-build-sha');
  assert.equal(freshBuild.status, 0, freshBuild.stderr || freshBuild.stdout);
  assert.equal(JSON.parse(fs.readFileSync(provPath, 'utf8')).buildSha, 'fresh-build-sha');
});

// ── STRUCTURAL: the record is only worth anything if the legs actually pass a dir ──

test('every leg that PACKS a sidecar names it; the salvage path deliberately does not', () => {
  const reads = (f) => fs.readFileSync(path.join(BIN, f), 'utf8');

  for (const leg of ['build-windows-cross.sh', 'build-mac-cross.sh']) {
    assert.match(
      reads(leg),
      /PROVENANCE_SIDECAR_DIR=/,
      `${leg} packs a sidecar into its artifacts, so it must record WHICH one — ` +
        'an emitter nobody hands a directory records null forever and the fix is inert',
    );
  }

  // release-local.sh's linux leg builds the sidecar it packs, so it names it. Its mac
  // block must NOT: those artifacts are built on the VM (a different sidecar) or
  // SALVAGED wholesale, so naming a local dir would stamp a record for bytes it never
  // packed — manufacturing the LABELED != PACKED claim this file exists to prevent.
  const releaseLocal = reads('release-local.sh');
  assert.match(releaseLocal, /PROVENANCE_SIDECAR_DIR="\$ROOT\/src-tauri\/sidecar"/);
  assert.equal(
    (releaseLocal.match(/PROVENANCE_SIDECAR_DIR=/g) || []).length,
    1,
    'exactly one leg in release-local.sh may name a sidecar dir (linux). If this fails ' +
      'because the mac block gained one, that is a fabricated provenance record, not a fix.',
  );
});

test('the future Darwin sidecar build receives release identity and source provenance', () => {
  const releaseLocal = fs.readFileSync(path.join(BIN, 'release-local.sh'), 'utf8');
  const start = releaseLocal.indexOf('echo "==> building darwin sidecar');
  const end = releaseLocal.indexOf('mac_env=(', start);
  assert.ok(start >= 0, 'release-local.sh is missing the Darwin sidecar build block');
  assert.ok(end > start, 'Darwin sidecar block no longer ends before mac_env');

  const block = releaseLocal.slice(start, end);
  const invocation = block.match(
    /env\s+\\\s*TARGET_OS=darwin[\s\S]*?bash "\$ROOT\/bin\/build-desktop-sidecar\.sh"/,
  );
  assert.ok(
    invocation,
    'the Darwin sidecar must be launched through the release-local env boundary',
  );

  const command = invocation[0];
  assert.match(command, /PAPERCUSP_SIDECAR_OUT="\$MAC_SIDECAR_DIR"/);
  assert.match(
    command,
    /PAPERCUSP_BUILD_SHA=\$BUILD_SHA/,
    'the sidecar emitter must receive the cut-start build SHA, not an empty default',
  );
  assert.match(command, /PAPERCUSP_BUILD_VERSION=\$VERSION/);
  assert.match(command, /PROVENANCE_SOURCE_GIT_HEAD=\$PROVENANCE_SOURCE_GIT_HEAD/);
  assert.match(command, /PROVENANCE_SOURCE_GIT_DIRTY=\$PROVENANCE_SOURCE_GIT_DIRTY/);
});
