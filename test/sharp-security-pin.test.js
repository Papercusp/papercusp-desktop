'use strict';
// GHSA-wq5f-xc86-pv6w: upstream sharp <0.35.5 embeds vulnerable librsvg.
// Keep the fix in the existing overrides/lock surface, not a scanner exemption.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const semver = require('semver');
const root = path.resolve(__dirname, '../..');
const floor = '0.35.5';

// Extend the existing packaged dependency security guard for the redirect advisories.
function verifyRedirects(pkg, lock) {
  const range = pkg.overrides?.['follow-redirects'];
  const minimum = typeof range === 'string' ? semver.minVersion(range) : null;
  assert(minimum && semver.gte(minimum.version, '1.16.1'), 'follow-redirects override permits the vulnerable range');
  const entries = Object.entries(lock.packages || {}).filter(([p]) => p.endsWith('/follow-redirects'));
  assert(entries.length > 0, 'lock must bind follow-redirects');
  for (const [p, entry] of entries) {
    assert(semver.valid(entry.version) && semver.gte(entry.version, '1.16.1'), `${p} pins vulnerable follow-redirects`);
    assert.match(entry.integrity || '', /^sha512-/, `${p} lacks registry integrity`);
  }
}

test('redirect security override and committed lock exclude both affected advisory ranges', () => {
  verifyRedirects(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')));
});

test('redirect security guard rejects a vulnerable override or lock and missing package', () => {
  const pkg = { overrides: { 'follow-redirects': '^1.16.1' } };
  const lock = { packages: { 'node_modules/follow-redirects': { version: '1.16.1', integrity: 'sha512-fixture' } } };
  verifyRedirects(pkg, lock);
  assert.throws(() => verifyRedirects({ overrides: { 'follow-redirects': '^1.16.0' } }, lock), /vulnerable range/);
  assert.throws(() => verifyRedirects(pkg, { packages: {} }), /must bind/);
  lock.packages['node_modules/follow-redirects'].version = '1.16.0';
  assert.throws(() => verifyRedirects(pkg, lock), /pins vulnerable/);
});

function verifyOverrides(pkg) {
  for (const range of [pkg.overrides?.sharp, pkg.overrides?.['@huggingface/transformers']?.sharp]) {
    assert.equal(typeof range, 'string', 'both existing Sharp override routes must be present');
    const minimum = semver.minVersion(range);
    assert(minimum && semver.gte(minimum.version, floor), `Sharp override ${range} permits the vulnerable range`);
  }
}

function verifyLock(lock) {
  const rows = Object.entries(lock.packages || {}).filter(([p]) => p.endsWith('/sharp'));
  assert(rows.length > 0, 'the committed lock must bind Sharp, not silently omit its runtime');
  for (const [p, entry] of rows) {
    assert(semver.valid(entry.version) && semver.gte(entry.version, floor), `${p} pins vulnerable Sharp ${entry.version}`);
    assert.match(entry.integrity || '', /^sha512-/, `${p} lacks immutable registry integrity`);
    for (const name of ['@img/sharp-linux-x64', '@img/sharp-darwin-x64', '@img/sharp-darwin-arm64']) {
      assert.equal(entry.optionalDependencies?.[name], entry.version, `${p} selects mismatched native Sharp ${name}`);
    }
  }
}

const safePackage = () => ({ overrides: { sharp: '^0.35.5', '@huggingface/transformers': { sharp: '^0.35.5' } } });
const safeLock = () => ({ packages: { 'node_modules/sharp': {
  version: floor, integrity: 'sha512-fixture', optionalDependencies: {
    '@img/sharp-linux-x64': floor, '@img/sharp-darwin-x64': floor, '@img/sharp-darwin-arm64': floor,
  },
} } });

test('canonical global and Transformers Sharp overrides exclude the affected range', () => {
  verifyOverrides(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')));
});
test('committed Sharp lock and native platform selectors bind a patched package', () => {
  verifyLock(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')));
});
test('actual installed Sharp loads fixed librsvg and processes an ordinary SVG', async () => {
  const sharp = require(path.join(root, 'node_modules/sharp'));
  assert(semver.gte(sharp.versions.sharp, floor), `installed Sharp ${sharp.versions.sharp} is still vulnerable`);
  assert(semver.valid(sharp.versions.rsvg) && semver.gte(sharp.versions.rsvg, '2.63.2'), `loaded librsvg ${sharp.versions.rsvg} predates the upstream fix`);
  const output = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')).png().toBuffer();
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 2); assert.equal(metadata.height, 2);
});
test('either broad legacy override is rejected, including the transitive Transformers route', () => {
  for (const nested of [false, true]) {
    const pkg = safePackage();
    if (nested) pkg.overrides['@huggingface/transformers'].sharp = '^0.35.0';
    else pkg.overrides.sharp = '^0.35.0';
    assert.throws(() => verifyOverrides(pkg), /permits the vulnerable range/);
  }
});
test('a stale vulnerable lock, missing runtime, or changed native selector is rejected', () => {
  const stale = safeLock(); stale.packages['node_modules/sharp'].version = '0.35.4';
  assert.throws(() => verifyLock(stale), /pins vulnerable/);
  assert.throws(() => verifyLock({ packages: {} }), /must bind Sharp/);
  const wrongNative = safeLock(); wrongNative.packages['node_modules/sharp'].optionalDependencies['@img/sharp-darwin-x64'] = '0.35.4';
  assert.throws(() => verifyLock(wrongNative), /mismatched native Sharp/);
  verifyOverrides(safePackage()); verifyLock(safeLock());
});
