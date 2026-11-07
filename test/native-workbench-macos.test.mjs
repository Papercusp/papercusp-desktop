import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {stageNativeWorkbench} from '../bin/package-native-workbench.mjs';

const root = resolve(import.meta.dirname, '..');
const packagePath = join(root, 'src-tauri/macos-term-shim');
const swift = process.env.SWIFT || 'swift';
const swiftAvailable = spawnSync(swift, ['--version'], {encoding:'utf8', timeout:10000}).status === 0;

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
}, t => {
    const scratch = mkdtempSync(join(tmpdir(), 'workbench-swift-tests-'));
    try {
        const result = spawnSync(swift, ['test', '--package-path', packagePath, '--scratch-path', scratch,
            '--filter', 'Workbench'], {encoding:'utf8', timeout:110000, maxBuffer:8*1024*1024});
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout + result.stderr, /Executed \d+ tests?, with 0 failures/);
        t.diagnostic(result.stdout.trim());
    } finally { rmSync(scratch, {recursive:true, force:true}); }
});

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
}, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'workbench-appkit-build-'));
    try {
        const result = spawnSync(swift, ['build', '--package-path', packagePath, '--scratch-path', scratch,
            '--product', 'PapercuspWorkbench'], {encoding:'utf8', timeout:170000, maxBuffer:8*1024*1024});
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.ok(statSync(join(scratch, 'debug/PapercuspWorkbench')).mode & 0o111);
    } finally { rmSync(scratch, {recursive:true, force:true}); }
});
