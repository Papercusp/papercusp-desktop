import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn, spawnSync} from 'node:child_process';
import {appendFileSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {stageNativeWorkbench} from '../bin/package-native-workbench.mjs';
import {processGroupLifetime} from '@papercusp/operator-core/lib/fleet/process-group-lifetime';
import {linuxProcStateFromStat} from '@papercusp/operator-core/lib/process-identity';

const root = resolve(import.meta.dirname, '..');
const packagePath = join(root, 'src-tauri/macos-term-shim');
const swift = process.env.SWIFT || 'swift';
const swiftAvailable = spawnSync(swift, ['--version'], {encoding:'utf8', timeout:10000}).status === 0;

async function withSwiftFixture(prefix, action) {
    const scratch = mkdtempSync(join(tmpdir(), prefix));
    try {
        const result = await action(scratch);
        rmSync(scratch, {recursive:true, force:true});
        return result;
    } catch (error) {
        writeFileSync(join(scratch, 'failure.json'), JSON.stringify({error:String(error), stack:error.stack}, null, 2) + '\n');
        console.error('SWIFT_NATIVE_FAILURE_EVIDENCE ' + scratch);
        throw error;
    }
}

// Reuse the shared process-group exit fence: a closed Swift driver alone does
// not prove its compiler helpers stopped. Keep the deadline until that fence.
async function runSwift(command, args, scratch, timeoutMs) {
    const startedAt = Date.now(), timings = {};
    const child = spawn(command, args, {detached:process.platform !== 'win32', stdio:['ignore', 'pipe', 'pipe']});
    child.once('spawn', () => { timings.spawnMs = Date.now() - startedAt; });
    child.once('exit', () => { timings.exitMs = Date.now() - startedAt; });
    let stdout = '', stderr = '', error = null, groupExited = false;
    const lifetime = processGroupLifetime(child, message => appendFileSync(join(scratch, 'cleanup.log'), message + '\n'));
    for (const [stream, file, capture] of [
        [child.stdout, 'stdout.log', data => { stdout = (stdout + data).slice(-1024 * 1024); }],
        [child.stderr, 'stderr.log', data => { stderr = (stderr + data).slice(-1024 * 1024); }],
    ]) {
        writeFileSync(join(scratch, file), '');
        stream.on('data', data => { appendFileSync(join(scratch, file), data); capture(data); });
    }
    const closed = new Promise(resolveResult => {
        child.once('error', cause => { error = cause; });
        child.once('close', (status, signal) => { timings.closeMs = Date.now() - startedAt; resolveResult({status, signal}); });
    });
    let drain;
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => {
        timings.deadlineMs = Date.now() - startedAt;
        error ||= new Error('Swift process-group deadline exceeded');
        lifetime.signal('SIGKILL');
        drain = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); }, 3000);
    }, timeoutMs);
    let result;
    try {
        result = await closed;
        if (child.pid !== undefined) {
            await lifetime.waitForExit({timeoutMs:Math.max(1, deadline - Date.now() + 3500)});
            groupExited = true;
            timings.groupExitMs = Date.now() - startedAt;
        }
    } catch (cause) {
        error ||= cause;
        lifetime.signal('SIGKILL');
    } finally {
        clearTimeout(timer); clearTimeout(drain);
    }
    const receipt = {...result, command, args, pid:child.pid, groupExited, timeoutMs, timings,
        error:error ? {message:error.message, code:error.code, stack:error.stack} : null, stdout, stderr};
    writeFileSync(join(scratch, 'process.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
}

for (const leader of ['running', 'exited']) test('Swift harness reaps compiler descendants and retains evidence with leader ' + leader,
    {skip:process.platform === 'win32', timeout:15000}, async () => {
        let retained;
        try {
            await assert.rejects(withSwiftFixture('workbench-swift-harness-', async scratch => {
                retained = scratch;
                const grandchild = 'setInterval(()=>{},100);process.send("ready");';
                const driver = `const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','ignore','ignore','ipc']});
child.once('message',()=>{require('node:fs').writeFileSync(${JSON.stringify('CHILD_RECEIPT')},String(child.pid));
console.log('compiler started');console.error('compiler diagnostic');
${leader === 'exited' ? 'process.exit(0);' : 'setInterval(()=>{},100);'}});`;
                const result = await runSwift(process.execPath, ['-e', driver.replace('CHILD_RECEIPT', join(scratch, 'compiler.pid'))], scratch, 2500);
                assert.equal(result.groupExited, true, JSON.stringify(result));
                assert.match(result.error?.message ?? '', /deadline exceeded/);
                const pid = Number(readFileSync(join(scratch, 'compiler.pid'), 'utf8'));
                if (process.platform === 'linux') {
                    let state;
                    try { state = linuxProcStateFromStat(readFileSync('/proc/' + pid + '/stat', 'utf8')); }
                    catch (error) { if (error.code !== 'ENOENT') throw error; }
                    assert.ok(state === undefined || state === 'Z' || state === 'X',
                        'compiler descendant must be absent or dead: ' + state);
                } else {
                    assert.throws(() => process.kill(pid, 0), {code:'ESRCH'});
                }
                throw new Error('fixture assertion after timeout');
            }), /fixture assertion after timeout/);
            assert.match(readFileSync(join(retained, 'stdout.log'), 'utf8'), /compiler started/);
            assert.match(readFileSync(join(retained, 'stderr.log'), 'utf8'), /compiler diagnostic/);
            assert.match(readFileSync(join(retained, 'failure.json'), 'utf8'), /fixture assertion after timeout/);
            const receipt = JSON.parse(readFileSync(join(retained, 'process.json'), 'utf8'));
            assert.equal(receipt.groupExited, true);
            assert.match(receipt.error.message, /deadline exceeded/);
        } finally { if (retained) rmSync(retained, {recursive:true, force:true}); }
    });

test('Swift harness records spawn failure before assertion and cleans successful scratch', {timeout:10000}, async () => {
    let failed, succeeded;
    try {
        await assert.rejects(withSwiftFixture('workbench-swift-missing-', async scratch => {
            failed = scratch;
            const result = await runSwift(join(scratch, 'missing-swift'), [], scratch, 2000);
            assert.equal(result.error?.code, 'ENOENT');
            throw new Error('missing compiler');
        }), /missing compiler/);
        assert.equal(JSON.parse(readFileSync(join(failed, 'process.json'), 'utf8')).error.code, 'ENOENT');
        await withSwiftFixture('workbench-swift-success-', async scratch => {
            succeeded = scratch;
            // A shell builtin exercises successful close/cleanup without starting
            // another Node loader worker. Inherited verifier preloads belong to
            // the test runtime and are not the compiler process being measured.
            const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
            const args = process.platform === 'win32' ? ['/d', '/c', 'echo complete'] : ['-c', 'printf "complete\\n"'];
            const result = await runSwift(command, args, scratch, 2000);
            assert.equal(result.status, 0);
            assert.equal(result.error, null);
            assert.equal(result.groupExited, true);
            assert.equal(result.stdout.trim(), 'complete');
            assert.ok(result.timings.closeMs >= result.timings.exitMs);
            assert.equal(result.timings.deadlineMs, undefined);
        });
        assert.throws(() => statSync(succeeded), /ENOENT/);
    } finally { if (failed) rmSync(failed, {recursive:true, force:true}); }
});

test('macOS staging consumes the native product with accessory identity and refuses missing inputs', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workbench-macos-package-'));
    try {
        const directory = join(fixture, 'src-tauri/macos-term-shim/.build/release');
        mkdirSync(directory, {recursive:true});
        writeFileSync(join(fixture, 'package.json'), JSON.stringify({version:'0.0.32'}));
        assert.throws(() => stageNativeWorkbench(fixture, {platform:'darwin'}), /ENOENT/);
        const input = join(directory, 'PapercuspWorkbench');
        // This fixture exercises resource staging only; it is never launched or
        // claimed as a native build, installed package, or AppKit acceptance.
        const bytes = Buffer.from('native product byte custody fixture');
        writeFileSync(input, bytes, {mode:0o644});
        assert.throws(() => stageNativeWorkbench(fixture, {platform:'darwin'}), /native.*executable/);
        rmSync(input); writeFileSync(input, bytes, {mode:0o755});
        const bundle = stageNativeWorkbench(fixture, {platform:'darwin'});
        assert.equal(bundle.platform, 'macos');
        assert.deepEqual(readFileSync(bundle.executable), bytes);
        assert.equal(bundle.sha256, createHash('sha256').update(bytes).digest('hex'));
        assert.ok(statSync(bundle.executable).mode & 0o111);
        const plist = readFileSync(join(bundle.directory, 'Contents/Info.plist'), 'utf8');
        assert.match(plist, /<key>LSUIElement<\/key><true\/>/);
        assert.match(plist, /<key>CFBundleExecutable<\/key><string>PapercuspWorkbench<\/string>/);
        assert.match(plist, /<key>CFBundleIdentifier<\/key><string>ai\.papercusp\.workbench<\/string>/);
        assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key><string>[^<]+<\/string>/,
            'the accessory requests microphone access under its own bundle identity');
        const stale = join(bundle.directory, 'Contents/obsolete-resource');
        writeFileSync(stale, 'old generation');
        stageNativeWorkbench(fixture, {platform:'darwin'});
        assert.throws(() => statSync(stale), /ENOENT/);
        assert.throws(() => stageNativeWorkbench(fixture, {platform:'darwin', macosExecutable:bundle.executable}), /outside its staging bundle/);
        assert.deepEqual(readFileSync(bundle.executable), bytes, 'a refused input must preserve the last output');
        writeFileSync(join(fixture, 'package.json'), JSON.stringify({version:'<invalid>'}));
        assert.throws(() => stageNativeWorkbench(fixture, {platform:'darwin'}), /Invalid.*version/);
    } finally { rmSync(fixture, {recursive:true, force:true}); }
});

test('Swift Workbench canonical model, shortcut transaction and real bounded subprocess regressions', {
    skip: !swiftAvailable && process.platform !== 'darwin' ? 'Swift toolchain is required for the portable XCTest leg' : false,
    timeout: 120000,
}, t => withSwiftFixture('workbench-swift-tests-', async scratch => {
        const result = await runSwift(swift, ['test', '--package-path', packagePath, '--scratch-path', scratch,
            '--filter', 'Workbench'], scratch, 110000);
        assert.equal(result.error, null, result.stdout + result.stderr + JSON.stringify(result.error));
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout + result.stderr, /Executed \d+ tests?, with 0 failures/);
        t.diagnostic(result.stdout.trim());
}));

function shellFunction(source, name) {
    const start = source.indexOf(name + '() {');
    const end = source.indexOf('\n}\n', start);
    assert.ok(start >= 0 && end > start, name + ' must be a complete shell function');
    return source.slice(start, end + 3);
}

test('native producer uses the successful Swift build directory and refuses an unreadable product path', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workbench-swift-products-'));
    const source = readFileSync(join(root, 'bin/mac-vm-build.sh'), 'utf8');
    const start = source.indexOf('SWIFT_PRODUCTS="$('), end = source.indexOf('\nSHIM=', start);
    assert.ok(start >= 0 && end > start);
    try {
        mkdirSync(join(fixture, 'src-tauri/macos-term-shim'), {recursive:true});
        mkdirSync(join(fixture, 'bin'));
        writeFileSync(join(fixture, 'bin/swift'), '#!' + process.execPath + '\n' +
            'const a=process.argv.slice(2),universal=a.includes("--arch");\n' +
            'if(a.includes("--show-bin-path")){if(process.env.PATH_FAIL==="1")process.exit(8);console.log(process.env.PRODUCTS);}\n' +
            'else {console.log("build diagnostic");if(universal&&process.env.UNIVERSAL_FAIL==="1")process.exit(7);}\n', {mode:0o755});
        for (const [target, universalFail, pathFail, pass] of [
            ['universal-apple-darwin', '0', '0', true],
            ['x86_64-apple-darwin', '1', '0', true],
            ['universal-apple-darwin', '1', '0', false],
            ['universal-apple-darwin', '0', '1', false],
            ['x86_64-apple-darwin', '1', '1', false],
        ]) {
            const products = join(fixture, 'selected build products');
            const result = spawnSync('bash', ['-c', 'set -euo pipefail\n' + source.slice(start, end) +
                '\nprintf "%s" "$SWIFT_PRODUCTS"'], {cwd:fixture, encoding:'utf8', timeout:10000,
                env:{...process.env, PATH:join(fixture, 'bin') + ':' + process.env.PATH,
                    MAC_BUILD_TARGET:target, REQUIRED_SHIM_SLICES:target.startsWith('universal') ? 'x86_64 arm64' : 'x86_64',
                    UNIVERSAL_FAIL:universalFail, PATH_FAIL:pathFail, PRODUCTS:products}});
            assert.ifError(result.error);
            assert.equal(result.status === 0, pass, result.stdout + result.stderr);
            if (pass) assert.equal(result.stdout, products, 'build diagnostics must not become a product path');
        }
    } finally { rmSync(fixture, {recursive:true, force:true}); }
});

test('cross producer stages native Workbench bytes and refuses missing or incomplete target slices', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workbench-cross-stage-'));
    const source = readFileSync(join(root, 'bin/build-mac-cross.sh'), 'utf8');
    try {
        mkdirSync(join(fixture, 'src-tauri'), {recursive:true});
        mkdirSync(join(fixture, 'bin'));
        writeFileSync(join(fixture, 'package.json'), JSON.stringify({version:'0.0.32'}));
        const binary = join(fixture, 'native product');
        writeFileSync(binary, 'exact native product fixture', {mode:0o755});
        const lipo = join(fixture, 'bin/lipo');
        const strip = join(fixture, 'bin/strip');
        writeFileSync(strip, '#!/bin/sh\nexit "$FIXTURE_STRIP_STATUS"\n', {mode:0o755});
        writeFileSync(lipo, '#!/bin/sh\nprintf "%s" "$FIXTURE_ARCHS"\nexit "$FIXTURE_LIPO_STATUS"\n', {mode:0o755});
        for (const [target, archs, status, missing, pass, stripStatus = '0'] of [
            ['universal-apple-darwin', 'x86_64 arm64', '0', false, true],
            ['universal-apple-darwin', 'x86_64', '0', false, false],
            ['aarch64-apple-darwin', 'arm64', '0', false, true],
            ['x86_64-apple-darwin', 'arm64', '0', false, false],
            ['x86_64-apple-darwin', '', '0', false, false],
            ['x86_64-apple-darwin', 'x86_64', '9', false, false],
            ['x86_64-apple-darwin', 'x86_64', '0', true, false],
            ['x86_64-apple-darwin', 'x86_64', '0', false, false, '9'],
        ]) {
            const app = join(fixture, 'output.app');
            rmSync(app, {recursive:true, force:true});
            const result = spawnSync('bash', ['-c', 'set -euo pipefail\n' +
                'fail() { echo "$*" >&2; exit 1; }\n' + shellFunction(source, 'stage_workbench') + '\nstage_workbench "$APP"'],
            {encoding:'utf8', timeout:10000, env:{...process.env, HERE:join(root, 'bin'), ROOT:fixture,
                SRC_TAURI:join(fixture, 'src-tauri'), LIPO_BIN:lipo, STRIP_BIN:strip, MAC_BUILD_TARGET:target, APP:app,
                PAPERCUSP_MAC_WORKBENCH_EXECUTABLE:missing ? binary + '.missing' : binary,
                FIXTURE_ARCHS:archs, FIXTURE_LIPO_STATUS:status, FIXTURE_STRIP_STATUS:stripStatus}});
            assert.ifError(result.error);
            assert.equal(result.status === 0, pass, result.stdout + result.stderr);
            const packaged = join(app, 'Contents/Resources/resources/PapercuspWorkbench.app/Contents/MacOS/PapercuspWorkbench');
            if (pass) assert.deepEqual(readFileSync(packaged), readFileSync(binary));
            else assert.throws(() => statSync(packaged), /ENOENT/);
        }
    } finally { rmSync(fixture, {recursive:true, force:true}); }
});

test('native producer strips, checks target slices and verifies helper signing before packaging', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workbench-native-stage-'));
    const source = readFileSync(join(root, 'bin/mac-vm-build.sh'), 'utf8');
    const archGuard = readFileSync(join(root, 'bin/lib/mac-shim-arch.sh'), 'utf8');
    try {
        mkdirSync(join(fixture, 'src-tauri'), {recursive:true});
        mkdirSync(join(fixture, 'bin'));
        writeFileSync(join(fixture, 'package.json'), JSON.stringify({version:'0.0.32'}));
        const binary = join(fixture, 'native product');
        writeFileSync(binary, 'native product fixture', {mode:0o755});
        for (const name of ['xcrun', 'lipo', 'codesign']) {
            writeFileSync(join(fixture, 'bin', name), '#!/bin/sh\n' +
                (name === 'lipo' ? 'printf "%s" "$FIXTURE_ARCHS"\n' :
                    'printf "%s\\n" "' + name + ' $*" >> "$CALLS"\n') +
                (name === 'codesign' ? 'if [ "$1" = --verify ]; then exit "$VERIFY_STATUS"; fi\n' : ''), {mode:0o755});
        }
        for (const [archs, verify, pass] of [['x86_64 arm64', '0', true], ['x86_64', '0', false], ['x86_64 arm64', '9', false]]) {
            const calls = join(fixture, 'calls');
            writeFileSync(calls, '');
            const result = spawnSync('bash', ['-c', 'set -euo pipefail\n' + archGuard + '\n' +
                'strip_mac_signing_xattrs() { :; }\nverify_mac_signing_xattrs() { :; }\n' +
                shellFunction(source, 'verify_mac_app_signature') + '\n' + shellFunction(source, 'stage_native_workbench') +
                '\nstage_native_workbench "$PRODUCT"'], {encoding:'utf8', timeout:10000,
                env:{...process.env, PATH:join(fixture, 'bin') + ':' + process.env.PATH, HERE:join(root, 'bin'),
                    ROOT:fixture, PRODUCT:binary, MAC_BUILD_TARGET:'universal-apple-darwin',
                    FIXTURE_ARCHS:archs, VERIFY_STATUS:verify, CALLS:calls, APPLE_SIGNING_IDENTITY:'fixture identity'}});
            assert.ifError(result.error);
            assert.equal(result.status === 0, pass, result.stdout + result.stderr);
            const recorded = readFileSync(calls, 'utf8');
            assert.match(recorded, /^xcrun strip -x /);
            if (archs === 'x86_64') assert.doesNotMatch(recorded, /codesign/);
            else {
                assert.match(recorded, /codesign --force --options runtime --sign fixture identity /);
                assert.match(recorded, /codesign --verify --deep --strict /);
            }
        }
    } finally { rmSync(fixture, {recursive:true, force:true}); }
});

test('macOS builds the actual AppKit accessory product from the same maintained package', {
    skip:process.platform !== 'darwin' ? 'native AppKit compiler leg requires macOS' : false,
    timeout:180000,
}, () => withSwiftFixture('workbench-appkit-build-', async scratch => {
        const result = await runSwift(swift, ['build', '--package-path', packagePath, '--scratch-path', scratch,
            '--product', 'PapercuspWorkbench'], scratch, 170000);
        assert.equal(result.error, null, result.stdout + result.stderr + JSON.stringify(result.error));
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.ok(statSync(join(scratch, 'debug/PapercuspWorkbench')).mode & 0o111);
}));
