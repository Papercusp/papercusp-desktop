import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
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
        assert.equal(result.count, 23);
        assert.equal(new Set(result.cases).size, result.count);
    });
