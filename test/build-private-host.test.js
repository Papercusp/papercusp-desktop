const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const desktop = path.resolve(__dirname, '..');
const script = path.join(desktop, 'bin/build-private-host.sh');
const closure = path.join(desktop, 'bin/lib/host-runtime-closure.sh');
const common = path.resolve(desktop, '../apps/operator/bin/bundle-host-common.sh');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pc-private-assembly-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const donor=path.join(root,'donor'), output=path.join(root,'output');
  fs.mkdirSync(path.join(donor,'apps/operator'),{recursive:true});
  fs.mkdirSync(path.join(output,'node_modules'),{recursive:true});
  return {root,donor,output};
}
function pkg(dir,manifest,body='module.exports=true;') {
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir,'index.js'),body);
}
function shell(f,program) {
  return spawnSync('bash',['-c',[
    'set -euo pipefail','source "$CLOSURE"',
    'REPO_ROOT="$DONOR"; WEB_DIR="$DONOR/apps/operator"; ROOT="$DONOR/papercusp-desktop"',
    'SIDECAR_DIR="$OUTPUT"; TARGET_OS=linux; TARGET_ARCH=x64',
    '_bare_node_platform=linux; _bare_node_arch=x64; nat_copied=0; nat_missing=0; _seen="|"',program,
  ].join('\n')],{encoding:'utf8',timeout:15000,
    env:{...process.env,DONOR:f.donor,OUTPUT:f.output,CLOSURE:closure}});
}
test('shared production closure preserves nested identity and optional native payload without donor writes',t=>{
  const f=fixture(t),nm=path.join(f.donor,'node_modules');
  pkg(path.join(nm,'app'),{name:'app',version:'1.0.0',dependencies:{child:'1.0.0'},
    optionalDependencies:{'native-platform':'1.0.0','foreign-platform':'1.0.0'}},
    "module.exports=[require('child'),require('native-platform')];");
  pkg(path.join(nm,'app/node_modules/child'),{name:'child',version:'1.0.0'},"module.exports='nested';");
  pkg(path.join(nm,'child'),{name:'child',version:'2.0.0'},"module.exports='wrong';");
  pkg(path.join(nm,'native-platform'),{name:'native-platform',version:'1.0.0'},"module.exports='native-helper';");
  const payload=path.join(nm,'native-platform/prebuilds/linux-x64/payload.node');
  fs.mkdirSync(path.dirname(payload),{recursive:true});fs.writeFileSync(payload,'native-payload-sentinel');
  const result=shell(f,'before="$(fingerprint_runtime_package "$REPO_ROOT/node_modules")"\n'
    +'HOST_CLOSURE_INPUT_LOG="$OUTPUT/inputs.tsv"\ncopy_pkg_closure app\n'
    +'(( nat_missing == 0 ))\nassert_runtime_dependency_closure "$SIDECAR_DIR"\n'
    +'[[ "$before" == "$(fingerprint_runtime_package "$REPO_ROOT/node_modules")" ]]');
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(fs.readFileSync(path.join(f.output,'node_modules/native-platform/prebuilds/linux-x64/payload.node'),'utf8'),'native-payload-sentinel');
  assert.match(fs.readFileSync(path.join(f.output,'inputs.tsv'),'utf8'),/^[a-f0-9]{64}\t/m);
  fs.renameSync(f.donor,f.donor+'-hidden');
  const loaded=spawnSync(process.execPath,['-e',"console.log(JSON.stringify(require('./node_modules/app')))"],
    {cwd:f.output,encoding:'utf8',env:{...process.env,NODE_PATH:'',NODE_OPTIONS:''}});
  assert.equal(loaded.status,0,loaded.stderr);
  assert.deepEqual(JSON.parse(loaded.stdout),['nested','native-helper']);
});
test('shared copier closes caller externals beyond the common boundary',t=>{
  const f=fixture(t);
  pkg(path.join(f.donor,'node_modules/extra'),{name:'extra',version:'1.0.0'});
  const r=shell(f,'HOST_COMMON_EXTERNALS=();HOST_EXTERNALS=(--external:extra/subpath)\ncopy_host_external_closures\nassert_runtime_dependency_closure "$SIDECAR_DIR"');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.ok(fs.existsSync(path.join(f.output,'node_modules/extra/index.js')));
});
test('missing required dependency fails the assembled-tree check',t=>{
  const f=fixture(t);
  pkg(path.join(f.donor,'node_modules/broken'),{name:'broken',version:'1.0.0',dependencies:{missing:'1.0.0'}});
  const r=shell(f,'copy_pkg_closure broken\nassert_runtime_dependency_closure "$SIDECAR_DIR"');
  assert.notEqual(r.status,0);assert.match(r.stderr,/broken@1.0.0 -> missing/);
});
test('assembled guard rejects dependencies resolving back into donor',t=>{
  const f=fixture(t),source=path.join(f.donor,'node_modules/escape');
  pkg(source,{name:'escape',version:'1.0.0'});
  fs.symlinkSync(source,path.join(f.output,'node_modules/escape'),'dir');
  const r=shell(f,'assert_runtime_dependency_closure "$SIDECAR_DIR"');
  assert.notEqual(r.status,0);assert.match(r.stderr,/symlink escapes assembled root/);
});
test('malformed manifests and broken package copies fail closed',t=>{
  const f=fixture(t),source=path.join(f.donor,'node_modules/broken');
  pkg(source,{name:'broken',version:'1.0.0'});fs.writeFileSync(path.join(source,'package.json'),'{bad');
  let r=shell(f,'copy_pkg_closure broken\nassert_runtime_dependency_closure "$SIDECAR_DIR"');
  assert.notEqual(r.status,0);assert.match(r.stderr,/invalid package.json/);
  fs.rmSync(path.join(f.output,'node_modules/broken'),{recursive:true});
  fs.symlinkSync(path.join(source,'absent'),path.join(source,'dangling'));
  r=shell(f,'copy_pkg_closure broken');assert.notEqual(r.status,0);
});
test('builder refuses existing output and donor aliases before allocation',t=>{
  const f=fixture(t),alias=path.join(f.root,'alias');fs.symlinkSync(f.donor,alias,'dir');
  for(const run of [f.output,path.join(f.donor,'run'),path.join(alias,'run')]) {
    const r=spawnSync('bash',[script,f.donor,run],{encoding:'utf8',timeout:5000});
    assert.notEqual(r.status,0);assert.match(r.stderr,/fresh|canonical|overlaps/);
  }
  assert.equal(fs.existsSync(path.join(f.donor,'run')),false);
});
test('shared PRIMARY and launcher recipes retain real entry and CLI boundary',t=>{
  const f=fixture(t),record=path.join(f.root,'args');
  // Stand-in measures compile arguments only; it provides no runtime/control proof.
  const program='source "$COMMON"\n'
    +'bundle_host_esbuild() { printf "%s\\n" "$*" >> "$RECORD";for a in "$@";do case "$a" in --outfile=*) printf "export {};\\n" > "${a#--outfile=}";;esac;done; }\n'
    +'node() { :; }\n'
    +'bundle_host_primary "$DONOR" "$OUTPUT" --define:__PAPERCUSP_BUNDLED_SIDECAR__=true\n'
    +'bundle_host_launcher "$DONOR" "$OUTPUT/psu.mjs" psu-launcher';
  const r=spawnSync('bash',['-c',program],{encoding:'utf8',timeout:5000,
    env:{...process.env,COMMON:common,DONOR:f.donor,OUTPUT:f.output,RECORD:record}});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const [primary,launcher]=fs.readFileSync(record,'utf8').trim().split('\n');
  assert.ok(primary.includes('/apps/operator/bin/serve.ts'));
  assert.ok(primary.includes('--define:__PAPERCUSP_BUNDLED_SIDECAR__=true'));
  assert.ok(launcher.includes('/apps/operator/scripts/psu-launcher.mjs'));
  assert.ok(launcher.includes('--external:@lydell/*'));
  assert.ok(!launcher.includes('--define:__PAPERCUSP_BUNDLED_SIDECAR__=true'));
  const production=fs.readFileSync(path.join(desktop,'bin/build-desktop-sidecar.sh'),'utf8');
  assert.match(production,/^source "\$HERE\/lib\/host-runtime-closure.sh"$/m);
  assert.match(production,/^bundle_host_primary "\$REPO_ROOT" "\$SIDECAR_DIR"/m);
  assert.match(production,/^  bundle_host_launcher "\$REPO_ROOT"/m);
});
