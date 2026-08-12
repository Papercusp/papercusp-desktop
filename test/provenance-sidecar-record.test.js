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
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin');
const EMITTER = path.join(BIN, 'emit-build-provenance.sh');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prov-sidecar-'));
}

/** Run the real emitter; return the parsed build-provenance.json it wrote. */
function emit({ sidecarDir, gitRoot } = {}) {
  const out = path.join(tmp(), 'out');
  fs.mkdirSync(out, { recursive: true });
  const artifact = path.join(out, 'App_0.0.0_amd64.deb');
  fs.writeFileSync(artifact, 'fixture');

  const env = { ...process.env, PROVENANCE_GIT_ROOT: gitRoot || path.join(BIN, '..') };
  if (sidecarDir) env.PROVENANCE_SIDECAR_DIR = sidecarDir;

  const r = spawnSync('bash', [EMITTER, out, '0.0.0', 'testsha', 'false', artifact], {
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 0, `emitter exited ${r.status}: ${r.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(out, 'build-provenance.json'), 'utf8'));
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
