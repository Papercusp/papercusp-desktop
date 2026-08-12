// WI-38142 — keep the sidecar dependency install aligned with the package
// names npm actually resolves. A stale @papercusp/operator selector fuzzily
// matched only operator-vite and omitted every apps/operator dependency.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const builder = fs.readFileSync(
  path.join(desktopRoot, 'bin/build-desktop-sidecar.sh'),
  'utf8',
);

test('sidecar dependency install names both source workspaces exactly', () => {
  const operatorName = require(path.join(repoRoot, 'apps/operator/package.json')).name;
  const viteName = require(path.join(repoRoot, 'apps/operator-vite/package.json')).name;

  assert.equal(operatorName, '@papercusp/web');
  assert.equal(viteName, '@papercusp/operator-vite');
  assert.match(builder, /--workspace=@papercusp\/web\s+--workspace=@papercusp\/operator-vite\)/);
  assert.doesNotMatch(builder, /--workspace=@papercusp\/operator(?:\s|$)/);
});

test('sidecar build closes direct linked-workspace peer contracts and hoists dockview v6', () => {
  const rootPackage = require(path.join(repoRoot, 'package.json'));
  const operatorPackage = require(path.join(repoRoot, 'apps/operator/package.json'));
  const vitePackage = require(path.join(repoRoot, 'apps/operator-vite/package.json'));
  const lock = require(path.join(repoRoot, 'package-lock.json'));
  const workspaceRoot = path.join(repoRoot, 'libs/generic/dock-workbench');
  const installedDeclarations = {
    ...operatorPackage.dependencies,
    ...operatorPackage.devDependencies,
    ...vitePackage.dependencies,
    ...vitePackage.devDependencies,
  };
  const missingPeerDeclarations = [];

  for (const [consumerRel, consumer] of [
    ['apps/operator', operatorPackage],
    ['apps/operator-vite', vitePackage],
  ]) {
    for (const [dep, spec] of Object.entries(consumer.dependencies || {})) {
      if (!spec.startsWith('file:')) continue;
      const dependencyRoot = path.resolve(repoRoot, consumerRel, spec.slice('file:'.length));
      const dependencyPackagePath = path.join(dependencyRoot, 'package.json');
      if (!fs.existsSync(dependencyPackagePath)) continue;
      const dependencyPackage = JSON.parse(fs.readFileSync(dependencyPackagePath, 'utf8'));
      for (const peer of Object.keys(dependencyPackage.peerDependencies || {})) {
        if (dependencyPackage.peerDependenciesMeta?.[peer]?.optional) continue;
        if (!(peer in installedDeclarations)) missingPeerDeclarations.push(`${dep} -> ${peer}`);
      }
    }
  }
  assert.deepEqual(missingPeerDeclarations, []);

  for (const peer of ['dockview', 'dockview-react']) {
    assert.equal(
      rootPackage.dependencies[peer],
      operatorPackage.dependencies[peer],
      `${peer} root constraint must stay aligned so the scoped install can hoist it`,
    );
    assert.match(
      lock.packages[`node_modules/${peer}`].version,
      /^6\./,
      `${peer} must be hoisted at the root on the operator v6 line`,
    );
    assert.equal(
      lock.packages[`apps/operator/node_modules/${peer}`],
      undefined,
      `${peer} must not be locked only beneath the consuming app`,
    );
    assert.doesNotThrow(
      () => require.resolve(peer, { paths: [workspaceRoot] }),
      `${peer} must resolve from the workspace realpath Vite uses`,
    );
  }

  assert.match(builder, /spec\.startsWith\("file:"\)/);
  assert.match(builder, /workspacePackage\.peerDependenciesMeta\?\.\[peer\]\?\.optional/);
  assert.match(builder, /createRequire\(workspacePackagePath\)/);
});

test('sidecar build resolves and verifies the repo-pinned Node runtime before npm install', () => {
  const runtimeStart = builder.indexOf('PAPERCUSP_REQUIRED_NODE_MAJOR=');
  const installStart = builder.indexOf('npm install --legacy-peer-deps');
  assert(runtimeStart >= 0, 'missing repo-pinned Node runtime selector');
  assert(installStart > runtimeStart, 'Node runtime selection must happen before npm install');

  const runtimeBlock = builder.slice(runtimeStart, installStart);
  assert.match(runtimeBlock, /REPO_ROOT\/\.nvmrc/);
  assert.match(runtimeBlock, /papercusp_node_major/);
  assert.match(runtimeBlock, /home\/linuxbrew\/\.linuxbrew\/bin\/node/);
  assert.match(runtimeBlock, /opt\/homebrew\/bin\/node/);
  assert.match(runtimeBlock, /\.nvm\/versions\/node/);
  assert.match(runtimeBlock, /export PATH="\$\(dirname "\$_selected_node"\):\$PATH"/);
  assert.match(runtimeBlock, /\[ "\$_node_major" -ge "\$PAPERCUSP_REQUIRED_NODE_MAJOR" \]/);
  assert.match(runtimeBlock, /ERROR: sidecar release build requires Node/);
});
