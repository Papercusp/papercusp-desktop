#!/usr/bin/env node
// Use GNOME's maintained archive/schema compiler rather than a second packer.
import {mkdirSync, readFileSync, copyFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export function packageNativeWorkbench(outputDirectory, {
    sourceDirectory = resolve(import.meta.dirname, '../native/gnome'),
} = {}) {
    if (!outputDirectory) throw new Error('An explicit Workbench bundle output directory is required');
    const metadata = JSON.parse(readFileSync(join(sourceDirectory, 'metadata.json'), 'utf8'));
    if (metadata.uuid !== 'workbench@papercusp.ai') throw new Error('Unexpected Workbench extension identity');
    mkdirSync(outputDirectory, {recursive: true});
    const result = spawnSync('gnome-extensions', ['pack', '--force',
        '--extra-source=bridge.js', '--extra-source=helper.js', '--extra-source=panel-model.mjs',
        '--out-dir', resolve(outputDirectory), resolve(sourceDirectory)],
    {encoding: 'utf8', timeout: 30000});
    if (result.error || result.status !== 0)
        throw new Error('GNOME Workbench packaging failed: ' +
            (result.error?.message || result.stderr || result.stdout || result.status));
    const archive = join(resolve(outputDirectory), metadata.uuid + '.shell-extension.zip');
    const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
    return {archive, uuid: metadata.uuid, sha256};
}

// Both Linux products consume resources/*; the GUI's platform overlay names
// these two files explicitly so it never acquires the Server's runtime payload.
export function stageNativeWorkbench(desktopRoot = resolve(import.meta.dirname, '..')) {
    const resources = join(desktopRoot, 'src-tauri/resources');
    const bundle = packageNativeWorkbench(resources, {sourceDirectory: join(desktopRoot, 'native/gnome')});
    copyFileSync(join(desktopRoot, 'native/linux/install-workbench.js'), join(resources, 'workbench-install.js'));
    return bundle;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { console.log(JSON.stringify(process.argv[2] === '--stage-bundle'
        ? stageNativeWorkbench(process.argv[3]) : packageNativeWorkbench(process.argv[2]))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
