const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', name), 'utf8'));
}

test('Tauri seed bundle is server-only, not duplicated into the GUI bundle', () => {
  const base = readConfig('tauri.conf.json');
  const server = readConfig('tauri.server.conf.json');

  const baseResources = base.bundle.resources;
  assert.deepEqual(baseResources, ['sidecar/**/*', 'sidecar/db-sql/*', 'resources/*']);
  assert(!baseResources.some((resource) => resource.includes('seed')), 'GUI/base resources must not include the multi-GB seed');

  // Tauri --config overwrites conflicting values, so the server override must
  // carry the complete resources list, not just the extra seed entry.
  assert.deepEqual(server.bundle.resources, [
    'sidecar/**/*',
    'sidecar/db-sql/*',
    'resources/*',
    'seed/**/*',
  ]);
});
