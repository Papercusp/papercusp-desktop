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
