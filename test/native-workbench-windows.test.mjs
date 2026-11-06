import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {stageNativeWorkbench, windowsWorkbenchFiles} from '../bin/package-native-workbench.mjs';

const root = resolve(import.meta.dirname, '..');
test('Windows Workbench packaging stages the complete native source closure and refuses missing inputs', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workbench-windows-package-'));
    try {
        const source = join(fixture, 'native/windows'); mkdirSync(source, {recursive:true});
        for (const name of windowsWorkbenchFiles) copyFileSync(join(root, 'native/windows', name), join(source, name));
        const bundle = stageNativeWorkbench(fixture, {platform:'windows'});
        assert.equal(bundle.platform, 'windows');
        assert.deepEqual(Object.keys(bundle.files), windowsWorkbenchFiles);
        for (const [name, hash] of Object.entries(bundle.files))
            assert.equal(createHash('sha256').update(readFileSync(join(bundle.directory, name))).digest('hex'), hash);
        rmSync(join(source, 'WorkbenchLifecycle.psm1'));
        assert.throws(() => stageNativeWorkbench(fixture, {platform:'windows'}), /ENOENT/);
    } finally { rmSync(fixture, {recursive:true, force:true}); }
});

test('Windows per-account login lifecycle preserves shortcuts and explicit disable through upgrades',
    {skip:process.platform !== 'win32', timeout:60000}, () => {
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-lifecycle.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows')],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true);
        assert.equal(result.count, 22);
        assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows actual resident lifecycle and native settings work in the signed-in account',
    {skip:process.platform !== 'win32', timeout:60000}, () => {
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'lifecycle', '-Interactive'],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true);
        assert.equal(result.resident, true);
        assert.equal(result.count, 32);
        assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows native read adapter preserves canonical envelopes and reaps failed/cancelled helpers',
    {skip: process.platform !== 'win32', timeout: 60000}, () => {
        const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-bridge.ps1'),
            '-BridgeSource', resolve(root, 'native/windows/PuiReadBridge.cs')],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true);
        assert.equal(result.platform, 'windows');
        assert.equal(result.count, 12);
        assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows native Workbench checks the window station before creating its resident host',
    {skip: process.platform !== 'win32', timeout: 60000}, () => {
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'preflight'],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true);
        assert.equal(result.phase, 'preflight');
        assert.equal(result.count, 1);
    });

test('Windows resident Workbench uses canonical identities, native shortcut ownership and retained WPF tool windows',
    {skip: process.platform !== 'win32', timeout: 60000}, () => {
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Interactive'],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true);
        assert.equal(result.platform, 'windows');
        assert.equal(result.phase, 'all');
        assert.equal(result.interactiveDesktop, true);
        assert.ok(result.processSessionId > 0);
        assert.equal(result.count, 42);
        assert.equal(new Set(result.cases).size, result.count);
    });
