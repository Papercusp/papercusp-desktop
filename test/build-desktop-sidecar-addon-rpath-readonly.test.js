// WI-6554700010009706 — bundle_linux_addon_libraries rewrites each native
// addon's RUNPATH with `patchelf --set-rpath`, which edits the ELF in place.
// A copy-mode release checkout (setup-release-checkout.sh --node-modules-copy
// copy) preserves npm's read-only 0444/0555 prebuilt addons, and the stage is
// only made writable at publish. The D-223 Server leg therefore died with
// `patchelf: open: Permission denied`; a dev tree's 0644 addons never showed it.
//
// The real helper runs here over a staged read-only addon with stub ELF tools.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');
const builderPath = process.env.PROBE_SCRIPT
  || path.join(desktopRoot, 'bin/build-desktop-sidecar.sh');
const builder = fs.readFileSync(builderPath, 'utf8');

/** Slice one top-level shell helper from the real builder. */
function extractFunction(name) {
  const lines = builder.split('\n');
  const start = lines.findIndex((line) => line === `${name}() {`);
  assert.ok(start >= 0, `${name}() is missing from build-desktop-sidecar.sh`);
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert.ok(end > start, `${name}() has no top-level closing brace`);
  return lines.slice(start, end + 1).join('\n');
}

const BUNDLE_LINUX_ADDON_LIBRARIES = extractFunction('bundle_linux_addon_libraries');

function writeExecutable(file, body) {
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

/**
 * Stage one sidecar with a single addon that NEEDs a library sitting beside it,
 * so the helper must rewrite that addon's RUNPATH. The stub patchelf appends to
 * the addon exactly as the real one opens it for writing, so a read-only addon
 * fails the same way the release build did.
 */
function makeFixture(addonMode) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-sidecar-rpath-'));
  const here = path.join(fixtureRoot, 'bin');
  const stubBin = path.join(fixtureRoot, 'stub-bin');
  const sidecar = path.join(fixtureRoot, 'sidecar');
  const addonDir = path.join(sidecar, 'node_modules/sodium-native/prebuilds/linux-x64');
  const addon = path.join(addonDir, 'sodium-native.node');
  const patchelfLog = path.join(fixtureRoot, 'patchelf.log');

  fs.mkdirSync(path.join(here, 'lib'), { recursive: true });
  fs.mkdirSync(stubBin, { recursive: true });
  fs.mkdirSync(addonDir, { recursive: true });
  fs.mkdirSync(path.join(sidecar, 'bin/.pg-real/lib'), { recursive: true });

  // The helper asks server-container.mjs for the ELF census; answer with ours.
  fs.writeFileSync(path.join(here, 'lib/server-container.mjs'), `
export async function sidecarInventory() {
  return { elfFiles: [${JSON.stringify(addon)}] };
}
`);
  fs.writeFileSync(path.join(addonDir, 'libsodium-companion.so.1'), 'library');
  fs.writeFileSync(addon, 'ELF addon bytes\n');
  fs.chmodSync(addon, addonMode);

  writeExecutable(path.join(stubBin, 'objdump'), [
    '#!/usr/bin/env bash',
    'echo "  NEEDED               libsodium-companion.so.1"',
    'echo "  NEEDED               libc.so.6"',
    '',
  ].join('\n'));
  writeExecutable(path.join(stubBin, 'ldd'), '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(path.join(stubBin, 'file'), '#!/usr/bin/env bash\necho "ELF 64-bit LSB shared object, x86-64"\n');
  writeExecutable(path.join(stubBin, 'patchelf'), [
    '#!/usr/bin/env bash',
    `printf '%s\\n' "$*" >> ${JSON.stringify(patchelfLog)}`,
    'if [[ "$1" == "--print-rpath" ]]; then echo ""; exit 0; fi',
    'if [[ "$1" == "--set-rpath" ]]; then',
    '  target="${@: -1}"',
    // Real patchelf opens the ELF for writing; reproduce that exact failure.
    '  printf "patched\\n" >> "$target" 2>/dev/null || { echo "patchelf: open: Permission denied" >&2; exit 1; }',
    '  exit 0',
    'fi',
    'exit 2',
    '',
  ].join('\n'));

  return { fixtureRoot, here, stubBin, sidecar, addon, patchelfLog };
}

function runHelper(fixture) {
  const script = `
set -u
TARGET_OS=linux
TARGET_ARCH=x64
HERE=${JSON.stringify(fixture.here)}
${BUNDLE_LINUX_ADDON_LIBRARIES}
bundle_linux_addon_libraries ${JSON.stringify(fixture.sidecar)}
`;
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fixture.stubBin}:${process.env.PATH}` },
  });
}

const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

test('a read-only (0444) native addon is patched and keeps its mode', {
  skip: runningAsRoot ? 'root bypasses file modes, so a read-only addon cannot fail here' : false,
}, (t) => {
  const fixture = makeFixture(0o444);
  t.after(() => {
    fs.chmodSync(fixture.addon, 0o644);
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  });

  const result = runHelper(fixture);
  assert.equal(result.status, 0, `helper failed:\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /Permission denied/);

  const calls = fs.readFileSync(fixture.patchelfLog, 'utf8');
  assert.match(calls, /^--set-rpath \$ORIGIN\/\. .*sodium-native\.node$/m,
    'the addon RUNPATH must point at its own directory');
  assert.equal(fs.readFileSync(fixture.addon, 'utf8'), 'ELF addon bytes\npatched\n',
    'the rewrite must actually land in the addon');
  assert.equal(fs.statSync(fixture.addon).mode & 0o777, 0o444,
    'the addon must leave the helper with its original read-only mode');
});

test('an already-writable addon is patched without a mode change', (t) => {
  const fixture = makeFixture(0o644);
  t.after(() => fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true }));

  const result = runHelper(fixture);
  assert.equal(result.status, 0, `helper failed:\n${result.stderr}`);
  assert.match(fs.readFileSync(fixture.patchelfLog, 'utf8'), /^--set-rpath /m);
  assert.equal(fs.statSync(fixture.addon).mode & 0o777, 0o644);
});
