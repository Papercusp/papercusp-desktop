import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {stageNativeWorkbench, windowsWorkbenchFiles} from '../bin/package-native-workbench.mjs';

const desktop = resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function withWindowsSource(run) {
    const root = mkdtempSync(join(tmpdir(), 'workbench-packaging-'));
    const source = join(root, 'native/windows');
    try {
        cpSync(join(desktop, 'native/windows'), source, {recursive:true});
        run(root, source);
    } finally { rmSync(root, {recursive:true, force:true}); }
}

// Inspect actual output bytes, including files outside the packager's allowlist.
function inventory(directory, prefix = '') {
    const files = {};
    for (const entry of readdirSync(join(directory, prefix), {withFileTypes:true})) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) Object.assign(files, inventory(directory, name + '/'));
        else files[name] = hash(readFileSync(join(directory, name)));
    }
    return files;
}

test('Windows staging removes obsolete files and inventories the exact output closure', () => withWindowsSource((root, source) => {
    const previous = stageNativeWorkbench(root, {platform:'windows'});
    writeFileSync(join(previous.directory, 'obsolete.ps1'), 'previous generation');
    mkdirSync(join(previous.directory, 'obsolete'));
    writeFileSync(join(previous.directory, 'obsolete/payload.dll'), 'unlisted nested payload');
    writeFileSync(join(previous.directory, 'lib/obsolete.dll'), 'previous dependency');
    writeFileSync(join(source, 'PuiReadBridge.cs'), 'new source generation');

    const staged = stageNativeWorkbench(root, {platform:'win32'});
    assert.deepEqual(Object.keys(staged.files), windowsWorkbenchFiles);
    assert.deepEqual(inventory(staged.directory), staged.files);
    for (const name of windowsWorkbenchFiles)
        assert.deepEqual(readFileSync(join(staged.directory, name)), readFileSync(join(source, name)));
}));

test('Windows staging preserves the prior complete output when a later source file is missing', () => withWindowsSource((root, source) => {
    const previous = stageNativeWorkbench(root, {platform:'windows'});
    const before = inventory(previous.directory);
    writeFileSync(join(source, 'PuiReadBridge.cs'), 'new source generation');
    rmSync(join(source, 'WorkbenchLifecycle.psm1'));

    assert.throws(() => stageNativeWorkbench(root, {platform:'windows'}), /ENOENT/);
    assert.deepEqual(inventory(previous.directory), before);
}));

test('Windows staging preserves the prior output on dependency mismatch or an unlisted dependency', () => withWindowsSource((root, source) => {
    const previous = stageNativeWorkbench(root, {platform:'windows'});
    const before = inventory(previous.directory);
    const dependency = join(source, 'lib/System.Memory.dll');
    const original = readFileSync(dependency);
    writeFileSync(join(source, 'PuiReadBridge.cs'), 'new source generation');
    writeFileSync(dependency, 'wrong assembly');
    assert.throws(() => stageNativeWorkbench(root, {platform:'windows'}), /dependency hash mismatch/);
    assert.deepEqual(inventory(previous.directory), before);

    writeFileSync(dependency, original);
    const manifestPath = join(source, 'dependencies.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.packages.push({file:'lib/unlisted.dll', sha256:hash(Buffer.from('unlisted'))});
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => stageNativeWorkbench(root, {platform:'windows'}), /Unpackaged Workbench dependency/);
    assert.deepEqual(inventory(previous.directory), before);
}));

test('Windows packaging CLI inventories installer payload bytes and refuses missing or mismatched inputs', () => withWindowsSource((root, source) => {
    const command = () => spawnSync(process.execPath,
        [join(desktop, 'bin/package-native-workbench.mjs'), '--stage-bundle', root, 'windows'],
        {encoding:'utf8', timeout:30000});
    // The installer is an independent consumer of the packager's closure. Derive
    // its expected payload names without importing the production allowlist.
    const installer = readFileSync(join(desktop, 'src-tauri/windows/inno/papercusp.iss'), 'utf8');
    const expected = [...installer.matchAll(/^Source: "\{#BuildRoot\}\\resources\\workbench-windows\\([^"]+)"/gm)]
        .map(match => match[1].replaceAll('\\', '/')).sort();
    assert.ok(expected.length > 0, 'the real installer must declare Workbench payloads');

    const initial = command();
    assert.equal(initial.error, undefined);
    assert.equal(initial.status, 0, initial.stderr);
    const receipt = JSON.parse(initial.stdout);
    assert.equal(receipt.platform, 'windows');
    assert.equal(receipt.directory, join(root, 'src-tauri/resources/workbench-windows'));
    assert.deepEqual(Object.keys(receipt.files).sort(), expected);
    assert.deepEqual(inventory(receipt.directory), receipt.files);
    assert.deepEqual(Object.keys(receipt).sort(), ['directory', 'files', 'platform']);
    // This receipt describes packaging bytes. It carries no installed/native
    // acceptance, signed artifact, login, or three-OS qualification assertion.
    for (const name of expected)
        assert.equal(receipt.files[name], hash(readFileSync(join(source, name))));

    writeFileSync(join(receipt.directory, 'unlisted.dll'), 'stale output');
    const refreshed = command();
    assert.equal(refreshed.status, 0, refreshed.stderr);
    assert.deepEqual(inventory(receipt.directory), receipt.files);

    const missingPath = join(source, 'WorkbenchLifecycle.psm1');
    const saved = readFileSync(missingPath);
    rmSync(missingPath);
    const missing = command();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /ENOENT.*WorkbenchLifecycle\.psm1/);
    assert.equal(missing.stdout, '');
    assert.deepEqual(inventory(receipt.directory), receipt.files);

    writeFileSync(missingPath, saved);
    writeFileSync(join(source, 'lib/System.Memory.dll'), 'mismatched payload');
    const mismatch = command();
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /dependency hash mismatch: lib\/System\.Memory\.dll/);
    assert.equal(mismatch.stdout, '');
    assert.deepEqual(inventory(receipt.directory), receipt.files);
}));
