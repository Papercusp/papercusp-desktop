import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {stageNativeWorkbench, windowsWorkbenchFiles} from '../bin/package-native-workbench.mjs';

const root = resolve(import.meta.dirname, '..');
test('real Inno preserves every native Workbench resource and rejects an incomplete bundle', {
    skip: process.env.PAPERCUSP_TEST_REAL_INNO !== '1'
        ? 'native producer leg: select PAPERCUSP_TEST_REAL_INNO=1 and PAPERCUSP_INNOEXTRACT' : false,
    timeout: 180000,
}, () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workbench-inno-'));
    try {
        const source = join(fixture, 'native/windows'); mkdirSync(source, {recursive:true});
        for (const name of windowsWorkbenchFiles) copyFileSync(join(root, 'native/windows', name), join(source, name));
        const bundle = stageNativeWorkbench(fixture, {platform:'windows'});
        const prefix = process.env.PAPERCUSP_WINE_INNO_PREFIX || join(homedir(), '.papercusp/wine-inno');
        const compiler = process.env.PAPERCUSP_ISCC_EXE || join(prefix, 'drive_c/InnoSetup6/ISCC.exe');
        const extractor = process.env.PAPERCUSP_INNOEXTRACT;
        assert.ok(extractor, 'select the producer-compatible extractor explicitly');
        const env = {...process.env, WINEPREFIX:prefix, WINEDEBUG:'-all',
            WINEDLLOVERRIDES:'mscoree=d;mshtml=d;winemenubuilder.exe=d'};
        const run = (command, args) => {
            const result = spawnSync(command, args, {env, encoding:'utf8', timeout:60000});
            assert.ifError(result.error);
            return result;
        };
        const winpath = file => {
            const result = run('winepath', ['-w', file]);
            assert.equal(result.status, 0, result.stderr);
            return result.stdout.trim();
        };
        const iss = readFileSync(join(root, 'src-tauri/windows/inno/papercusp.iss'), 'utf8');
        const entries = iss.slice(iss.indexOf('[Files]'), iss.indexOf('#if AppId == "com.papercusp.gui"', iss.indexOf('[Files]')))
            .split('\n').filter(line => line.startsWith('Source: ') && line.includes('resources\\workbench-windows\\'));
        assert.equal(entries.length, windowsWorkbenchFiles.length, 'both roles need the complete native closure');
        const script = ['[Setup]', 'AppName=Workbench packaging fixture', 'AppVersion=1.0.0',
            'DefaultDirName={localappdata}\\WorkbenchPackagingFixture', 'PrivilegesRequired=lowest',
            'Uninstallable=no', 'Compression=none', 'OutputDir=out', 'OutputBaseFilename=workbench',
            '[Files]', ...entries].join('\n').replaceAll('{#BuildRoot}', winpath(join(fixture, 'src-tauri')));
        const scriptPath = join(fixture, 'workbench.iss');
        // This is input to the real maintained Inno compiler, not a model of its glob rules.
        writeFileSync(scriptPath, script);
        const compile = () => run('xvfb-run', ['-a', 'wine', compiler, winpath(scriptPath)]);
        const built = compile();
        assert.equal(built.status, 0, built.stdout + built.stderr);
        const destination = join(fixture, 'extracted');
        const unpacked = run(extractor, ['--silent', '--extract', '--output-dir', destination, join(fixture, 'out/workbench.exe')]);
        assert.equal(unpacked.status, 0, unpacked.stdout + unpacked.stderr);
        for (const name of windowsWorkbenchFiles)
            assert.deepEqual(readFileSync(join(destination, 'app/resources/workbench-windows', name)),
                readFileSync(join(root, 'native/windows', name)), name + ' must reach the installer byte-for-byte');
        rmSync(join(bundle.directory, 'WorkbenchLifecycle.psm1'));
        const incomplete = compile();
        assert.notEqual(incomplete.status, 0, 'ISCC must refuse a missing lifecycle module');
        assert.match(incomplete.stdout + incomplete.stderr, /WorkbenchLifecycle\.psm1/);
    } finally { rmSync(fixture, {recursive:true, force:true}); }
});

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
