'use strict';

// EI-27096956663669253 — the signed GUI AppImage embedded an unpinned,
// unverified type-2 runtime that appimagetool downloaded from
// AppImage/type2-runtime's moving 'continuous' tag at build time. The runtime is
// now vendored, pinned by sha256, always passed with --runtime-file, and the
// packaged bytes are checked to carry it before signing. These tests pin each
// of those properties against the real files, and each one fails if its
// property regresses.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DESK = path.join(__dirname, '..');
const LIB = path.join(DESK, 'bin', 'lib', 'appimage-runtime.sh');
// The *_SUBJECT overrides let scripts/mutation-probe.sh point these guards at a
// mutated copy. The tracked files are never mutated.
const VERIFIER =
  process.env.APPIMAGE_RUNTIME_VERIFIER_SUBJECT || path.join(DESK, 'bin', 'lib', 'appimage-runtime-embedded.py');
const VENDORED = path.join(DESK, 'vendor', 'appimage-runtime', 'runtime-x86_64');
const BUILD = fs.readFileSync(
  process.env.APPIMAGE_RUNTIME_BUILD_SUBJECT || path.join(DESK, 'bin', 'build-appimage.sh'),
  'utf8',
);
const RELEASE_LOCAL = fs.readFileSync(path.join(DESK, 'bin', 'release-local.sh'), 'utf8');
const LIB_SRC = fs.readFileSync(LIB, 'utf8');

function pinnedSha() {
  const match = LIB_SRC.match(/^PAPERCUSP_APPIMAGE_RUNTIME_SHA256=([0-9a-f]{64})$/m);
  assert.ok(match, 'appimage-runtime.sh must pin a 64-hex sha256');
  return match[1];
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function resolveRuntime(env = {}) {
  return spawnSync('bash', ['-c', `. ${JSON.stringify(LIB)} && papercusp_appimage_runtime_path`], {
    encoding: 'utf8',
    env: { ...process.env, LDAI_RUNTIME_FILE: '', ...env },
  });
}

function verify(appimage, runtime = VENDORED, expected = pinnedSha()) {
  const result = spawnSync('python3', ['-I', VERIFIER, '--expected-sha256', expected, runtime, appimage], {
    encoding: 'utf8',
  });
  return { status: result.status, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

// The .digest_md5 section of the vendored runtime, read from its own ELF64
// section header table (independently of the verifier's parser).
function digestSection(elf) {
  const shoff = Number(elf.readBigUInt64LE(0x28));
  const shentsize = elf.readUInt16LE(0x3a);
  const shnum = elf.readUInt16LE(0x3c);
  const shstrndx = elf.readUInt16LE(0x3e);
  const strtab = Number(elf.readBigUInt64LE(shoff + shstrndx * shentsize + 0x18));
  for (let i = 0; i < shnum; i += 1) {
    const base = shoff + i * shentsize;
    const nameAt = strtab + elf.readUInt32LE(base);
    const name = elf.subarray(nameAt, elf.indexOf(0, nameAt)).toString('ascii');
    if (name === '.digest_md5') {
      return { start: Number(elf.readBigUInt64LE(base + 0x18)), size: Number(elf.readBigUInt64LE(base + 0x20)) };
    }
  }
  throw new Error('vendored runtime has no .digest_md5 section');
}

function withTmp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-runtime-pin-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// A synthetic AppImage shaped like appimagetool's output: the runtime, then a
// squashfs payload starting with its magic.
function fakeAppImage(root, runtimeBytes, { payloadMagic = 'hsqs', mutate } = {}) {
  const bytes = Buffer.concat([Buffer.from(runtimeBytes), Buffer.from(`${payloadMagic}payload`)]);
  if (mutate) mutate(bytes);
  const file = path.join(root, 'fixture.AppImage');
  fs.writeFileSync(file, bytes);
  return file;
}

test('the vendored runtime is exactly the pinned bytes', () => {
  assert.equal(sha256(fs.readFileSync(VENDORED)), pinnedSha());
});

test('the pin names a reviewed upstream commit, and no build script fetches a runtime', () => {
  assert.match(LIB_SRC, /^PAPERCUSP_APPIMAGE_RUNTIME_UPSTREAM='AppImage\/type2-runtime@[0-9a-f]{7,40} /m);
  for (const [name, src] of [['build-appimage.sh', BUILD], ['appimage-runtime.sh', LIB_SRC]]) {
    assert.doesNotMatch(src, /type2-runtime\/releases\/download/, `${name} must not download a runtime`);
    assert.doesNotMatch(src, /\b(curl|wget)\b[^\n]*runtime/i, `${name} must not fetch a runtime`);
  }
});

test('runtime resolution returns the vendored file and fails closed on a different one', () => {
  const ok = resolveRuntime();
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(fs.realpathSync(ok.stdout.trim()), fs.realpathSync(VENDORED));

  withTmp((root) => {
    const tampered = path.join(root, 'runtime-x86_64');
    const bytes = fs.readFileSync(VENDORED);
    bytes[200] ^= 0xff;
    fs.writeFileSync(tampered, bytes);
    const refused = resolveRuntime({ LDAI_RUNTIME_FILE: tampered });
    assert.notEqual(refused.status, 0, 'a runtime that does not match the pin must be refused');
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /refusing to package an unreviewed runtime/);

    const copy = path.join(root, 'relocated-runtime');
    fs.copyFileSync(VENDORED, copy);
    const relocated = resolveRuntime({ LDAI_RUNTIME_FILE: copy });
    assert.equal(relocated.status, 0, 'an identical relocated copy is still the pinned runtime');
    assert.equal(relocated.stdout.trim(), copy);

    const missing = resolveRuntime({ LDAI_RUNTIME_FILE: path.join(root, 'absent') });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /pinned AppImage runtime not found/);
  });
});

test('the embedded-runtime check accepts packer-filled sections and nothing else', () => {
  const runtime = fs.readFileSync(VENDORED);
  const digest = digestSection(runtime);
  withTmp((root) => {
    const good = fakeAppImage(root, runtime, {
      mutate: (b) => b.fill(0xab, digest.start, digest.start + digest.size),
    });
    const accepted = verify(good);
    assert.equal(accepted.status, 0, JSON.stringify(accepted.json));
    assert.equal(accepted.json.embeddedMatchesPin, true);
    assert.equal(accepted.json.mismatchedBytes, 0);
    assert.ok(accepted.json.maskedSections.includes('.digest_md5'));

    const outside = fakeAppImage(root, runtime, { mutate: (b) => { b[digest.start - 1] ^= 0x01; } });
    const changed = verify(outside);
    assert.equal(changed.status, 1);
    assert.equal(changed.json.embeddedMatchesPin, false);
    assert.equal(changed.json.mismatchedBytes, 1);

    const shifted = fakeAppImage(root, runtime, { payloadMagic: 'xxxx' });
    const misaligned = verify(shifted);
    assert.equal(misaligned.status, 1, 'the payload must start exactly where the pinned runtime ends');
    assert.equal(misaligned.json.payloadMagicAtRuntimeEnd, false);

    const truncated = path.join(root, 'short.AppImage');
    fs.writeFileSync(truncated, runtime.subarray(0, 1024));
    assert.equal(verify(truncated).status, 1);

    assert.equal(verify(good, VENDORED, '0'.repeat(64)).status, 2, 'a runtime that is not the pin is unusable input');
  });
});

test('build-appimage.sh resolves the pin early and checks the packaged bytes before signing', () => {
  const resolveAt = BUILD.indexOf('APPIMAGE_RUNTIME="$(papercusp_appimage_runtime_path)" || exit 1');
  const packEchoAt = BUILD.indexOf('==> packaging with appimagetool');
  const packAt = BUILD.indexOf('run_appimage_tool_isolated "$PLUGIN" "$OUT" "$APPDIR" "$APPIMAGE_RUNTIME"');
  const checkAt = BUILD.indexOf('lib/appimage-runtime-embedded.py');
  const signAt = BUILD.indexOf('tauri signer sign "$OUT"');
  assert.ok(resolveAt > 0, 'the build must resolve the pinned runtime');
  assert.ok(resolveAt < packEchoAt, 'the pin must be resolved before packaging starts');
  assert.ok(packAt > 0, 'the packer must receive the resolved runtime');
  assert.ok(checkAt > packAt && checkAt < signAt, 'the embedded runtime must be verified after packing and before signing');
  assert.match(BUILD, /--runtime-file "\$runtime_file" "\$appdir" "\$output"/);
  assert.doesNotMatch(BUILD, /runtime_args/, 'passing --runtime-file must not be conditional');
});

test('the Linux leg feeds the embedded-runtime verdict to the provenance emitter', () => {
  const fnStart = RELEASE_LOCAL.indexOf('emit_linux_build_provenance() {');
  const fnEnd = RELEASE_LOCAL.indexOf('\n}\n', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart, 'release-local.sh must define emit_linux_build_provenance');
  const fn = RELEASE_LOCAL.slice(fnStart, fnEnd);
  assert.match(fn, /appimage-runtime-embedded\.py/);
  assert.match(fn, /PROVENANCE_APPIMAGE_RUNTIME="\$appimage_runtime"/);
});

test('the emitter records appimageRuntime only when the Linux leg supplies it', () => {
  const runtime = fs.readFileSync(VENDORED);
  withTmp((root) => {
    const appimage = fakeAppImage(root, runtime);
    const verdict = spawnSync('python3', ['-I', VERIFIER, '--expected-sha256', pinnedSha(), VENDORED, appimage], {
      encoding: 'utf8',
    }).stdout.trim();

    const emit = (extraEnv) => {
      const out = fs.mkdtempSync(path.join(root, 'prov-'));
      const artifact = path.join(out, 'App_0.0.0_amd64.deb');
      fs.writeFileSync(artifact, 'fixture');
      const env = { ...process.env, PROVENANCE_GIT_ROOT: DESK, ...extraEnv };
      if (!('PROVENANCE_APPIMAGE_RUNTIME' in extraEnv)) delete env.PROVENANCE_APPIMAGE_RUNTIME;
      const r = spawnSync('bash', [path.join(DESK, 'bin', 'emit-build-provenance.sh'), out, '0.0.0', 'testsha', 'false', artifact], {
        encoding: 'utf8',
        env,
      });
      assert.equal(r.status, 0, `emitter exited ${r.status}: ${r.stderr}`);
      return JSON.parse(fs.readFileSync(path.join(out, 'build-provenance.json'), 'utf8'));
    };

    const recorded = emit({ PROVENANCE_APPIMAGE_RUNTIME: verdict });
    assert.equal(recorded.appimageRuntime.pinnedSha256, pinnedSha());
    assert.equal(recorded.appimageRuntime.embeddedMatchesPin, true);

    const otherLeg = emit({});
    assert.equal('appimageRuntime' in otherLeg, false, 'legs without an AppImage must stay byte-unchanged');
  });
});
