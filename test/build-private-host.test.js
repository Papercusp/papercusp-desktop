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
  assert.ok(launcher.includes('--external:@iarna/toml'));
  assert.ok(!launcher.includes('--define:__PAPERCUSP_BUNDLED_SIDECAR__=true'));
  const production=fs.readFileSync(path.join(desktop,'bin/build-desktop-sidecar.sh'),'utf8');
  assert.match(production,/^source "\$HERE\/lib\/host-runtime-closure.sh"$/m);
  assert.match(production,/^bundle_host_primary "\$REPO_ROOT" "\$SIDECAR_DIR"/m);
  assert.match(production,/^  bundle_host_launcher "\$REPO_ROOT"/m);
});

test('runtime require-root copying stops on failure even when caller tests its status',t=>{
  const f=fixture(t);
  const r=shell(f,'copy_pkg_closure() { echo "$1"; return 37; }\n'
    +'if copy_host_runtime_require_closures; then exit 99; fi');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/^@iarna\/toml$/m);
  assert.doesNotMatch(r.stdout,/^rrule$/m);
});

test('source SHA resolver uses the actual checkout and refuses a borrowed parent identity',t=>{
  const f=fixture(t),repo=path.resolve(desktop,'..');
  const expected=spawnSync('git',['-C',repo,'rev-parse','--short','HEAD'],{encoding:'utf8'});
  assert.equal(expected.status,0,expected.stderr);
  const resolveSha=(root,extra={})=>spawnSync('bash',['-c',
    'source "$COMMON"; bundle_host_source_sha "$SOURCE_ROOT"'],{
    encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',
      VERIFY_TAURI_SOURCE_RECEIPT:'',COMMON:common,SOURCE_ROOT:root,...extra}});
  const actual=resolveSha(repo);
  assert.equal(actual.status,0,actual.stderr);
  assert.equal(actual.stdout.trim(),expected.stdout.trim());
  const nested=resolveSha(path.join(repo,'apps/operator'));
  assert.equal(nested.status,0,nested.stderr);
  assert.equal(nested.stdout,'');
  const pinned=resolveSha(repo,{VERIFY_TAURI_SOURCE_RECEIPT:path.join(f.root,'absent.json')});
  assert.equal(pinned.status,78,pinned.stderr);
  assert.match(pinned.stderr,/pinned source receipt requires its archive marker/);
});

test('private source SHA setup produces a real bundled identity without a runtime override',t=>{
  const f=fixture(t),repo=path.resolve(desktop,'..');
  const builder=fs.readFileSync(script,'utf8');
  const start=builder.indexOf('SOURCE_SHA="$(bundle_host_source_sha');
  const end=builder.indexOf('source "$HERE/lib/transformers-models.sh"',start);
  assert.ok(start>=0&&end>start,'private builder must run the shared source resolver');
  assert.match(builder,/bundle_host_primary[^\n]*\n[^\n]*BUNDLED_SOURCE_SHA_DEFINE/);
  assert.match(builder,/bundle_host_spawner[^\n]*BUNDLED_SOURCE_SHA_DEFINE/);
  const source=path.join(f.donor,'apps/operator/bin/serve.ts');
  fs.mkdirSync(path.dirname(source),{recursive:true});
  fs.writeFileSync(source,'import {resolveBuildInfo} from '+JSON.stringify(path.join(repo,'packages/operator-core/lib/build-info.ts'))+';\n'
    +'console.log(JSON.stringify(resolveBuildInfo({env:{},gitSha:()=>{throw new Error("runtime git identity forbidden");}})));\n');
  fs.copyFileSync(path.join(repo,'apps/operator/bin/ascii-escape-bundle.mjs'),path.join(f.donor,'apps/operator/bin/ascii-escape-bundle.mjs'));
  const command='set -euo pipefail\nsource "$COMMON"\nREPO_ROOT="$SOURCE_ROOT"\n'
    +builder.slice(start,end)+'\n'
    +'bundle_host_esbuild() { "$ESBUILD" "${@:2}"; }\n'
    +'bundle_host_primary "$DONOR" "$OUTPUT" --define:__PAPERCUSP_BUNDLED_SIDECAR__=true "${BUNDLED_SOURCE_SHA_DEFINE[@]}"\n'
    +'node "$OUTPUT/serve.mjs"';
  const r=spawnSync('bash',['-c',command],{encoding:'utf8',timeout:15000,
    env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',PAPERCUSP_BUILD_SHA:'',VERIFY_TAURI_SOURCE_RECEIPT:'',
      COMMON:common,SOURCE_ROOT:repo,DONOR:f.donor,OUTPUT:f.output,
      ESBUILD:path.join(path.dirname(require.resolve('esbuild/package.json')),'bin/esbuild')}});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const expected=spawnSync('git',['-C',repo,'rev-parse','--short','HEAD'],{encoding:'utf8'});
  assert.equal(JSON.parse(r.stdout.trim().split('\n').at(-1)).sha,expected.stdout.trim());
});

function graphFixture(t) {
  const f=fixture(t),run=path.join(f.root,'run');
  fs.mkdirSync(path.join(run,'artifact'),{recursive:true});
  fs.mkdirSync(path.join(f.donor,'node_modules'),{recursive:true});
  fs.symlinkSync(path.resolve(desktop,'../node_modules/typescript'),path.join(f.donor,'node_modules/typescript'),'dir');
  return {...f,run};
}
function graph(f,inputs) {
  const imports=Object.values(inputs).flatMap(v=>v.imports);
  fs.writeFileSync(path.join(f.run,'artifact/serve.mjs.meta.json'),JSON.stringify({inputs,outputs:{'serve.mjs':{imports}}}));
  return shell(f,`write_host_graph_dependency_census ${JSON.stringify(f.run)}`);
}
const edge=(name,kind='require-call')=>({path:name,external:true,kind});
test('graph census preserves optional peers but refuses an absent required wildcard dependency',t=>{
  const f=graphFixture(t);
  pkg(path.join(f.donor,'node_modules/client'),{name:'client',version:'1.0.0',
    peerDependencies:{acceleration:'*'},peerDependenciesMeta:{acceleration:{optional:true}}},
    "try { require('acceleration'); } catch {} require('@vendor/missing');");
  const r=graph(f,{'node_modules/client/index.js':{imports:[edge('acceleration','dynamic-import'),edge('@vendor/missing'),edge('<runtime>','import-statement')]}});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/^optional\tacceleration$/m);
  assert.match(r.stdout,/^required\t@vendor\/missing$/m);
  assert.doesNotMatch(r.stdout,/<runtime>/);
  const refused=shell(f,'copy_pkg_closure @vendor/missing\n(( nat_missing == 0 ))');
  assert.notEqual(refused.status,0);
  assert.match(refused.stdout+refused.stderr,/@vendor\/missing/);
});
test('a mandatory graph occurrence overrides another requester optional peer declaration',t=>{
  const f=graphFixture(t);
  pkg(path.join(f.donor,'node_modules/client'),{name:'client',version:'1.0.0',
    peerDependencies:{maybe:'*'},peerDependenciesMeta:{maybe:{optional:true}}},"require('maybe');");
  fs.writeFileSync(path.join(f.donor,'entry.js'),"require('maybe');");
  const r=graph(f,{'node_modules/client/index.js':{imports:[edge('maybe')]},'entry.js':{imports:[edge('maybe')]}});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/^required\tmaybe$/m);
});
test('graph optionality crosses module-format markers but stops at a package boundary',t=>{
  const f=graphFixture(t),client=path.join(f.donor,'node_modules/client');
  pkg(client,{name:'client',version:'1.0.0',optionalDependencies:{fsevents:'*'}},'');
  const nested=path.join(client,'dist/es');
  fs.mkdirSync(nested,{recursive:true});
  fs.writeFileSync(path.join(nested,'package.json'),JSON.stringify({type:'module'}));
  fs.writeFileSync(path.join(nested,'index.js'),"import('fsevents');");
  const inputs={'node_modules/client/dist/es/index.js':{imports:[edge('fsevents','dynamic-import')]}};
  let r=graph(f,inputs);
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/^optional\tfsevents$/m);
  // A real nested package owns its imports even with no dependency declaration.
  fs.writeFileSync(path.join(nested,'package.json'),JSON.stringify({name:'nested',type:'module'}));
  r=graph(f,inputs);
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/^required\tfsevents$/m);
});
test('unknown dynamic imports remain required instead of being silently omitted',t=>{
  const f=graphFixture(t);
  fs.writeFileSync(path.join(f.donor,'entry.js'),"import('@vendor/dynamic');");
  const r=graph(f,{'entry.js':{imports:[edge('@vendor/dynamic','dynamic-import')]}});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/^required\t@vendor\/dynamic$/m);
});
test('DBOS lazy graph edges require the measured context and the actual OTLP early-return guard',t=>{
  const f=graphFixture(t),sdk=path.join(f.donor,'node_modules/@dbos-inc/dbos-sdk/dist/src/telemetry');
  // Committed donor shadows link installed third-party packages to their
  // canonical read-only install; esbuild records those real paths in inputs.
  const installed=path.join(f.root,'installed-sdk');
  fs.mkdirSync(path.join(installed,'dist/src/telemetry'),{recursive:true});
  fs.mkdirSync(path.dirname(path.join(f.donor,'node_modules/@dbos-inc/dbos-sdk')),{recursive:true});
  fs.symlinkSync(installed,path.join(f.donor,'node_modules/@dbos-inc/dbos-sdk'),'dir');
  const traces="function installTraceContextManager() { require('@opentelemetry/sdk-trace-base'); }";
  const logs="class Logger { constructor() { if (!utils_1.globalParams.enableOTLP) { return; } class Transport { constructor() { require('@opentelemetry/sdk-logs'); } } } }";
  fs.writeFileSync(path.join(sdk,'traces.js'),traces);fs.writeFileSync(path.join(sdk,'logs.js'),logs);
  const inputs={
    [fs.realpathSync(path.join(sdk,'traces.js'))]:{imports:[edge('@opentelemetry/sdk-trace-base')]},
    [fs.realpathSync(path.join(sdk,'logs.js'))]:{imports:[edge('@opentelemetry/sdk-logs')]},
  };
  let r=graph(f,inputs);
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/^required\t@opentelemetry\/sdk-trace-base$/m);
  assert.match(r.stdout,/^required\t@opentelemetry\/sdk-logs$/m);
  fs.writeFileSync(path.join(f.run,'trace-context.json'),JSON.stringify({schemaVersion:'private-default-trace-context-v1',registered:true,contextWorking:true,otlp:false}));
  r=graph(f,inputs);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/^optional\t@opentelemetry\/sdk-trace-base$/m);
  assert.match(r.stdout,/^optional\t@opentelemetry\/sdk-logs$/m);
  fs.writeFileSync(path.join(sdk,'logs.js'),logs.replace('if (!utils_1.globalParams.enableOTLP) { return; }',''));
  fs.appendFileSync(path.join(sdk,'traces.js'),"\nrequire('@opentelemetry/sdk-trace-base');");
  r=graph(f,inputs);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/^required\t@opentelemetry\/sdk-trace-base$/m);
  assert.match(r.stdout,/^required\t@opentelemetry\/sdk-logs$/m);
});
test('default trace composition refuses an unqualified startup order before compiling',t=>{
  const f=fixture(t),host=path.join(f.donor,'apps/operator/bin');
  fs.mkdirSync(host,{recursive:true});
  fs.writeFileSync(path.join(host,'host-bootstrap.ts'),'await startDbos(); initializeRuntimeObservability();');
  const r=shell(f,`assert_host_default_trace_context ${JSON.stringify(f.output)}`);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/unqualified host tracing\/DBOS startup order/);
});
