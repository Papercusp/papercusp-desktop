// WI-36794 — the nightly channel is a SEPARATE INSTALLED APPLICATION, and the
// two facts that make it one are set in two different files by two different
// mechanisms:
//
//   * `src-tauri/tauri.nightly.conf.json` — the bundle identity (id + name +
//     icons). This is what makes the OS treat it as a second app.
//   * the baked `PAPERCUSP_CHANNEL` / `PAPERCUSP_CHANNEL_DATA_HOME` stamps —
//     what makes `workspaces::shared_sidecar_home()` open a distinct data home.
//
// Either one applied without the other is a build that writes to the wrong
// app's state, and the expensive direction is silent: an overlay with no stamp
// is a separate app pointed at `~/.papercusp` — the operator state of the
// desktop in daily use.
//
// `workspaces::verify_channel_identity()` refuses to boot on a disagreement at
// RUNTIME, but it can only do so because of a structural assumption about the
// identifier: that a channel bundle id is the base id plus ONE more dot segment,
// and that the segment IS the channel id. That assumption is what this file
// pins — if the overlay ever names itself `com.papercusp.nightly-gui`, the Rust
// guard silently starts reading `""` as the channel and stops guarding anything.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const CHANNEL = 'nightly';

function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', name), 'utf8'));
}

function releaseConfigSource() {
  return fs.readFileSync(path.join(root, 'bin', 'release.config.ts'), 'utf8');
}

/**
 * The base data-home directory name as `bin/release.config.ts` declares it —
 * read from the source rather than retyped, because the Rust chokepoint hard-
 * codes the same string and the two must not drift.
 */
function declaredBaseDataHomeDirName() {
  const m = releaseConfigSource().match(/dataHomeDirName:\s*'([^']+)'/);
  assert(m, 'PAPERCUSP_BASE_IDENTITY.dataHomeDirName not found in bin/release.config.ts');
  return m[1];
}

/** The `identitySuffix` the nightly channel declares in the registry. */
function declaredIdentitySuffix() {
  const src = releaseConfigSource();
  const block = src.slice(src.indexOf(`id: '${CHANNEL}'`));
  const m = block.match(/identitySuffix:\s*'([^']+)'/);
  assert(m, `channel '${CHANNEL}' declares no identitySuffix in bin/release.config.ts`);
  return m[1];
}

test('nightly overlay is the base identity plus exactly one channel segment', () => {
  const base = readConfig('tauri.conf.json');
  const nightly = readConfig('tauri.nightly.conf.json');
  const suffix = declaredIdentitySuffix();

  // The kit's formula (resolveChannelIdentity): `${base.bundleId}.${suffix}`.
  assert.equal(nightly.identifier, `${base.identifier}.${suffix}`);

  // The property workspaces::channel_suffix_of_identifier() actually reads: one
  // MORE dot segment than the base, and that segment IS the channel id. Asserted
  // structurally rather than by string equality, because the Rust side counts
  // segments — a rename that kept the same suffix but flattened the id
  // (`com.papercusp.gui-nightly`) would pass an equality check and defeat the
  // runtime guard.
  const baseSegs = base.identifier.split('.').filter(Boolean);
  const nightlySegs = nightly.identifier.split('.').filter(Boolean);
  assert.equal(nightlySegs.length, baseSegs.length + 1);
  assert.equal(nightlySegs[baseSegs.length], CHANNEL);
  assert.equal(baseSegs.length, 3, 'workspaces.rs BASE_IDENTIFIER_SEGMENTS assumes a 3-segment base id');
});

test('nightly overlay is visibly a different product, not a re-skin of the same one', () => {
  const base = readConfig('tauri.conf.json');
  const nightly = readConfig('tauri.nightly.conf.json');

  assert.notEqual(nightly.productName, base.productName);
  assert(nightly.productName.includes(base.productName), 'keep the base product name as a prefix so the two sort together');

  // A distinct icon SET, not a distinct icon LIST pointing at the same files —
  // two identically-iconed apps in a launcher is the failure users actually hit.
  const icons = nightly.bundle.icon;
  assert(Array.isArray(icons) && icons.length > 0, 'nightly overlay declares no icons');
  for (const rel of icons) {
    const p = path.join(root, 'src-tauri', rel);
    assert(fs.existsSync(p), `nightly icon missing on disk: ${rel}`);
  }
  const baseIcon = fs.readFileSync(path.join(root, 'src-tauri', 'icons', '128x128.png'));
  const nightlyIcon = fs.readFileSync(path.join(root, 'src-tauri', 'icons', 'nightly', '128x128.png'));
  assert(!baseIcon.equals(nightlyIcon), 'the nightly icon is byte-identical to the base icon');
});

test('nightly deb must not conflict with or replace the stable package', () => {
  // The whole point of a side-by-side channel is coexistence. `tauri.server.conf.json`
  // deliberately declares conflicts/replaces against papercusp-gui; copying that
  // pattern here would make installing nightly UNINSTALL the app in daily use.
  const nightly = readConfig('tauri.nightly.conf.json');
  const deb = nightly.bundle?.linux?.deb ?? {};
  assert.deepEqual(deb.conflicts ?? [], []);
  assert.deepEqual(deb.replaces ?? [], []);
});

test('the Rust chokepoint and the release config agree on the base data home', () => {
  // workspaces.rs hardcodes BASE_DATA_HOME_DIR_NAME; release.config.ts declares
  // PAPERCUSP_BASE_IDENTITY.dataHomeDirName. They are the same directory, in two
  // languages, and nothing else ties them together.
  const rs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'workspaces.rs'), 'utf8');
  const m = rs.match(/BASE_DATA_HOME_DIR_NAME:\s*&str\s*=\s*"([^"]+)"/);
  assert(m, 'BASE_DATA_HOME_DIR_NAME not found in src-tauri/src/workspaces.rs');
  assert.equal(m[1], declaredBaseDataHomeDirName());
});

// ---------------------------------------------------------------------------
// The recurrence guard for the build path that does not exist yet.
//
// Items 4 + 5 of WI-36794 (the daily cut, and a real bundle installed beside the
// working desktop) still have to be built. When they are, the build invocation
// MUST carry the channel stamps alongside the `--config` overlay — that is the
// single moment at which the two halves of the identity are joined, and the
// moment at which forgetting one is catastrophic and invisible.
//
// So the scan below is written now, while nothing matches it. A guard with no
// live subject is normally a guard nobody has tested, so `scanForUnstamped` is a
// pure function over (name, text) and is exercised against SYNTHETIC controls
// that keep it falsifiable regardless of what the tree happens to contain.
// ---------------------------------------------------------------------------

const OVERLAY = 'tauri.nightly.conf.json';

/**
 * Every line that applies the nightly overlay must also set both stamps.
 * Returns the offending lines (file + line number + text); empty means clean.
 */
function scanForUnstamped(files) {
  const bad = [];
  for (const { name, text } of files) {
    text.split('\n').forEach((line, i) => {
      if (!line.includes(OVERLAY)) return;
      const stamped =
        /PAPERCUSP_CHANNEL\s*=/.test(line) && /PAPERCUSP_CHANNEL_DATA_HOME\s*=/.test(line);
      if (!stamped) bad.push({ name, line: i + 1, text: line.trim() });
    });
  }
  return bad;
}

test('scanForUnstamped is falsifiable (permanent controls, never mutates the tree)', () => {
  const stamped = `PAPERCUSP_CHANNEL=nightly PAPERCUSP_CHANNEL_DATA_HOME=.papercusp-nightly tauri build --config src-tauri/${OVERLAY}`;
  const unstamped = `tauri build --config src-tauri/${OVERLAY}`;
  const halfStamped = `PAPERCUSP_CHANNEL=nightly tauri build --config src-tauri/${OVERLAY}`;

  assert.deepEqual(scanForUnstamped([{ name: 'ctl', text: stamped }]), []);
  assert.equal(scanForUnstamped([{ name: 'ctl', text: unstamped }]).length, 1);
  // The half-stamped case is the one the Rust guard turns into a refusal to
  // boot; catching it here means it never gets built in the first place.
  assert.equal(scanForUnstamped([{ name: 'ctl', text: halfStamped }]).length, 1);
});

test('no build path applies the nightly overlay without baking both channel stamps', () => {
  const dirs = [path.join(root, 'bin'), path.join(root, 'bin', 'lib')];
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(sh|ts|mjs|js)$/.test(entry.name)) continue;
      const p = path.join(dir, entry.name);
      files.push({ name: path.relative(root, p), text: fs.readFileSync(p, 'utf8') });
    }
  }
  assert(files.length > 0, 'scanned nothing — the scan roots moved, so a clean result would be meaningless');

  const bad = scanForUnstamped(files);
  assert.deepEqual(
    bad,
    [],
    `these apply ${OVERLAY} without baking PAPERCUSP_CHANNEL + PAPERCUSP_CHANNEL_DATA_HOME:\n` +
      bad.map((b) => `  ${b.name}:${b.line}  ${b.text}`).join('\n'),
  );
});
