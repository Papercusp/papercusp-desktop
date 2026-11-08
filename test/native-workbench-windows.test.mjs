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
        assert.equal(result.count, 35);
        assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows actual resident lifecycle and native settings work in the signed-in account',
    {skip:process.platform !== 'win32', timeout:180000}, () => {
        const contract = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'lifecycle', '-BudgetOnly'],
        {encoding:'utf8', timeout:10000, windowsHide:true});
        assert.equal(contract.status, 0, contract.stderr || contract.stdout || String(contract.error));
        const budget = JSON.parse(contract.stdout.trim());
        assert.deepEqual(budget.controllerOperations, ['Install', 'Install', 'Settings', 'Run', 'Enable', 'Disable', 'Uninstall']);
        assert.equal(budget.fixtureTimeoutMs, budget.baseTimeoutMs + budget.controllerOperations.length * budget.controllerTimeoutMs + 2 * budget.settingsTimeoutMs);
        assert.ok(budget.clientTimeoutMs > budget.fixtureTimeoutMs && budget.clientTimeoutMs < 180000);
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'lifecycle', '-Interactive'],
        {encoding:'utf8', timeout:budget.clientTimeoutMs, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true);
        assert.equal(result.resident, true);
        assert.equal(result.count, 45);
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
        assert.equal(result.count, 16);
        assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows native Papercup transport and state preserve streaming, replay, drafts and conversation isolation',
    {skip:process.platform !== 'win32', timeout:60000}, () => {
        const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-bridge.ps1'),
            '-BridgeSource', resolve(root, 'native/windows/PuiReadBridge.cs'), '-Phase', 'chat'],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true); assert.equal(result.phase, 'chat');
        assert.ok(result.count >= 40);
        assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows native Accounts controls preserve exact identity, confirmed state and independent axes',
    {skip:process.platform !== 'win32', timeout:60000}, () => {
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'accounts', '-Interactive'],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true);
        assert.equal(result.phase, 'accounts');
        assert.equal(result.interactiveDesktop, true);
        assert.equal(result.count, 16);
        assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows native Goals controls confirm actions and preserve server state and degraded outcomes',
    {skip:process.platform !== 'win32', timeout:60000}, () => {
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'goals', '-Interactive'],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true); assert.equal(result.phase, 'goals');
        assert.equal(result.interactiveDesktop, true);
        assert.ok(result.count >= 15);
        assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows Organizer arranges exact canonical groups within each desktop and retains failure receipts',
    {skip:process.platform !== 'win32', timeout:60000}, () => {
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'organizer', '-Interactive'],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true); assert.equal(result.phase, 'organizer');
        assert.equal(result.interactiveDesktop, true);
        assert.ok(result.count >= 30);
        assert.equal(new Set(result.cases).size, result.count);
        assert.deepEqual(result.organizerRuns.map(run => run.group), ['plan', 'fleet', 'goal']);
        for (const run of result.organizerRuns) {
            assert.deepEqual(run.receipts.map(row => row.Status), ['moved', 'moved', 'unsupported', 'offline', 'failed']);
            for (const row of run.receipts.filter(row => row.Status === 'moved')) {
                assert.ok(row.Desktop && row.Monitor);
                for (const key of ['X', 'Y', 'Width', 'Height'])
                    assert.ok(Math.abs(row.Requested[key] - row.Observed[key]) <= 2);
            }
        }
    });

test('Windows Inbox freezes visible confirmations, reconciles saved runs and retains native lifecycle',
    {skip:process.platform !== 'win32', timeout:60000}, () => {
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'inbox', '-Interactive'],
        {encoding:'utf8', timeout:55000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true); assert.equal(result.phase, 'inbox');
        assert.equal(result.interactiveDesktop, true);
        assert.ok(result.count >= 30);
        assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows standalone PUI starts before any operator request', {
    skip: process.platform !== 'win32' || process.env.PAPERCUSP_TEST_REAL_PUI !== '1'
        ? 'native Windows leg: select PAPERCUSP_TEST_REAL_PUI=1 and PAPERCUSP_TEST_PUI_EXE' : false,
    timeout: 30000,
}, () => {
    assert.ok(process.env.PAPERCUSP_TEST_PUI_EXE, 'PAPERCUSP_TEST_PUI_EXE');
    const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', resolve(root, 'test/fixtures/native-workbench-windows-bridge.ps1'),
        '-BridgeSource', resolve(root, 'native/windows/PuiReadBridge.cs'), '-Phase', 'startup',
        '-PuiExecutable', process.env.PAPERCUSP_TEST_PUI_EXE],
    {encoding:'utf8', timeout:25000, windowsHide:true});
    assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.ok, true); assert.equal(result.phase, 'startup');
    assert.equal(result.count, 2); assert.equal(new Set(result.cases).size, result.count);
    assert.match(result.puiSha256, /^[a-f0-9]{64}$/);
});

test('Windows interactive fixture retains failure diagnostics and terminates its timed out child',
    {skip:process.platform !== 'win32', timeout:120000}, () => {
        const contract = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'fixture-diagnostics', '-BudgetOnly'],
        {encoding:'utf8', timeout:10000, windowsHide:true});
        assert.equal(contract.status, 0, contract.stderr || contract.stdout || String(contract.error));
        const budget = JSON.parse(contract.stdout.trim());
        assert.deepEqual(budget.children.map(child => child.phase), ['fixture-failure', 'fixture-timeout']);
        assert.equal(budget.fixtureTimeoutMs, budget.children.reduce((sum, child) => sum + child.clientTimeoutMs, 10000));
        assert.ok(budget.clientTimeoutMs > budget.fixtureTimeoutMs && budget.clientTimeoutMs < 120000);
        const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
            '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'fixture-diagnostics'],
        {encoding:'utf8', timeout:budget.clientTimeoutMs, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true); assert.equal(result.phase, 'fixture-diagnostics');
        assert.equal(result.count, 19); assert.equal(new Set(result.cases).size, result.count);
    });

test('Windows native environment refusal oracle distinguishes commands and rejects success, unrelated errors and timeouts', {
    skip: process.platform !== 'win32', timeout:60000,
}, () => {
    const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
        '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'environment-refusal'],
    {encoding:'utf8', timeout:55000, windowsHide:true});
    assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.ok, true); assert.equal(result.phase, 'environment-refusal');
    assert.equal(result.count, 7); assert.equal(new Set(result.cases).size, result.count);
});

test('Windows actual PUI renders canonical Inbox and rejects a changed workspace before run control', {
    skip: process.platform !== 'win32' || process.env.PAPERCUSP_TEST_REAL_PUI !== '1'
        ? 'native Windows leg: select current PUI with explicit operator/workspace/plan' : false,
    timeout: 120000,
}, () => {
    for (const key of ['PAPERCUSP_TEST_PUI_EXE', 'PAPERCUSP_TEST_OPERATOR_URL',
        'PAPERCUSP_TEST_WORKSPACE', 'PAPERCUSP_TEST_WORKBENCH_PLAN']) assert.ok(process.env[key], key);
    const run = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', resolve(root, 'test/fixtures/native-workbench-windows-host.ps1'),
        '-SourceDirectory', resolve(root, 'native/windows'), '-Phase', 'operator-inbox', '-Interactive',
        '-PuiExecutable', process.env.PAPERCUSP_TEST_PUI_EXE, '-OperatorUrl', process.env.PAPERCUSP_TEST_OPERATOR_URL,
        '-ExpectedWorkspace', process.env.PAPERCUSP_TEST_WORKSPACE, '-ExpectedPlan', process.env.PAPERCUSP_TEST_WORKBENCH_PLAN],
    {encoding:'utf8', timeout:110000, windowsHide:true});
    assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.ok, true); assert.equal(result.phase, 'operator-inbox');
    assert.equal(result.interactiveDesktop, true);
    assert.equal(result.count, 12); assert.equal(new Set(result.cases).size, result.count);
});

for (const fixture of ['bridge', 'host']) {
    test('Windows actual PUI and canonical operator read integration: ' + fixture, {
        skip: process.platform !== 'win32' || process.env.PAPERCUSP_TEST_REAL_PUI !== '1'
            ? 'native Windows leg: select PAPERCUSP_TEST_REAL_PUI=1 with explicit PUI/operator/workspace/plan' : false,
        timeout: 120000,
    }, () => {
        for (const key of ['PAPERCUSP_TEST_PUI_EXE', 'PAPERCUSP_TEST_OPERATOR_URL',
            'PAPERCUSP_TEST_WORKSPACE', 'PAPERCUSP_TEST_WORKBENCH_PLAN']) assert.ok(process.env[key], key);
        const args = ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', resolve(root, 'test/fixtures/native-workbench-windows-' + fixture + '.ps1'),
            '-Phase', 'operator', '-PuiExecutable', process.env.PAPERCUSP_TEST_PUI_EXE,
            '-OperatorUrl', process.env.PAPERCUSP_TEST_OPERATOR_URL,
            '-ExpectedWorkspace', process.env.PAPERCUSP_TEST_WORKSPACE];
        if (fixture === 'bridge') args.push('-BridgeSource', resolve(root, 'native/windows/PuiReadBridge.cs'));
        else args.push('-SourceDirectory', resolve(root, 'native/windows'),
            '-ExpectedPlan', process.env.PAPERCUSP_TEST_WORKBENCH_PLAN, '-Interactive');
        if (fixture === 'host' && process.env.PAPERCUSP_TEST_GOAL)
            args.push('-ExpectedGoal', process.env.PAPERCUSP_TEST_GOAL);
        const run = spawnSync('powershell.exe', args, {encoding:'utf8', timeout:110000, windowsHide:true});
        assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
        const result = JSON.parse(run.stdout.trim());
        assert.equal(result.ok, true); assert.equal(result.phase, 'operator');
        assert.equal(result.count, fixture === 'bridge' ? 6 : process.env.PAPERCUSP_TEST_GOAL ? 16 : 11);
        assert.equal(new Set(result.cases).size, result.count);
    });
}

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
