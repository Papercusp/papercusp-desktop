#!/usr/bin/env node
// Use GNOME's maintained archive/schema compiler rather than a second packer.
import {mkdirSync, mkdtempSync, cpSync, readFileSync, copyFileSync, writeFileSync, statSync, chmodSync, rmSync} from 'node:fs';
import {resolve, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildSync} from 'esbuild';

export function packageNativeWorkbench(outputDirectory, {
    sourceDirectory = resolve(import.meta.dirname, '../native/gnome'),
} = {}) {
    if (!outputDirectory) throw new Error('An explicit Workbench bundle output directory is required');
    const metadata = JSON.parse(readFileSync(join(sourceDirectory, 'metadata.json'), 'utf8'));
    if (metadata.uuid !== 'workbench@papercusp.ai') throw new Error('Unexpected Workbench extension identity');
    mkdirSync(outputDirectory, {recursive: true});
    const prepared = mkdtempSync(join(resolve(outputDirectory), 'workbench-source-'));
    try {
    cpSync(sourceDirectory, prepared, {recursive: true});
    // Reuse the operator's maintained Markdown and work-ref modules. A closed
    // ESM bundle lets GJS run without npm, Node or TypeScript at runtime.
    buildSync({stdin: {contents: readFileSync(join(sourceDirectory, 'chat-content.mjs'), 'utf8'),
        resolveDir: resolve(import.meta.dirname, '../native/gnome'), sourcefile: 'chat-content.mjs', loader: 'js'}, bundle: true,
        format: 'esm', platform: 'neutral', target: 'es2022',
        outfile: join(prepared, 'chat-content.js'), logLevel: 'silent'});
    const result = spawnSync('gnome-extensions', ['pack', '--force',
        '--extra-source=bridge.js', '--extra-source=helper.js', '--extra-source=panel-model.mjs', '--extra-source=chat-content.js',
        '--out-dir', resolve(outputDirectory), prepared],
    {encoding: 'utf8', timeout: 30000});
    if (result.error || result.status !== 0)
        throw new Error('GNOME Workbench packaging failed: ' +
            (result.error?.message || result.stderr || result.stdout || result.status));
    const archive = join(resolve(outputDirectory), metadata.uuid + '.shell-extension.zip');
    const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
    return {archive, uuid: metadata.uuid, sha256,
        chatContentSha256: createHash('sha256').update(readFileSync(join(prepared, 'chat-content.js'))).digest('hex')};
    } finally { rmSync(prepared, {recursive: true, force: true}); }
}

// Both Linux products consume resources/*; the GUI's platform overlay names
// these two files explicitly so it never acquires the Server's runtime payload.
export const windowsWorkbenchFiles = Object.freeze([
    'PuiReadBridge.cs', 'WorkbenchModel.cs', 'WorkbenchHost.cs', 'WorkbenchLifecycle.psm1', 'workbench.ps1',
]);

export function stageNativeWorkbench(desktopRoot = resolve(import.meta.dirname, '..'), {
    platform = process.platform,
    macosExecutable = join(desktopRoot, 'src-tauri/macos-term-shim/.build/release/PapercuspWorkbench'),
} = {}) {
    const resources = join(desktopRoot, 'src-tauri/resources');
    if (platform === 'darwin' || platform === 'macos') {
        // Consume the existing SwiftPM product; never silently substitute a
        // webview or ship a source-only bundle when the native build is absent.
        const source = statSync(macosExecutable);
        if (!source.isFile() || !(source.mode & 0o111))
            throw new Error('Build the native PapercuspWorkbench executable before staging');
        const version = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')).version;
        if (!/^\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$/.test(version))
            throw new Error('Invalid Workbench bundle version');
        const directory = join(resources, 'PapercuspWorkbench.app');
        const input = resolve(macosExecutable), output = resolve(directory);
        if (input === output || input.startsWith(output + sep))
            throw new Error('The native Workbench input must be outside its staging bundle');
        // Rebuild this owned output closure, including removal of stale nested
        // code/signatures left by an earlier product generation.
        rmSync(directory, {recursive:true, force:true});
        const contents = join(directory, 'Contents');
        mkdirSync(join(contents, 'MacOS'), {recursive:true});
        const executable = join(contents, 'MacOS/PapercuspWorkbench');
        copyFileSync(macosExecutable, executable); chmodSync(executable, 0o755);
        writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ai.papercusp.workbench</string>
<key>CFBundleName</key><string>Papercusp Workbench</string>
<key>CFBundleExecutable</key><string>PapercuspWorkbench</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Record a voice message for the selected Papercup conversation.</string>
</dict></plist>
`);
        return {platform:'macos', directory, executable,
            sha256:createHash('sha256').update(readFileSync(executable)).digest('hex')};
    }
    if (platform === 'windows' || platform === 'win32') {
        const destination = join(resources, 'workbench-windows');
        mkdirSync(destination, {recursive:true});
        const files = {};
        for (const name of windowsWorkbenchFiles) {
            const source = join(desktopRoot, 'native/windows', name);
            const bytes = readFileSync(source); // Fail closed on an incomplete native source closure.
            copyFileSync(source, join(destination, name));
            files[name] = createHash('sha256').update(bytes).digest('hex');
        }
        return {platform:'windows', directory:destination, files};
    }
    if (platform !== 'linux') throw new Error('Unsupported native Workbench bundle platform: ' + platform);
    const bundle = packageNativeWorkbench(resources, {sourceDirectory: join(desktopRoot, 'native/gnome')});
    copyFileSync(join(desktopRoot, 'native/linux/install-workbench.js'), join(resources, 'workbench-install.js'));
    return bundle;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { console.log(JSON.stringify(process.argv[2] === '--stage-bundle'
        ? stageNativeWorkbench(process.argv[3], {platform:process.argv[4] || process.platform,
            ...(process.argv[5] ? {macosExecutable:process.argv[5]} : {})}) : packageNativeWorkbench(process.argv[2]))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
