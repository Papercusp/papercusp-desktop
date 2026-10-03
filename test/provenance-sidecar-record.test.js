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
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { makeDesktopTestScratchDirSync } = require('./test-scratch.cjs');

const BIN = path.join(__dirname, '..', 'bin');
const EMITTER = path.join(BIN, 'emit-build-provenance.sh');
const VERIFIER = path.join(BIN, 'verify-provenance.sh');

function tmp() {
  return makeDesktopTestScratchDirSync('prov-sidecar-');
}

function startHealthFixtureServer() {
  const source = String.raw`
    const http = require('node:http');
    const server = http.createServer((request, response) => {
      const body = JSON.stringify({ sha: 'expected-health-sha' });
      const status = request.url === '/ok' ? 200 : request.url === '/redirect' ? 302 : 500;
      response.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      response.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      process.stdout.write(String(server.address().port) + '\n');
    });
  `;
  const child = spawn(process.execPath, ['-e', source], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`health fixture server did not start; stderr=${stderr}`));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const port = Number(stdout.trim());
      if (!settled && Number.isInteger(port) && port > 0) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, baseUrl: `http://127.0.0.1:${port}` });
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`health fixture server exited ${code}; stderr=${stderr}`));
      }
    });
  });
}

/** Run the real emitter; return the parsed build-provenance.json it wrote. */
function emit({ sidecarDir, gitRoot, artifactMtime, extraEnv = {} } = {}) {
  const out = path.join(tmp(), 'out');
  fs.mkdirSync(out, { recursive: true });
  const artifact = path.join(out, 'App_0.0.0_amd64.deb');
  fs.writeFileSync(artifact, 'fixture');
  if (artifactMtime) fs.utimesSync(artifact, artifactMtime, artifactMtime);

  const env = { ...process.env, PROVENANCE_GIT_ROOT: gitRoot || path.join(BIN, '..'), ...extraEnv };
  if (sidecarDir) env.PROVENANCE_SIDECAR_DIR = sidecarDir;

  const r = spawnSync('bash', [EMITTER, out, '0.0.0', 'testsha', 'false', artifact], {
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 0, `emitter exited ${r.status}: ${r.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(out, 'build-provenance.json'), 'utf8'));
}

function captureSource(gitRoot, manifestPath) {
  const args = [EMITTER, '--capture-source', gitRoot];
  if (manifestPath) args.push(manifestPath);
  const result = spawnSync('bash', args, {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `source capture exited ${result.status}: ${result.stderr}`);
  const fields = result.stdout.trim().split('\n');
  assert.equal(fields.length, 2, `source capture returned ${fields.length} fields`);
  assert.match(fields[0], /^[0-9a-f]{40}$/);
  assert.match(fields[1], /^(?:true|false)$/);
  return {
    head: fields[0],
    dirty: fields[1],
    manifest: manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined,
  };
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

test('emitting into a hard-linked sidecar clone cannot rewrite the source manifest inode', () => {
  const source = sidecarWithProvenance();
  const sourceManifest = path.join(source, 'build-provenance.json');
  const sourceBytes = fs.readFileSync(sourceManifest);
  const clone = tmp();
  const cloneManifest = path.join(clone, 'build-provenance.json');
  const cloneServe = path.join(clone, 'serve.mjs');
  fs.linkSync(sourceManifest, cloneManifest);
  fs.linkSync(path.join(source, 'serve.mjs'), cloneServe);
  assert.equal(
    fs.statSync(sourceManifest).ino,
    fs.statSync(cloneManifest).ino,
    'fixture must begin with one shared manifest inode',
  );

  // Model a private acceptance snapshot replacing just its freshly built
  // serve.mjs before re-emitting provenance. The source still owns the old
  // artifact and therefore must retain the old attestation byte-for-byte.
  fs.renameSync(cloneServe, path.join(clone, 'serve.previous.mjs'));
  fs.writeFileSync(cloneServe, 'new-sidecar-bytes');
  const emitted = spawnSync('bash', [EMITTER, clone, '0.0.0', 'new-sidecar-sha', 'false', cloneServe], {
    encoding: 'utf8',
    env: { ...process.env, PROVENANCE_GIT_ROOT: path.join(BIN, '..') },
  });
  assert.equal(emitted.status, 0, `clone provenance emit failed: ${emitted.stderr}`);

  assert.deepEqual(
    fs.readFileSync(sourceManifest),
    sourceBytes,
    'publishing clone provenance must not mutate its hard-linked source peer',
  );
  assert.notEqual(
    fs.statSync(sourceManifest).ino,
    fs.statSync(cloneManifest).ino,
    'atomic publication must give the clone its own manifest inode',
  );
  const cloneDoc = JSON.parse(fs.readFileSync(cloneManifest, 'utf8'));
  assert.equal(cloneDoc.buildSha, 'new-sidecar-sha');
  assert.equal(
    cloneDoc.artifacts[0].sha256,
    crypto.createHash('sha256').update('new-sidecar-bytes').digest('hex'),
  );
});

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

test('dirty build-start provenance content-binds source paths and each artifact clock', () => {
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
  const sourcePath = path.join(repo, 'src', 'main.rs');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, 'fn answer() -> u8 { 1 }\n');
  git(['add', '.']);
  git(['commit', '-qm', 'base source']);

  const capturedBytes = 'fn answer() -> u8 { 42 }\n';
  fs.writeFileSync(sourcePath, capturedBytes);
  fs.writeFileSync(path.join(repo, 'new-source.rs'), 'pub const NEW: bool = true;\n');
  const manifestPath = path.join(tmp(), 'dirty-source.json');
  const source = captureSource(repo, manifestPath);
  assert.equal(source.dirty, 'true');

  // Mutating after capture models the long build window. The manifest must keep
  // the exact bytes accepted at cut start, never silently re-read this later edit.
  fs.writeFileSync(sourcePath, 'fn answer() -> u8 { 99 }\n');
  const artifactMtime = new Date('2026-08-10T22:31:00Z');
  const doc = emit({
    gitRoot: repo,
    artifactMtime,
    extraEnv: {
      PROVENANCE_SOURCE_GIT_HEAD: source.head,
      PROVENANCE_SOURCE_GIT_DIRTY: source.dirty,
      PROVENANCE_SOURCE_DIRTY_MANIFEST: manifestPath,
    },
  });

  assert.equal(doc.dirtySource.status, 'captured');
  assert.equal(doc.dirtySource.repositories.length, 1);
  const files = new Map(doc.dirtySource.repositories[0].files.map((row) => [row.path, row]));
  assert.equal(files.get('src/main.rs').status, ' M');
  assert.equal(typeof files.get('src/main.rs').mtimeEpochSec, 'number');
  assert.match(files.get('src/main.rs').mtimeUtc, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    files.get('src/main.rs').sha256,
    crypto.createHash('sha256').update(capturedBytes).digest('hex'),
    'manifest must hash build-start content, not a later worktree mutation',
  );
  assert.equal(files.get('new-source.rs').status, '??');
  assert.match(files.get('new-source.rs').sha256, /^[0-9a-f]{64}$/);
  assert.equal(doc.artifacts[0].mtimeEpochSec, Math.floor(artifactMtime.getTime() / 1000));
  assert.equal(doc.artifacts[0].mtimeUtc, '2026-08-10T22:31:00Z');
  assert.equal(doc.artifacts[0].completedAtUtc, '2026-08-10T22:31:00Z');
  assert.notEqual(doc.artifacts[0].mtimeUtc, doc.builtAtUtc);
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
  assert.match(builder, /PROVENANCE_SOURCE_DIRTY_MANIFEST/);
});

test('release-audited sidecar fails closed on dirty or moving source before publish', () => {
  const builder = fs.readFileSync(path.join(BIN, 'build-desktop-sidecar.sh'), 'utf8');
  const dirtyGuardAt = builder.indexOf('release-audited sidecar requires a clean source tree');
  const publishGuardAt = builder.indexOf('release-audited sidecar source HEAD moved during build');
  const publishAt = builder.indexOf('mv "$SIDECAR_TMP_DIR" "$SIDECAR_FINAL_DIR"');

  assert.ok(dirtyGuardAt > 0, 'release-audited producer must reject a dirty cut-start source');
  assert.match(
    builder.slice(Math.max(0, dirtyGuardAt - 900), dirtyGuardAt + 500),
    /PROVENANCE_SOURCE_GIT_DIRTY.*!= "false"/s,
    'the dirty-source guard must fail closed rather than merely warn',
  );
  assert.ok(publishGuardAt > 0, 'release-audited producer must detect a source HEAD move');
  assert.ok(
    publishGuardAt < publishAt,
    'the source-HEAD guard must run before the temporary sidecar is atomically published',
  );
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
    artifacts: [{ name: path.basename(artifact), bytes: fs.statSync(artifact).size, sha256, sig: false }],
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

test('verify-provenance rejects missing or non-boolean gitDirty attestations', () => {
  const dir = tmp();
  const artifact = path.join(dir, 'Papercusp_GUI_0.0.0_amd64.AppImage');
  fs.writeFileSync(artifact, 'verified fixture bytes');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  const base = {
    version: '0.0.0',
    buildSha: 'abc1234',
    gitHead: 'a'.repeat(40),
    artifacts: [{ name: path.basename(artifact), bytes: fs.statSync(artifact).size, sha256, sig: false }],
  };
  const provPath = path.join(dir, 'build-provenance.json');
  const run = (doc, args = []) => {
    fs.writeFileSync(provPath, JSON.stringify(doc));
    return spawnSync('bash', [VERIFIER, dir, '--json', ...args], { encoding: 'utf8' });
  };

  for (const [label, fields] of [
    ['missing', {}],
    ['null', { gitDirty: null }],
    ['string', { gitDirty: 'false' }],
    ['number', { gitDirty: 0 }],
  ]) {
    const result = run({ ...base, ...fields });
    assert.equal(result.status, 1, `${label} gitDirty unexpectedly passed: ${result.stderr || result.stdout}`);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.gitDirtyOk, false, `${label} gitDirty was reported as clean`);
    assert.match(verdict.failures.join('\n'), /gitDirty must be the JSON boolean false/);
  }

  const explicitOverride = run({ ...base, gitDirty: true }, ['--allow-dirty']);
  assert.equal(explicitOverride.status, 0, explicitOverride.stderr || explicitOverride.stdout);
  assert.equal(JSON.parse(explicitOverride.stdout).gitDirtyOk, true);

  const malformedOverride = run({ ...base, gitDirty: 'false' }, ['--allow-dirty']);
  assert.equal(
    malformedOverride.status,
    1,
    '--allow-dirty must not convert a wrongly typed attestation into cleanliness proof',
  );
});

test('verify-provenance rejects missing or malformed release identity', () => {
  const dir = tmp();
  const artifact = path.join(dir, 'Papercusp_GUI_0.0.0_amd64.AppImage');
  fs.writeFileSync(artifact, 'verified fixture bytes');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  const base = {
    version: '0.0.0',
    buildSha: 'abc1234',
    gitHead: 'a'.repeat(40),
    gitDirty: false,
    artifacts: [{ name: path.basename(artifact), bytes: fs.statSync(artifact).size, sha256, sig: false }],
  };
  const provPath = path.join(dir, 'build-provenance.json');
  const run = (doc) => {
    fs.writeFileSync(provPath, JSON.stringify(doc));
    return spawnSync('bash', [VERIFIER, dir, '--json'], { encoding: 'utf8' });
  };

  // Positive control: a complete identity still passes without a health probe.
  const valid = run(base);
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);

  for (const [label, fields] of [
    ['missing version', { version: undefined }],
    ['null version', { version: null }],
    ['blank version', { version: '   ' }],
    ['missing buildSha', { buildSha: undefined }],
    ['null buildSha', { buildSha: null }],
    ['blank buildSha', { buildSha: '' }],
  ]) {
    const doc = { ...base, ...fields };
    if (fields.version === undefined) delete doc.version;
    if (fields.buildSha === undefined) delete doc.buildSha;
    const result = run(doc);
    assert.equal(result.status, 1, `${label} unexpectedly passed: ${result.stderr || result.stdout}`);
    const verdict = JSON.parse(result.stdout);
    const failures = verdict.failures.join('\n');
    if (Object.prototype.hasOwnProperty.call(fields, 'version')) {
      assert.match(failures, /version must be a non-empty string/);
    } else {
      assert.match(failures, /buildSha must be a non-empty string/);
    }
  }
});

test('verify-provenance rejects malformed artifact rows instead of certifying their bytes', () => {
  const dir = tmp();
  const artifact = path.join(dir, 'Papercusp_GUI_0.0.0_amd64.AppImage');
  const bytes = Buffer.from('verified fixture bytes');
  fs.writeFileSync(artifact, bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const validRow = {
    name: path.basename(artifact),
    bytes: bytes.length,
    sha256,
    sig: false,
  };
  const provPath = path.join(dir, 'build-provenance.json');
  const base = {
    version: '0.0.0',
    buildSha: 'abc1234',
    gitHead: 'a'.repeat(40),
    gitDirty: false,
  };
  const run = (artifacts) => {
    fs.writeFileSync(provPath, JSON.stringify({ ...base, artifacts }));
    return spawnSync('bash', [VERIFIER, dir, '--json'], { encoding: 'utf8' });
  };

  const valid = run([validRow]);
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.equal(JSON.parse(valid.stdout).artifacts[0].bytesOk, true);

  for (const [label, rows, expected] of [
    ['missing bytes', [{ ...validRow, bytes: undefined }], /bytes must be a non-negative integer/],
    ['wrong bytes', [{ ...validRow, bytes: bytes.length + 1 }], /bytes .* != recorded/],
    ['string sig', [{ ...validRow, sig: 'false' }], /sig must be a JSON boolean/],
    ['missing sig', [{ ...validRow, sig: undefined }], /sig must be a JSON boolean/],
    ['numeric sha256', [{ ...validRow, sha256: 123 }], /sha256 must be a 64-character hex string/],
    ['duplicate name', [validRow, { ...validRow }], /duplicate artifact row/],
  ]) {
    const result = run(rows);
    assert.equal(result.status, 1, `${label} unexpectedly passed: ${result.stderr || result.stdout}`);
    assert.match(JSON.parse(result.stdout).failures.join('\n'), expected);
  }

  const objectInsteadOfRows = run({ one: validRow });
  assert.equal(objectInsteadOfRows.status, 1, 'a non-array artifacts value unexpectedly passed');
  assert.match(
    JSON.parse(objectInsteadOfRows.stdout).failures.join('\n'),
    /artifacts must be an array/,
  );
});

test('verify-provenance rejects artifact names that escape ARTIFACT_DIR', () => {
  const dir = tmp();
  const artifact = path.join(dir, 'Papercusp_GUI_0.0.0_amd64.AppImage');
  fs.writeFileSync(artifact, 'verified fixture bytes');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  const outside = path.join(path.dirname(dir), `prov-outside-${path.basename(dir)}.bin`);
  // Byte-identical on purpose: before the fix, traversal/absolute/symlink names
  // all PASS. A different outside payload would fail on sha256 and never prove
  // that containment—rather than an incidental hash mismatch—is the guard.
  fs.writeFileSync(outside, 'verified fixture bytes');
  const provPath = path.join(dir, 'build-provenance.json');
  const run = (name) => {
    fs.writeFileSync(
      provPath,
      JSON.stringify({
        version: '0.0.0',
        buildSha: 'abc1234',
        gitHead: 'a'.repeat(40),
        gitDirty: false,
        artifacts: [{ name, bytes: fs.statSync(artifact).size, sha256, sig: false }],
      }),
    );
    return spawnSync('bash', [VERIFIER, dir, '--json'], { encoding: 'utf8' });
  };

  // Positive control: a normal in-root relative name remains valid.
  const valid = run(path.basename(artifact));
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);

  const traversal = run(`../${path.basename(outside)}`);
  assert.equal(traversal.status, 1, 'a parent traversal unexpectedly passed');
  assert.match(JSON.parse(traversal.stdout).failures.join('\n'), /unsafe path|outside ARTIFACT_DIR/);

  const absolute = run(outside);
  assert.equal(absolute.status, 1, 'an absolute artifact path unexpectedly passed');
  assert.match(JSON.parse(absolute.stdout).failures.join('\n'), /unsafe path/);

  const backslash = run('nested\\artifact.AppImage');
  assert.equal(backslash.status, 1, 'a Windows-style path unexpectedly passed');
  assert.match(JSON.parse(backslash.stdout).failures.join('\n'), /unsafe path/);

  // A relative symlink can also resolve outside the root; containment is checked
  // after resolution so this cannot smuggle arbitrary host bytes into a PASS.
  const link = path.join(dir, 'linked.AppImage');
  fs.symlinkSync(outside, link);
  const symlink = run(path.basename(link));
  assert.equal(symlink.status, 1, 'a symlink escaping ARTIFACT_DIR unexpectedly passed');
  assert.match(JSON.parse(symlink.stdout).failures.join('\n'), /outside ARTIFACT_DIR/);
});

test('verify-provenance rejects a matching health sha carried by an HTTP error response', async (t) => {
  const dir = tmp();
  const artifact = path.join(dir, 'Papercusp_GUI_0.0.0_amd64.AppImage');
  fs.writeFileSync(artifact, 'verified fixture bytes');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  fs.writeFileSync(path.join(dir, 'build-provenance.json'), JSON.stringify({
    version: '0.0.0',
    buildSha: 'expected-health-sha',
    gitHead: 'a'.repeat(40),
    gitDirty: false,
    artifacts: [{ name: path.basename(artifact), bytes: fs.statSync(artifact).size, sha256, sig: false }],
  }));

  const server = await startHealthFixtureServer();
  t.after(() => server.child.kill('SIGTERM'));

  for (const [pathName, status] of [['error', 500], ['redirect', 302]]) {
    const errorResponse = spawnSync(
      'bash',
      [VERIFIER, dir, '--health-url', `${server.baseUrl}/${pathName}`, '--json'],
      { encoding: 'utf8' },
    );
    assert.equal(errorResponse.status, 2, errorResponse.stderr || errorResponse.stdout);
    assert.match(errorResponse.stderr, new RegExp(`returned HTTP ${status}`));
  }

  const successResponse = spawnSync(
    'bash',
    [VERIFIER, dir, '--health-url', `${server.baseUrl}/ok`, '--json'],
    { encoding: 'utf8' },
  );
  assert.equal(successResponse.status, 0, successResponse.stderr || successResponse.stdout);
  assert.equal(JSON.parse(successResponse.stdout).healthMatch, true);
});

test('verify-provenance binds latest.json URLs to the release path and signed artifact', () => {
  const dir = tmp();
  const releaseBase = 'https://example.invalid/releases';
  const releaseTag = 'desktop-v0.0.0-alpha';
  const artifact = path.join(dir, 'Papercusp_GUI_0.0.0_amd64.AppImage');
  const spacedArtifact = path.join(dir, 'Papercusp GUI_0.0.0_amd64.AppImage');
  const fixtureBytes = Buffer.from('verified fixture bytes');
  fs.writeFileSync(artifact, fixtureBytes);
  fs.writeFileSync(spacedArtifact, fixtureBytes);
  const sha256 = crypto.createHash('sha256').update(fixtureBytes).digest('hex');

  // Build real Ed25519 signatures in Tauri's legacy `Ed` minisign shape and
  // pass them through the production signature verifier. Both artifacts carry
  // byte-identical payloads so the negative controls discriminate on URL
  // binding, never on an incidental content or signature mismatch.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const keyId = Buffer.from('0102030405060708', 'hex');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const publicBlock = Buffer.concat([Buffer.from('Ed'), keyId, publicDer.subarray(-32)]);
  const signatureFor = (file) => {
    const artifactSignature = crypto.sign(null, fs.readFileSync(file), privateKey);
    const signatureBlock = Buffer.concat([Buffer.from('Ed'), keyId, artifactSignature]);
    const signatureFile = Buffer.from(
      `untrusted comment: test signature\n${signatureBlock.toString('base64')}\n`,
    ).toString('base64');
    fs.writeFileSync(`${file}.sig`, signatureFile);
    return signatureFile;
  };
  const artifactSignature = signatureFor(artifact);
  const spacedArtifactSignature = signatureFor(spacedArtifact);

  const provenance = {
    version: '0.0.0',
    buildSha: 'abc1234',
    gitHead: 'a'.repeat(40),
    gitDirty: false,
    releaseHostSha256: crypto.createHash('sha256').update(releaseBase).digest('hex'),
    artifacts: [
      { name: path.basename(artifact), bytes: fixtureBytes.length, sha256, sig: true },
      { name: path.basename(spacedArtifact), bytes: fixtureBytes.length, sha256, sig: true },
    ],
  };
  fs.writeFileSync(path.join(dir, 'build-provenance.json'), JSON.stringify(provenance));
  const manifestPath = path.join(dir, 'latest.json');
  const run = (manifest) => {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    return spawnSync(
      'bash',
      [
        VERIFIER,
        dir,
        '--latest-json',
        manifestPath,
        '--pubkey',
        publicBlock.toString('base64'),
        '--json',
      ],
      { encoding: 'utf8' },
    );
  };

  for (const [label, manifest] of [
    ['missing', { version: '0.0.0', channel: 'alpha' }],
    ['empty', { version: '0.0.0', channel: 'alpha', platforms: {} }],
    ['null', { version: '0.0.0', channel: 'alpha', platforms: null }],
    ['array', { version: '0.0.0', channel: 'alpha', platforms: [] }],
  ]) {
    const result = run(manifest);
    assert.equal(result.status, 1, `${label} platforms unexpectedly passed: ${result.stderr || result.stdout}`);
    const verdict = JSON.parse(result.stdout);
    assert.match(verdict.failures.join('\n'), /non-empty platforms object/);
  }

  const manifestFor = (url, signature = artifactSignature) => ({
    version: '0.0.0',
    channel: 'alpha',
    platforms: {
      'linux-x86_64': {
        url,
        signature,
      },
    },
  });

  // Positive control: the canonical host + tag + exact artifact is accepted.
  const canonicalUrl = `${releaseBase}/${releaseTag}/${path.basename(artifact)}`;
  const valid = run(manifestFor(canonicalUrl));
  assert.equal(valid.status, 0, `valid manifest failed: ${valid.stderr || valid.stdout}`);
  assert.equal(JSON.parse(valid.stdout).manifest['linux-x86_64'].ok, true);

  // The artifact CDN is deliberately movable independently of the app's baked
  // manifest host. A host change with the SAME release suffix must remain valid.
  const movableCdn = run(
    manifestFor(`https://attacker.invalid/releases/${releaseTag}/${path.basename(artifact)}`),
  );
  assert.equal(movableCdn.status, 0, movableCdn.stderr || movableCdn.stdout);

  // The updater only resolves the canonical platform vocabulary. A byte- and
  // signature-identical artifact under an alias must fail closed instead of
  // certifying a manifest that every client silently ignores.
  for (const unsupportedKey of ['linux-x64', 'linux']) {
    const unsupported = run({
      ...manifestFor(canonicalUrl),
      platforms: {
        [unsupportedKey]: {
          url: canonicalUrl,
          signature: artifactSignature,
        },
      },
    });
    assert.equal(
      unsupported.status,
      1,
      `${unsupportedKey} manifest key unexpectedly passed: ${unsupported.stderr || unsupported.stdout}`,
    );
    assert.match(
      JSON.parse(unsupported.stdout).failures.join('\n'),
      /uses unsupported platform key/,
    );
    assert.equal(
      JSON.parse(unsupported.stdout).manifest[unsupportedKey].ok,
      false,
    );
  }

  // The old basename-only check returned PASS here. The bytes and signature are
  // unchanged, so only the stale release path can explain the rejection.
  const staleTag = run(
    manifestFor(`${releaseBase}/desktop-v9.9.9-alpha/${path.basename(artifact)}`),
  );
  assert.equal(staleTag.status, 1, 'a stale manifest release tag unexpectedly passed');
  assert.match(JSON.parse(staleTag.stdout).failures.join('\n'), /release tag/);

  // Generated macOS/Windows names contain spaces, encoded as %20 in the URL.
  // Decode the URL path once before matching it to the raw provenance name.
  const encodedName = run(
    manifestFor(
      `${releaseBase}/${releaseTag}/${encodeURIComponent(path.basename(spacedArtifact))}`,
      spacedArtifactSignature,
    ),
  );
  assert.equal(encodedName.status, 0, encodedName.stderr || encodedName.stdout);
  assert.equal(
    JSON.parse(encodedName.stdout).manifest['linux-x86_64'].url_basename,
    path.basename(spacedArtifact),
  );

  const literalSpace = run(
    manifestFor(`${releaseBase}/${releaseTag}/${path.basename(spacedArtifact)}`, spacedArtifactSignature),
  );
  assert.equal(literalSpace.status, 1, 'a literal-space URL unexpectedly passed');
  assert.match(JSON.parse(literalSpace.stdout).failures.join('\n'), /without whitespace/);

  const dotSegment = run(
    manifestFor(`${releaseBase}/${releaseTag}/../${path.basename(artifact)}`),
  );
  assert.equal(dotSegment.status, 1, 'a dot-segment URL unexpectedly passed');
  assert.match(JSON.parse(dotSegment.stdout).failures.join('\n'), /unsafe dot or separator|release tag/);

  const malformedEncoding = run(
    manifestFor(`${releaseBase}/${releaseTag}/%ZZ${path.basename(artifact)}`),
  );
  assert.equal(malformedEncoding.status, 1, 'a malformed percent-encoding unexpectedly passed');
  assert.match(JSON.parse(malformedEncoding.stdout).failures.join('\n'), /malformed percent-encoding/);

  const wrongVersion = run({
    ...manifestFor(canonicalUrl),
    version: '9.9.9',
  });
  assert.equal(wrongVersion.status, 1, 'a manifest/provenance version mismatch unexpectedly passed');
  assert.match(JSON.parse(wrongVersion.stdout).failures.join('\n'), /version .* does not match/);
});

test('verify-provenance binds canonical platform keys to compatible artifact families', () => {
  const dir = tmp();
  const releaseBase = 'https://example.invalid/releases';
  const releaseTag = 'desktop-v0.0.0-alpha';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const keyId = Buffer.from('0102030405060708', 'hex');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const publicBlock = Buffer.concat([Buffer.from('Ed'), keyId, publicDer.subarray(-32)]);

  const makeArtifact = (name, contents) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = Buffer.from(contents);
    fs.writeFileSync(file, bytes);
    const artifactSignature = crypto.sign(null, bytes, privateKey);
    const signatureBlock = Buffer.concat([Buffer.from('Ed'), keyId, artifactSignature]);
    const signature = Buffer.from(
      `untrusted comment: test signature\n${signatureBlock.toString('base64')}\n`,
    ).toString('base64');
    fs.writeFileSync(`${file}.sig`, signature);
    return {
      name,
      basename: path.basename(name),
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      signature,
    };
  };

  const artifacts = {
    linuxX86: makeArtifact(
      'Papercusp_GUI_0.0.0_amd64.AppImage',
      'signed Linux x86_64 fixture',
    ),
    linuxArm: makeArtifact(
      'aarch64/Papercusp_GUI_0.0.0_arm64.AppImage',
      'signed Linux aarch64 fixture',
    ),
    windows: makeArtifact(
      'Papercusp_GUI_0.0.0_x64-setup.exe',
      'signed Windows fixture',
    ),
    darwin: makeArtifact(
      'Papercusp_GUI_0.0.0_universal.app.tar.gz',
      'signed universal Darwin fixture',
    ),
  };

  fs.writeFileSync(
    path.join(dir, 'build-provenance.json'),
    JSON.stringify({
      version: '0.0.0',
      buildSha: 'abc1234',
      gitHead: 'a'.repeat(40),
      gitDirty: false,
      artifacts: Object.values(artifacts).map(({ name, bytes, sha256 }) => ({
        name,
        bytes,
        sha256,
        sig: true,
      })),
    }),
  );

  const manifestPath = path.join(dir, 'latest.json');
  const run = (platformKey, artifact) => {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: '0.0.0',
        channel: 'alpha',
        platforms: {
          [platformKey]: {
            signature: artifact.signature,
            url: `${releaseBase}/${releaseTag}/${encodeURIComponent(artifact.basename)}`,
          },
        },
      }),
    );
    return spawnSync(
      'bash',
      [
        VERIFIER,
        dir,
        '--latest-json',
        manifestPath,
        '--pubkey',
        publicBlock.toString('base64'),
        '--json',
      ],
      { encoding: 'utf8' },
    );
  };

  // Every canonical key/family pairing emitted by the producer is accepted.
  for (const [platformKey, artifact] of [
    ['linux-x86_64', artifacts.linuxX86],
    ['linux-aarch64', artifacts.linuxArm],
    ['windows-x86_64', artifacts.windows],
    ['darwin-x86_64', artifacts.darwin],
    ['darwin-aarch64', artifacts.darwin],
  ]) {
    const result = run(platformKey, artifact);
    assert.equal(result.status, 0, `${platformKey} positive control failed: ${result.stderr || result.stdout}`);
    assert.equal(JSON.parse(result.stdout).manifest[platformKey].ok, true);
  }

  // A valid signature is not enough when the updater key points at a different
  // OS/architecture. These controls isolate the key/family binding failure.
  for (const [platformKey, artifact] of [
    ['windows-x86_64', artifacts.linuxX86],
    ['linux-x86_64', artifacts.windows],
    ['linux-aarch64', artifacts.linuxX86],
    ['darwin-x86_64', artifacts.windows],
    ['darwin-aarch64', artifacts.linuxArm],
  ]) {
    const result = run(platformKey, artifact);
    assert.equal(result.status, 1, `${platformKey} cross-family control unexpectedly passed`);
    const verdict = JSON.parse(result.stdout);
    assert.match(verdict.failures.join('\n'), /incompatible with this platform key/);
    assert.equal(verdict.manifest[platformKey].ok, false);
  }
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
    /env\s+\\\s*TARGET_OS=darwin[\s\S]*?bash "\$ORCHESTRATOR_HERE\/build-desktop-sidecar\.sh"/,
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
  assert.match(command, /PROVENANCE_SOURCE_GIT_HEAD=\$EXPECTED_SOURCE_SHA/);
  assert.match(command, /PROVENANCE_SOURCE_GIT_DIRTY=\$PROVENANCE_SOURCE_GIT_DIRTY/);
});
