// EI-26694099661942372: a source guard inside an UNUSED patch protects nothing.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../src-tauri');

function assertResolvedPatch(metadata, name, directory) {
  const packages = metadata.packages.filter((pkg) => pkg.name === name);
  assert.equal(packages.length, 1, `${name}: expected exactly one resolved package`);
  const pkg = packages[0];
  assert.equal(pkg.source, null, `${name}: registry package bypasses the safety patch`);
  assert.equal(fs.realpathSync(pkg.manifest_path),
    fs.realpathSync(path.join(directory, 'Cargo.toml')), `${name}: wrong path patch`);
  const reachable = new Set();
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const visit = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const dependency of nodes.get(id)?.dependencies ?? []) visit(dependency);
  };
  visit(metadata.resolve.root);
  assert(reachable.has(pkg.id), `${name}: patch is not reachable from the desktop app`);
}

test('declared native safety patches are selected in the locked Cargo graph', () => {
  const manifest = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
  const section = manifest.split('[patch.crates-io]')[1]?.split(/^\[/m)[0];
  assert(section, 'missing native safety patches');
  const patches = [...section.matchAll(/^([\w-]+)\s*=\s*\{\s*path\s*=\s*"([^"]+)"/gm)];
  assert(patches.length > 0, 'no path patches found');
  const result = spawnSync('cargo', ['metadata', '--manifest-path', path.join(root, 'Cargo.toml'),
    '--format-version=1', '--locked', '--offline'],
  { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const metadata = JSON.parse(result.stdout);
  for (const [, name, relative] of patches) {
    assertResolvedPatch(metadata, name, path.join(root, relative));
  }
  assert.doesNotMatch(result.stderr, /was not used in the crate graph/);
});

test('graph guard rejects a registry replacement even at the same version', () => {
  assert.throws(() => assertResolvedPatch({ packages: [
    { name: 'runtime', version: '2.11.4', source: 'registry+crates.io' },
  ] }, 'runtime', root), /registry package bypasses/);
});

test('graph guard rejects an unused local package', () => {
  const pkg = { id: 'local', name: 'runtime', source: null,
    manifest_path: path.join(root, 'Cargo.toml') };
  assert.throws(() => assertResolvedPatch({ packages: [pkg],
    resolve: { root: 'app', nodes: [{ id: 'app', dependencies: [] }] } },
  'runtime', root), /not reachable/);
});
