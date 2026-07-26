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

  // NOTE (WI-6075): 'sidecar/db-sql/*' is intentionally absent — the recursive
  // 'sidecar/**/*' already covers it. Verified in the shipped artifact, not
  // assumed: dpkg-deb -c on the gate deb lists ./usr/lib/<product>/sidecar/
  // db-sql/000-baseline.sql even though only the recursive glob is declared.
  const baseResources = base.bundle.resources;
  assert.deepEqual(baseResources, ['sidecar/**/*', 'resources/*']);
  assert(!baseResources.some((resource) => resource.includes('seed')), 'GUI/base resources must not include the multi-GB seed');

  // Tauri --config overwrites conflicting values, so the server override must
  // carry the complete resources list, not just the extra seed entry.
  assert.deepEqual(server.bundle.resources, [
    'sidecar/**/*',
    'resources/*',
    'seed/**/*',
  ]);
});

// WI-6075: the seed lives in exactly two overlays, never in the base config. The
// live-federation gate scavenges the deb built by bin/build-and-archive-deb.sh,
// so that build has to opt INTO the seed explicitly — otherwise the only way to
// keep the gate supplied is to put seed/**/* back in the base config, which is
// precisely the regression above. Guard the overlay so the split cannot quietly
// collapse again (it has already flapped three times).
test('gate overlay carries the seed explicitly, so the base config never has to', () => {
  const base = readConfig('tauri.conf.json');
  const gate = readConfig('tauri.gate.conf.json');

  // The overlay repeats `identifier` ONLY because the Tauri config schema marks
  // it required at top level (node_modules/@tauri-apps/cli/config.schema.json:
  // required: ['identifier']) — so the overlay stays valid on its own. It must
  // therefore stay EQUAL to the base identifier: this overlay is a resources
  // flavor of the GUI product, not a separate product like the server override.
  // If these ever diverge, the gate would silently build a different app id.
  assert.equal(gate.identifier, base.identifier, 'gate overlay must not fork the product identity — it only adds the seed');

  assert.deepEqual(gate.bundle.resources, [
    'sidecar/**/*',
    'resources/*',
    'seed/**/*',
  ], 'gate overlay must repeat the COMPLETE resources list — tauri --config overwrites, it does not merge');

  // Resolve `--config <token>` against the script's own simple VAR="..."
  // assignments, so the check follows the indirection instead of demanding an
  // inline literal (the script quite reasonably uses a variable).
  const script = fs.readFileSync(path.join(root, 'bin', 'build-and-archive-deb.sh'), 'utf8');
  const vars = new Map();
  for (const [, name, value] of script.matchAll(/^\s*([A-Z_][A-Z0-9_]*)="([^"\n]*)"/gm)) {
    if (!vars.has(name)) vars.set(name, value);
  }
  const configured = [...script.matchAll(/--config\s+"?(\S+?)"?(?:\s|$)/g)].map(([, token]) => {
    const varRef = token.match(/^\$\{?([A-Z_][A-Z0-9_]*)\}?$/);
    return varRef ? vars.get(varRef[1]) : token;
  });

  assert(
    configured.includes('src-tauri/tauri.gate.conf.json'),
    `build-and-archive-deb.sh must pass the gate overlay via --config, or the gate deb loses its seed (resolved --config values: ${JSON.stringify(configured)})`,
  );
});
