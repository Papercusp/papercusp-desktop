// WI-38142 — keep the sidecar dependency install aligned with the package
// names npm actually resolves. A stale @papercusp/operator selector fuzzily
// matched only operator-vite and omitted every apps/operator dependency.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const { builtinModules, createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const builder = fs.readFileSync(
  path.join(desktopRoot, 'bin/build-desktop-sidecar.sh'),
  'utf8',
);

test('sidecar dependency install includes both source workspaces with exact names', () => {
  const operatorName = require(path.join(repoRoot, 'apps/operator/package.json')).name;
  const viteName = require(path.join(repoRoot, 'apps/operator-vite/package.json')).name;

  assert.equal(operatorName, '@papercusp/web');
  assert.equal(viteName, '@papercusp/operator-vite');
  const installStart = builder.indexOf(
    '(cd "$REPO_ROOT" && npm install --legacy-peer-deps',
  );
  const installEnd = builder.indexOf(
    ')\n\n# POST-INSTALL RUNTIME BUILDS',
    installStart,
  );
  assert(installStart >= 0, 'missing scoped sidecar dependency install');
  assert(installEnd > installStart, 'could not isolate scoped sidecar dependency install');
  const install = builder.slice(installStart, installEnd).replace(/\\\r?\n/g, ' ');

  assert.match(install, /--workspace=@papercusp\/web(?:\s|$)/);
  assert.match(install, /--workspace=@papercusp\/operator-vite(?:\s|$)/);
  assert.doesNotMatch(install, /--workspace=@papercusp\/operator(?:\s|$)/);
});

test('Debian removal tears down only verified Papercusp process ownership', () => {
  const baseConfig = require(path.join(desktopRoot, 'src-tauri/tauri.conf.json'));
  const serverConfig = require(path.join(desktopRoot, 'src-tauri/tauri.server.conf.json'));
  const preRemovePath = path.join(desktopRoot, 'src-tauri/deb/preremove.sh');
  const preRemove = fs.readFileSync(preRemovePath, 'utf8');

  assert.equal(baseConfig.bundle.linux.deb.preRemoveScript, 'deb/preremove.sh');
  // The Server overlay intentionally inherits the base Debian maintainer
  // scripts; adding a second script here would let the two bundles drift.
  assert.equal(serverConfig.bundle.linux.deb.preRemoveScript, undefined);
  assert.equal(childProcess.spawnSync('sh', ['-n', preRemovePath]).status, 0);
  assert.match(preRemove, /PAPERCUSP_PREREMOVE_PROC_ROOT/);
  assert.match(preRemove, /PAPERCUSP_PREREMOVE_HOME_ROOT/);
  assert.match(preRemove, /operator\.json/);
  assert.match(preRemove, /processIdentity/);
  assert.match(preRemove, /linux:%s:%s/);
  assert.match(preRemove, /serve\.mjs\*\|\*serve\.ts\*/);
  assert.match(preRemove, /hono-host\.mjs\*\|\*hono-host\.ts\*/);
  assert.match(preRemove, /proc_pgid/);
  assert.match(preRemove, /\[ "\$\(proc_pgid "\$pid"\)" = "\$pid" \]/);
  assert.match(preRemove, /kill -TERM -- "-\$operator_pid"/);
  assert.match(preRemove, /kill -KILL -- "-\$operator_pid"/);
  assert.match(preRemove, /is_operator_authority_valid "\$operator_pid" "\$operator_identity"/);
  assert.match(preRemove, /is_packaged_desktop/);
  assert.match(preRemove, /kill -TERM "\$pid"/);
  assert.match(preRemove, /kill -KILL "\$pid"/);
});

test('sidecar ships the standalone project-history generator with the shared ESM banner', () => {
  const postinstall = fs.readFileSync(
    path.join(desktopRoot, 'src-tauri/deb/postinstall.sh'),
    'utf8',
  );

  assert.match(builder, /libs\/papercusp\/packages\/cli\/src\/project-history-entry\.ts/);
  assert.match(builder, /scripts\/project-history\.mjs/);
  assert.match(builder, /--banner:js="\$HOST_BANNER"/);
  assert.match(
    postinstall,
    /project-history\) shift; exec "\$SC\/bin\/node" "\$SC\/scripts\/project-history\.mjs"/, 
  );
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

test('sidecar source union declares every bare runtime import in operator-core', () => {
  const manifests = [
    require(path.join(repoRoot, 'packages/operator-core/package.json')),
    require(path.join(repoRoot, 'apps/operator/package.json')),
    require(path.join(repoRoot, 'apps/operator-vite/package.json')),
  ];
  const declared = new Set(
    manifests.flatMap((manifest) => [
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.devDependencies || {}),
      ...Object.keys(manifest.optionalDependencies || {}),
      ...Object.keys(manifest.peerDependencies || {}),
    ]),
  );
  const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
  const missing = new Map();
  const packageName = (specifier) =>
    specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
  const inspectSpecifier = (specifier, file) => {
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      specifier.startsWith('node:') ||
      builtins.has(specifier.split('/')[0])
    ) return;
    const dependency = packageName(specifier);
    if (declared.has(dependency)) return;
    if (!missing.has(dependency)) missing.set(dependency, new Set());
    missing.get(dependency).add(path.relative(repoRoot, file));
  };
  const visitDirectory = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['dist', 'node_modules'].includes(entry.name)) visitDirectory(file);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(test|spec)\.[^.]+$/.test(entry.name)) continue;
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visitNode = (node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            inspectSpecifier(node.moduleSpecifier.text, file);
          }
        } else if (
          ts.isCallExpression(node) &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
          inspectSpecifier(node.arguments[0].text, file);
        }
        ts.forEachChild(node, visitNode);
      };
      visitNode(source);
    }
  };

  visitDirectory(path.join(repoRoot, 'packages/operator-core/lib'));
  assert.deepEqual(
    [...missing].map(([dependency, files]) => [dependency, [...files].sort()]).sort(),
    [],
  );
});

test('sidecar server bundle declares DBOS telemetry runtime requirements', () => {
  const rootPackage = require(path.join(repoRoot, 'package.json'));
  const operatorPackagePath = path.join(repoRoot, 'apps/operator/package.json');
  const operatorPackage = require(operatorPackagePath);
  const lock = require(path.join(repoRoot, 'package-lock.json'));
  const requireFromOperator = createRequire(operatorPackagePath);

  // @dbos-inc/dbos-sdk's telemetry module requires these packages at runtime,
  // but its published manifest does not declare them. The root only carried
  // them as devDependencies, so the release builder's scoped workspace install
  // pruned them before esbuild followed the server graph. Keep the bundle's
  // actual runtime contract on the installed app workspace.
  for (const dependency of ['winston', 'winston-transport']) {
    assert.equal(
      operatorPackage.dependencies[dependency],
      rootPackage.devDependencies[dependency],
      `${dependency} must remain a production dependency of the installed operator workspace`,
    );
    assert.equal(
      lock.packages[`node_modules/${dependency}`].dev,
      undefined,
      `${dependency} must not be locked as dev-only`,
    );
    assert.doesNotThrow(
      () => requireFromOperator.resolve(dependency),
      `${dependency} must resolve from the operator workspace used by the sidecar server bundle`,
    );
  }
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
