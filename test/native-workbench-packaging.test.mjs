import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
