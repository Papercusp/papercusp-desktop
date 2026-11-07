import assert from 'node:assert/strict';
import {appendFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {packageNativeWorkbench, stageNativeWorkbench} from '../bin/package-native-workbench.mjs';

const root = resolve(import.meta.dirname, '..');
const chatCode = 'const literal = "<&> WI-999";';
const chatMarkdown = '# Native heading\n\n**Native bold** and `literal <&>`.\n\n```js\n' +
    chatCode + '\n```\n\nSee WI-123 and P-007. [Docs](https://example.test/docs?x=1&y=2)';
async function withNativeFixture(prefix, action) {
    const temp=mkdtempSync(join(tmpdir(),prefix));
    try {
        const result=await action(temp);
        rmSync(temp,{recursive:true,force:true});
        return result;
    } catch(error) {
        // Keep generated drivers, installed sources, progress and process output
        // even when no optional export directory was requested.
        writeFileSync(join(temp,'failure.json'),JSON.stringify({error:String(error),stack:error.stack},null,2)+'\n');
        console.error('GNOME_NATIVE_FAILURE_EVIDENCE '+temp);
        throw error;
    }
}
function checkScript(file) {
    const syntax=spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:10000});
    assert.equal(syntax.status,0,'Generated native driver must parse before starting a desktop: '+syntax.stderr);
}
function privateBus(temp) {
    const file=join(temp,'session-bus.conf');
    // No system service directories: a test cannot activate host keyrings,
    // portals, account readers, volume monitors or calendar services.
    writeFileSync(file,'<busconfig><type>session</type><listen>unix:tmpdir=/tmp</listen>'+
        '<policy context="default"><allow send_destination="*" eavesdrop="true"/>'+
        '<allow eavesdrop="true"/><allow own="*"/></policy></busconfig>');
    return '--config-file='+file;
}
function fixturePui(temp) {
    const file = join(temp, "pui '$ fixture");
    writeFileSync(file, `#!/usr/bin/env node
if(process.argv[2]==='workbench'){
require('node:fs').writeFileSync(${JSON.stringify(join(temp,'terminal-launch.json'))},JSON.stringify({
argv:process.argv.slice(2),tty:[0,1,2].map(fd=>require('node:tty').isatty(fd))}));
process.exit(0);}
let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{
const r=JSON.parse(text);let rows=[];
const environment={endpoint:'http://fixture',workspaceId:'exact',store:{id:'store'},agentChat:{scope:'workspace'}};
const fs=require('node:fs'),dir=${JSON.stringify(temp)};
const chatId=()=>fs.existsSync(dir+'/conversation-id')?fs.readFileSync(dir+'/conversation-id','utf8'):'conversation+/=&';
const chatHistory=()=>fs.existsSync(dir+'/chat-history.json')?JSON.parse(fs.readFileSync(dir+'/chat-history.json','utf8')):
 [{id:'saved-five',conversationId:chatId(),seq:5,role:'assistant',text:${JSON.stringify(chatMarkdown)}}];
if(process.argv[2]==='native-chat'){
 const actions=fs.existsSync(dir+'/chat-actions.json')?JSON.parse(fs.readFileSync(dir+'/chat-actions.json','utf8')):[];
 actions.push(r);fs.writeFileSync(dir+'/chat-actions.json',JSON.stringify(actions));
 const turnId='00000000-0000-4000-8000-000000000002';
 const emit=(event,data)=>console.log(JSON.stringify({environment,event,data}));
 const event=(n,text)=>emit('chat-event',{schemaVersion:1,conversationId:r.conversationId,turnId,sequence:n,
  eventId:'event-'+n,event:{type:'delta',text}});
 const done=()=>{const rows=chatHistory(),seq=rows.at(-1).seq+1;
  rows.push({id:'assistant-'+seq,conversationId:r.conversationId,seq,role:'assistant',text:'Hello from Papercup'});
  fs.writeFileSync(dir+'/chat-history.json',JSON.stringify(rows));
  emit('done',{phase:'completed',persistedTurn:{conversationId:r.conversationId,turnId,seq}});};
 if(r.operation==='cancel'){
  emit('cancelled',{ok:true,state:{schemaVersion:1,conversationId:r.conversationId,turnId,revision:1,lastSequence:1,phase:'cancelled',
   capabilities:Object.fromEntries(['connectionReplay','persistedHistory','persistedInteractionDecisions',
    'completedToolCheckpoints','interruptedTurnRecovery'].map(k=>[k,true]))}});return;}
 if(r.operation==='send'){
  const rows=chatHistory(),row={id:r.userTurnId,conversationId:r.conversationId,seq:rows.at(-1).seq+1,role:'user',text:r.text};
  rows.push(row);fs.writeFileSync(dir+'/chat-history.json',JSON.stringify(rows));
  emit('user-saved',{conversationId:r.conversationId,turn:row});
 }
 emit('turn-meta',{schemaVersion:1,conversationId:r.conversationId,turnId});
 event(1,'<say>Hello');
 if(r.operation==='reconnect'){event(2,' from Papercup</say>');done();return;}
 if(r.text==='recover')return;
 if(r.text==='cancel'){setInterval(()=>{},1000);return;}
 const started=Date.now(),timer=setInterval(()=>{
  if(fs.existsSync(dir+'/chat-release')){clearInterval(timer);event(2,' from Papercup</say>');done();}
  else if(Date.now()-started>6000){clearInterval(timer);console.error('consumer did not observe partial reply');process.exitCode=1;}
 },25);return;
}
const question={id:'question+/=&',kind:'escalation',title:'Inbox question',body:'Exact context',ref:{kind:'coord-escalation',conversationId:'conversation+/=&'},actions:[{id:'resolve'}]};
if(process.argv[2]==='native-inbox'){
require('node:fs').writeFileSync(${JSON.stringify(join(temp,'inbox-action.json'))},JSON.stringify(r));
console.log(JSON.stringify({environment,rows:[{ok:true,resolved:true,itemId:r.expected?.id,runId:'run+/=&'}]}));return;}
if(r.name==='failure'){console.error('canonical ACL refusal');process.exitCode=1;return;}
if(r.name==='operator.identity')rows=[environment];
else if(r.name==='operatorConversations.current')rows=[{id:chatId(),workspaceId:environment.workspaceId,subjectKind:'global',status:'active'}];
else if(r.name==='operatorTurns.page')rows=[{turns:r.args.beforeSeq?[{id:'saved-one',conversationId:chatId(),seq:1,role:'user',text:'Earlier message'}]:chatHistory(),hasMoreEarlier:!r.args.beforeSeq&&!fs.existsSync(dir+'/chat-history.json')}];
else if(r.name==='plans.attention')rows=[{items:[question]}];
else if(r.name==='plans.attentionItem')rows=[question];
else if(r.name==='plans.attentionBulkRun')rows=[{run:{runId:'run+/=&',phase:'review',totalItems:8},items:[{itemId:question.id,kind:question.kind,ref:question.ref,runId:'run+/=&',outcome:'recommended',actionId:'answer',draftAnswer:'Draft'}]}];
else if(r.name==='plans.list')rows=[{harness:'exact-harness',slug:'same',title:'Plan'}];
else if(r.name==='advRoster.list'){const fs=require('node:fs');const path=${JSON.stringify(join(temp,'roster.json'))};rows=[fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):{active:[],ended:[]}];}
else if(r.name==='goals.list')rows=[{goals:[{id:'goal-id',title:'Goal '+(r.args.query||'')}],totalGoals:1}];
else if(r.name==='goals.detail')rows=[{goal:{id:r.args.goalId},agents:[],plans:[{harnessSlug:'exact-harness',planSlug:'same'}]}];
else if(r.name==='reports.list')rows=[{report_id:'exact+/=&',title:'Report '+(r.args.query||'')}];
else if(r.name==='reports.get')rows=[{body_md:'# Exact report '+r.args.reportId}];
else rows=[r];
console.log(JSON.stringify({rows,environment,version:'native-fixture'}));});
`, {mode:0o700});
    return file;
}
function runOwned(command, args, env, timeout = 35000, evidenceDir = null) {
    return new Promise(resolveResult => {
        const child=spawn(command,args,{env,detached:true,stdio:['ignore','pipe','pipe']});
        let stdout='',stderr='',error=null;
        child.stdout.on('data',data=>{stdout=(stdout+data).slice(-20000);
            if(evidenceDir)appendFileSync(join(evidenceDir,'stdout.log'),data);});
        child.stderr.on('data',data=>{stderr=(stderr+data).slice(-20000);
            if(evidenceDir)appendFileSync(join(evidenceDir,'stderr.log'),data);});
        const timer=setTimeout(()=>{error=new Error('Native fixture deadline exceeded');
            try{process.kill(-child.pid,'SIGKILL');}catch(cause){if(cause.code!=='ESRCH')throw cause;}},timeout);
        let drain;
        child.once('exit',()=>{
            clearTimeout(timer);
            drain=setTimeout(()=>{error ||= new Error('Descendants retained output after native process exit');
                child.stdout.destroy();child.stderr.destroy();},1000);
        });
        child.on('error',cause=>{error=cause;});
        child.on('close',(status,signal)=>{clearTimeout(timer);clearTimeout(drain);
            if(evidenceDir)writeFileSync(join(evidenceDir,'process.json'),JSON.stringify({command,args,status,signal,
                error:error?{message:error.message,stack:error.stack}:null,stdout,stderr},null,2)+'\n');
            resolveResult({status,signal,error,stdout,stderr});});
    });
}

async function terminalPreflight(temp, env) {
    const directory=join(temp,'terminal-preflight');mkdirSync(directory);
    const pui=fixturePui(directory),receipt=join(directory,'terminal-launch.json');
    const driver=join(directory,'driver.mjs');
    writeFileSync(driver,`import Gio from 'gi://Gio';import GLib from 'gi://GLib';
const argv=[${JSON.stringify(pui)},'workbench','resume','preflight+/=&'];
const app=Gio.AppInfo.create_from_commandline(argv.map(value=>GLib.shell_quote(value)).join(' '),
 'Workbench terminal preflight',Gio.AppInfoCreateFlags.NEEDS_TERMINAL);
if(!app.launch([],null))throw Error('GIO refused terminal launch');
const loop=new GLib.MainLoop(null,false);let tries=0,ok=false;
GLib.timeout_add(GLib.PRIORITY_DEFAULT,50,()=>{
 if(GLib.file_test(${JSON.stringify(receipt)},GLib.FileTest.EXISTS)){ok=true;loop.quit();return GLib.SOURCE_REMOVE;}
 if(++tries>=180){loop.quit();return GLib.SOURCE_REMOVE;}return GLib.SOURCE_CONTINUE;});
loop.run();if(!ok)throw Error('Private GIO terminal did not execute its command');
print('GIO_TERMINAL_PREFLIGHT_PASS');`);
    checkScript(driver);
    // Exercise the real default terminal on a separate private X display and
    // the same service-free session bus before paying for a Shell boot.
    const terminalEnv={...env,GDK_BACKEND:'x11'};delete terminalEnv.WAYLAND_DISPLAY;
    const result=await runOwned('xvfb-run',['-a','-s','-screen 0 1280x800x24 -nolisten tcp',
        'dbus-run-session',privateBus(directory),'--','gjs','-m',driver],terminalEnv,15000,directory);
    assert.equal(result.status,0,'Terminal preflight failed before Shell boot: '+JSON.stringify(result));
    assert.equal(result.error,null,JSON.stringify(result));
    const launched=JSON.parse(readFileSync(receipt,'utf8'));
    assert.deepEqual(launched.argv,['workbench','resume','preflight+/=&']);
    assert.ok(launched.tty.every(Boolean),'Default terminal must supply three PTY descriptors');
    return {argv:launched.argv,tty:launched.tty,plane:'real default GIO terminal; private X11 and service-free D-Bus; fixture command'};
}

test('native harness retains generated source, progress and output after a process deadline', async () => {
    let retained;
    try {
        await assert.rejects(withNativeFixture('workbench-harness-',async temp=>{
            retained=temp;
            const driver=join(temp,'driver.mjs');
            writeFileSync(driver,`import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(join(temp,'progress.json'))},JSON.stringify({phase:'terminal',assertions:['before timeout']}));
console.log('driver started');setInterval(()=>{},100);`);
            const result=await runOwned(process.execPath,[driver],process.env,1000,temp);
            assert.equal(result.status,0,result.error?.message);
        }),/Native fixture deadline exceeded/);
        assert.equal(existsSync(join(retained,'driver.mjs')),true);
        assert.equal(JSON.parse(readFileSync(join(retained,'progress.json'))).phase,'terminal');
        const result=JSON.parse(readFileSync(join(retained,'process.json')));
        assert.equal(result.signal,'SIGKILL');
        assert.match(result.error.message,/deadline/);
        assert.match(readFileSync(join(retained,'stdout.log'),'utf8'),/driver started/);
        assert.match(readFileSync(join(retained,'failure.json'),'utf8'),/deadline/);
        assert.equal(existsSync(join(retained,'result.json')),false,'A hard timeout must not fabricate a completed result');
    } finally {if(retained)rmSync(retained,{recursive:true,force:true});}
});

test('native harness deletes successful fixtures',async () => {
    let completed;
    await withNativeFixture('workbench-harness-',async temp=>{completed=temp;writeFileSync(join(temp,'result.json'),'{}');});
    assert.equal(existsSync(completed),false);
});

test('private GIO terminal preflight preserves quoted argv and real PTYs without service activation',
    {skip:process.platform!=='linux',timeout:25000},()=>withNativeFixture('workbench-terminal-',async temp=>{
        const env={...process.env,XDG_DATA_HOME:join(temp,'data'),XDG_CONFIG_HOME:join(temp,'config'),
            XDG_CACHE_HOME:join(temp,'cache'),XDG_RUNTIME_DIR:join(temp,'runtime'),
            GSETTINGS_BACKEND:'keyfile',GIO_USE_VFS:'local',GTK_A11Y:'none'};
        mkdirSync(env.XDG_RUNTIME_DIR,{mode:0o700});
        console.log('GIO_TERMINAL_PREFLIGHT '+JSON.stringify(await terminalPreflight(temp,env)));
    }));

test('GNOME archive installs all runtime sources and preserves private preferences across upgrade',
    {skip:process.platform!=='linux',timeout:45000}, () => withNativeFixture('workbench-install-',async temp=>{
            const bundle=packageNativeWorkbench(join(temp,'bundle'));
            const env={...process.env,XDG_DATA_HOME:join(temp,'data'),
                XDG_CONFIG_HOME:join(temp,'config'),XDG_CACHE_HOME:join(temp,'cache'),
                GSETTINGS_BACKEND:'keyfile',GIO_USE_VFS:'local'};
            const install=()=>{
                const r=spawnSync('gnome-extensions',['install','--force',bundle.archive],
                    {env,encoding:'utf8',timeout:15000});
                assert.equal(r.status,0,r.stderr||String(r.error));
            };
            install();
            const extension=join(env.XDG_DATA_HOME,'gnome-shell/extensions',bundle.uuid);
            for(const file of ['metadata.json','extension.js','stylesheet.css','prefs.js',
                'bridge.js','helper.js','panel-model.mjs'])
                assert.deepEqual(readFileSync(join(extension,file)),readFileSync(join(root,'native/gnome',file)),file);
            assert.equal(createHash('sha256').update(readFileSync(join(extension,'chat-content.js'))).digest('hex'),bundle.chatContentSha256);
            assert.doesNotMatch(readFileSync(join(extension,'chat-content.js'),'utf8'),/from ['"]marked['"]|from ['"].*\.ts['"]/);
            assert.ok(readFileSync(join(extension,'schemas/gschemas.compiled')).length>0);
            const settingsEnv={...env,GSETTINGS_SCHEMA_DIR:join(extension,'schemas')};
            const settings=(...args)=>spawnSync('gsettings',args,{env:settingsEnv,encoding:'utf8',timeout:10000});
            assert.equal(settings('set','org.gnome.shell.extensions.papercusp-workbench','goals',"['<Super><Alt>g']").status,0);
            install();
            const kept=settings('get','org.gnome.shell.extensions.papercusp-workbench','goals');
            assert.equal(kept.status,0,kept.stderr);
            assert.equal(kept.stdout.trim(),"['<Super><Alt>g']");
            if(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR){
                mkdirSync(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,{recursive:true});
                cpSync(bundle.archive,join(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,bundle.uuid+'.shell-extension.zip'));
                writeFileSync(join(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,'gnome-native-package.json'),
                    JSON.stringify({uuid:bundle.uuid,sha256:bundle.sha256,
                        runtimeSourcesEqual:true,compiledSchemaInstalled:true,
                        preferencesSurviveUpgrade:true,
                        plane:'GNOME CLI archive and private install/upgrade; desktop distribution not verified'},null,2)+'\n');
            }
            console.log('GNOME_PACKAGE_UPGRADE_PASS '+JSON.stringify({uuid:bundle.uuid,sha256:bundle.sha256}));
    }));

test('bundled production installer preserves login, disabled and shortcut choices through upgrade and repair',
    {skip:process.platform!=='linux',timeout:45000}, () => withNativeFixture('workbench-distribution-',async temp=>{
            const desktop=join(temp,'desktop');
            cpSync(join(root,'native'),join(desktop,'native'),{recursive:true});
            const original=stageNativeWorkbench(desktop);
            const installer=join(desktop,'src-tauri/resources/workbench-install.js');
            assert.deepEqual(readFileSync(installer),readFileSync(join(root,'native/linux/install-workbench.js')));
            const upgradedSource=join(temp,'upgraded');
            cpSync(join(root,'native/gnome'),upgradedSource,{recursive:true});
            writeFileSync(join(upgradedSource,'stylesheet.css'),readFileSync(join(upgradedSource,'stylesheet.css'),'utf8')+'\n/* upgrade fixture */\n');
            const upgraded=packageNativeWorkbench(join(temp,'upgrade'),{sourceDirectory:upgradedSource});
            const pui=fixturePui(temp),driver=join(temp,'install.mjs');
            writeFileSync(driver,`import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {installWorkbench} from ${JSON.stringify(pathToFileURL(installer).href)};
const uuid='workbench@papercusp.ai',data=GLib.get_user_data_dir();
const shell=new Gio.Settings({schema_id:'org.gnome.shell'});
shell.set_strv('enabled-extensions',['unrelated@example.invalid']);
shell.set_strv('disabled-extensions',[]);
const options={reload:()=>{},pui:${JSON.stringify(pui)}};
const first=installWorkbench(${JSON.stringify(original.archive)},{reload:()=>{}});
const laterServer=installWorkbench(${JSON.stringify(original.archive)},options);
const enabled=shell.get_strv('enabled-extensions');
const dir=GLib.build_filenamev([data,'gnome-shell/extensions',uuid]);
const source=Gio.SettingsSchemaSource.new_from_directory(dir+'/schemas',Gio.SettingsSchemaSource.get_default(),false);
const prefs=new Gio.Settings({settings_schema:source.lookup('org.gnome.shell.extensions.papercusp-workbench',false)});
const bundledPui=prefs.get_string('pui-path');
prefs.set_strv('goals',['<Super><Alt>g']);prefs.set_string('pui-path','/custom/operator/pui');
shell.set_strv('enabled-extensions',['unrelated@example.invalid']);
const upgrade=installWorkbench(${JSON.stringify(upgraded.archive)},options);
const preserved=shell.get_strv('enabled-extensions');
const unchanged=installWorkbench(${JSON.stringify(upgraded.archive)},options);
GLib.unlink(dir+'/schemas/gschemas.compiled');
const repair=installWorkbench(${JSON.stringify(upgraded.archive)},options);
Gio.Settings.sync();
print(JSON.stringify({first,laterServer,enabled,bundledPui,upgrade,preserved,unchanged,repair,
 goals:prefs.get_strv('goals'),pui:prefs.get_string('pui-path'),
 compiled:GLib.file_test(dir+'/schemas/gschemas.compiled',GLib.FileTest.EXISTS)}));`);
            checkScript(driver);
            const result=spawnSync('gjs',['-m',driver],{encoding:'utf8',timeout:30000,env:{...process.env,
                XDG_DATA_HOME:join(temp,'data'),XDG_CONFIG_HOME:join(temp,'config'),
                XDG_CACHE_HOME:join(temp,'cache'),GSETTINGS_BACKEND:'keyfile',GIO_USE_VFS:'local'}});
            assert.equal(result.status,0,result.stderr||String(result.error));
            const evidence=JSON.parse(result.stdout.trim());
            assert.equal(evidence.first.firstInstall,true);
            assert.equal(evidence.laterServer.changed,false);
            assert.deepEqual(evidence.enabled,['unrelated@example.invalid',original.uuid]);
            assert.equal(evidence.bundledPui,pui);
            assert.equal(evidence.upgrade.changed,true);
            assert.deepEqual(evidence.preserved,['unrelated@example.invalid']);
            assert.equal(evidence.unchanged.changed,false);
            assert.equal(evidence.repair.changed,true);
            assert.equal(evidence.compiled,true);
            assert.deepEqual(evidence.goals,['<Super><Alt>g']);
            assert.equal(evidence.pui,'/custom/operator/pui');
            if(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR){
                mkdirSync(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,{recursive:true});
                writeFileSync(join(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,'gnome-distribution-install.json'),
                    JSON.stringify({...evidence,plane:'production bundle staging and private XDG installation; no desktop login restart or final artifact'},null,2)+'\n');
            }
            console.log('GNOME_DISTRIBUTION_INSTALL_PASS '+JSON.stringify(evidence));
    }));

test('real GTK4 resident helper correlates concurrent reads, preserves identity and exits on parent EOF',
    {skip:process.platform!=='linux',timeout:45000}, () => withNativeFixture('workbench-helper-',async temp=>{
            const pui=fixturePui(temp), driver=join(temp,'driver.mjs');
            writeFileSync(driver, `import {ResidentBridge} from ${JSON.stringify(pathToFileURL(join(root,'native/gnome/bridge.js')).href)};
const bridge=new ResidentBridge(${JSON.stringify(join(root,'native/gnome/helper.js'))});
const pui=${JSON.stringify(pui)};
const request={name:'identity',args:{id:'exact+/=& $()'}};
const [one,two]=await Promise.all([bridge.read(pui,request),bridge.read(pui,{name:'reports.get',args:{reportId:'exact+/=&'}})]);
if(JSON.stringify(one.rows[0])!==JSON.stringify(request)||two.rows[0].body_md!=='# Exact report exact+/=&')throw Error('Crossed response or lost identity');
const child=bridge._child;
let failed=false;try{await bridge.read(pui,{name:'failure'});}catch(e){failed=/ACL refusal/.test(e.message);}
if(!failed||bridge._child!==child)throw Error('Failure poisoned the resident process');
bridge.close();
await new Promise((resolve,reject)=>child.wait_async(null,(process,result)=>{try{process.wait_finish(result);if(!process.get_successful())throw Error('helper exited unsuccessfully');resolve();}catch(e){reject(e);}}));
let closed=false;try{await bridge.read(pui,request);}catch{closed=true;}
if(!closed)throw Error('Read succeeded after stop');
print('GTK_RESIDENT_PASS');
`);
            checkScript(driver);
            const runtime=join(temp,'runtime');mkdirSync(runtime,{mode:0o700});
            const env={...process.env,GSETTINGS_BACKEND:'memory',GTK_A11Y:'none',
                XDG_RUNTIME_DIR:runtime,GIO_USE_VFS:'local',LIBGL_ALWAYS_SOFTWARE:'1'};
            const result=await runOwned('xvfb-run',['-a','-s','-screen 0 1280x800x24 -nolisten tcp',
                'dbus-run-session',privateBus(temp),'--','gjs','-m',driver],env,35000,temp);
            assert.equal(result.status,0,JSON.stringify(result));
            assert.equal(result.error,null,JSON.stringify(result));
            assert.match(result.stdout,/GTK_RESIDENT_PASS/);
            assert.doesNotMatch(result.stderr,/Gjs-CRITICAL|JS ERROR|GLib-CRITICAL/);
    }));

test('production GNOME installation reports real reload state and survives private Shell login restarts',
    {skip:process.platform!=='linux',timeout:90000}, () => withNativeFixture('workbench-login-',async temp=>{
            const bundle=packageNativeWorkbench(join(temp,'bundle'));
            const upgradedSource=join(temp,'upgraded');
            cpSync(join(root,'native/gnome'),upgradedSource,{recursive:true});
            const metadata=JSON.parse(readFileSync(join(upgradedSource,'metadata.json'),'utf8'));
            metadata.name+=' upgrade lifecycle fixture';
            writeFileSync(join(upgradedSource,'metadata.json'),JSON.stringify(metadata));
            const upgrade=packageNativeWorkbench(join(temp,'upgrade'),{sourceDirectory:upgradedSource});
            const runtime=join(temp,'runtime');mkdirSync(runtime,{mode:0o700});
            const env={...process.env,XDG_DATA_HOME:join(temp,'data'),XDG_CONFIG_HOME:join(temp,'config'),
                XDG_CACHE_HOME:join(temp,'cache'),XDG_RUNTIME_DIR:runtime,GSETTINGS_BACKEND:'keyfile',
                GTK_A11Y:'none',LIBGL_ALWAYS_SOFTWARE:'1',GIO_USE_VFS:'local',GNOME_SHELL_SESSION_MODE:'user'};
            const install=join(temp,'install.mjs'),info=join(temp,'info.mjs');
            writeFileSync(install,`import {installWorkbench} from ${JSON.stringify(pathToFileURL(join(root,'native/linux/install-workbench.js')).href)};
print(JSON.stringify(installWorkbench(ARGV[0])));`);
            writeFileSync(info,`import Gio from 'gi://Gio';import GLib from 'gi://GLib';
const reply=Gio.DBus.session.call_sync('org.gnome.Shell','/org/gnome/Shell',
 'org.gnome.Shell.Extensions','GetExtensionInfo',new GLib.Variant('(s)',['workbench@papercusp.ai']),
 null,Gio.DBusCallFlags.NONE,1000,null);
const [values]=reply.deepUnpack();const result={};for(const [key,value] of Object.entries(values))result[key]=value.deepUnpack();
print(JSON.stringify(result));`);
            const driver=join(temp,'driver.mjs'),resultFile=join(temp,'result.json');
            writeFileSync(driver,`import {spawn,spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const evidence={phase:'prelogin',assertions:[],boots:[],installs:[]};let shell=null,closed=null;
function progress(){writeFileSync(${JSON.stringify(join(temp,'progress.json'))},JSON.stringify(evidence,null,2));}
function setPhase(phase){evidence.phase=phase;progress();}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function check(value,name){if(!value)throw Error(name);evidence.assertions.push(name);progress();}
function run(file,...args){const r=spawnSync('gjs',['-m',file,...args],{encoding:'utf8',timeout:8000});
 if(r.status!==0)throw Error(r.stderr||r.stdout||String(r.error));return JSON.parse(r.stdout.trim());}
function snapshot(){try{return run(${JSON.stringify(info)});}catch(error){return {unavailable:String(error)};}}
async function waitFor(predicate){const end=Date.now()+15000;do{const value=snapshot();evidence.lastInfo=value;progress();
 if(predicate(value))return value;if(shell.exitCode!==null)throw Error('Shell exited before '+evidence.phase);
 await delay(100);}while(Date.now()<end);throw Error('Shell convergence deadline: '+evidence.phase);}
async function stop(){if(!shell)return;shell.kill('SIGTERM');await Promise.race([closed,delay(3000)]);
 if(shell.exitCode===null&&shell.signalCode===null){shell.kill('SIGKILL');await closed;}shell=null;}
async function boot(expectedState=1){const boot={stdout:'',stderr:''};evidence.boots.push(boot);
 shell=spawn('gnome-shell',['--headless','--wayland','--no-x11','--virtual-monitor','1280x800','--wayland-display','workbench-login'],{stdio:['ignore','pipe','pipe']});
 shell.stdout.on('data',c=>{boot.stdout=(boot.stdout+c).slice(-12000);});shell.stderr.on('data',c=>{boot.stderr=(boot.stderr+c).slice(-12000);});
 closed=new Promise(resolve=>shell.once('close',(code,signal)=>{boot.code=code;boot.signal=signal;resolve();}));
 return waitFor(value=>value.state===expectedState);}
try{
 const first=run(${JSON.stringify(install)},${JSON.stringify(bundle.archive)});evidence.installs.push(first);
 check(first.changed&&first.firstInstall&&first.loginRequired,'prelogin install registers next login without claiming live activation');
 setPhase('first login');const initial=await boot();
 check(initial.name==='Papercusp Workbench','first login enables unchanged production extension');
 setPhase('live upgrade');const upgraded=run(${JSON.stringify(install)},${JSON.stringify(upgrade.archive)});evidence.installs.push(upgraded);
 const live=snapshot();evidence.upgradeInfo=live;
 check(upgraded.changed&&!upgraded.firstInstall,'production upgrade replaces installed archive');
 check(!/ServiceUnknown|UnknownObject|UnknownMethod/.test(upgraded.reloadError||''),'live installer addresses the actual Shell reload API');
 check(upgraded.loginRequired||live.state===1&&live.name===${JSON.stringify(metadata.name)},'reload success must correspond to the enabled upgraded extension');
 setPhase('second login');await stop();const second=await boot();
 check(second.name===${JSON.stringify(metadata.name)},'fresh Shell login loads persisted upgrade');
 setPhase('disable');const disabled=spawnSync('gnome-extensions',['disable','workbench@papercusp.ai'],{encoding:'utf8',timeout:8000});
 check(disabled.status===0,'GNOME disables production extension');await waitFor(value=>value.state===2);
 setPhase('disabled login');await stop();
 // A disabled extension is listed but must stay inactive across login.
 const disabledLogin=await boot(6);
 check(disabledLogin.state===6&&!disabledLogin.enabled,'disabled production extension remains disabled at next login');
 evidence.ok=true;
}catch(error){evidence.ok=false;evidence.error=String(error)+'; '+String(error.stack||'');}
finally{await stop();writeFileSync(${JSON.stringify(resultFile)},JSON.stringify(evidence,null,2));}
process.exitCode=evidence.ok?0:1;`);
            for(const file of [install,info,driver])checkScript(file);
            const result=await runOwned('dbus-run-session',[privateBus(temp),'--',process.execPath,driver],env,75000,temp);
            const evidence=existsSync(resultFile)?JSON.parse(readFileSync(resultFile,'utf8')):null;
            if(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR){
                mkdirSync(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,{recursive:true});
                writeFileSync(join(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,'gnome-login-lifecycle.json'),
                    JSON.stringify({evidence,...result,plane:'private production GNOME extension and real Shell lifecycle; no installed desktop artifact'},null,2)+'\n');
            }
            assert.equal(evidence?.ok,true,JSON.stringify({evidence,...result}));
            assert.equal(result.status,0,JSON.stringify(result));
            assert.equal(result.error,null,JSON.stringify(result));
            console.log('GNOME_LOGIN_LIFECYCLE_PASS '+JSON.stringify(evidence.assertions));
    }));

const selectedJourney=process.env.PAPERCUSP_GNOME_JOURNEY||'all';
assert.ok(['all','inbox','input','focus','resume','organizer','chat'].includes(selectedJourney),'Unknown PAPERCUSP_GNOME_JOURNEY');
// Preserve every scenario while bounding each independent desktop lifetime.
// The input journey includes the controller and Inbox cases; focus and Resume
// start from a fresh Shell and cannot spend each other's deadline budget.
for(const journey of selectedJourney==='all'?['input','focus','resume','organizer','chat']:[selectedJourney]){
test('private GNOME Shell renders actors and handles real seat keyboard, pointer and nested dismissal ['+journey+']',
    {skip:process.platform!=='linux',timeout:75000}, () => withNativeFixture('workbench-shell-',async temp=>{
            const evidenceDirectory=process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR&&
                join(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,'gnome-native-'+journey);
            const data=join(temp,'data'), config=join(temp,'config'), runtime=join(temp,'runtime');
            for(const dir of [data,config,runtime,join(temp,'cache')])mkdirSync(dir,{recursive:true,mode:0o700});
            const extension=join(data,'gnome-shell/extensions/workbench@papercusp.ai');
            const bundle=packageNativeWorkbench(join(temp,'bundle'));
            const install=spawnSync('gnome-extensions',['install','--force',bundle.archive],{
                env:{...process.env,XDG_DATA_HOME:data,XDG_CONFIG_HOME:config,
                    XDG_CACHE_HOME:join(temp,'cache'),GIO_USE_VFS:'local'},encoding:'utf8',timeout:15000});
            assert.equal(install.status,0,install.stderr||String(install.error));
            cpSync(join(extension,'extension.js'),join(extension,'workbench.js'));
            const pui=fixturePui(temp), resultFile=join(temp,'result.json');
            const screenshot=join(temp,'native-input.png');
            const focusDriver=join(temp,'focus-windows.mjs');
            writeFileSync(focusDriver,`import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
const app=new Gtk.Application({application_id:'ai.papercusp.Workbench.FocusFixture',flags:Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate',()=>{for(const title of ['Needle agent [adv:4242]','Needle agent [adv:42420]','Unselected terminal [adv:99]']){
 const window=new Gtk.ApplicationWindow({application:app,title,default_width:320,default_height:200});window.present();}});
app.run(['focus-fixture']);`);
            checkScript(focusDriver);
            writeFileSync(join(extension,'extension.js'), `import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Workbench from './workbench.js';
const assertions=[];
const inputLog=[];
const journey=${JSON.stringify(journey)};
const started=GLib.get_monotonic_time(),phases=[];
let phase='controller';
function progress(){GLib.file_set_contents(${JSON.stringify(join(temp,'progress.json'))},JSON.stringify({phase,journey,elapsedMs:(GLib.get_monotonic_time()-started)/1000,phases,assertions,inputLog}));}
function setPhase(value){phase=value;phases.push({phase,elapsedMs:(GLib.get_monotonic_time()-started)/1000});progress();}
function check(value,name){if(!value)throw Error(name);assertions.push(name);progress();}
function waitFor(predicate){return new Promise((resolve,reject)=>{let n=0;GLib.timeout_add(GLib.PRIORITY_DEFAULT,50,()=>{try{progress();if(predicate()){resolve();return GLib.SOURCE_REMOVE;}if(++n>180)throw Error('native state deadline: '+phase);return GLib.SOURCE_CONTINUE;}catch(error){reject(error);return GLib.SOURCE_REMOVE;}});});}
function tick(){return new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,40,()=>{resolve();return GLib.SOURCE_REMOVE;}));}
async function captureScreen(){const stream=Gio.File.new_for_path(${JSON.stringify(screenshot)}).replace(null,false,Gio.FileCreateFlags.REPLACE_DESTINATION,null);const shooter=new Shell.Screenshot();let timer;try{await Promise.race([new Promise((resolve,reject)=>shooter.screenshot(false,stream,(object,result)=>{try{object.screenshot_finish(result);resolve();}catch(error){reject(error);}})),new Promise((_,reject)=>{timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,3000,()=>{timer=null;reject(Error('Screenshot deadline'));return GLib.SOURCE_REMOVE;});})]);}finally{if(timer)GLib.source_remove(timer);stream.close(null);}}
export default class Probe extends Workbench {
 enable(){this._pointerCapture=global.stage.connect('captured-event',(_stage,event)=>{if(event.type()===Clutter.EventType.BUTTON_PRESS){const [x,y]=event.get_coords();const picked=global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,x,y);inputLog.push({button:event.get_button(),x,y,source:String(event.get_source()),picked:String(picked),inside:[...this._views].map(([surface,v])=>({surface,contains:v.panel.contains(picked)}))});}return Clutter.EVENT_PROPAGATE;});super.enable();GLib.timeout_add(GLib.PRIORITY_DEFAULT,500,()=>{this.probe().catch(error=>this.finish(error));return GLib.SOURCE_REMOVE;});}
 async finish(error){progress();if(error||!GLib.file_test(${JSON.stringify(screenshot)},GLib.FileTest.EXISTS)){try{await captureScreen();}catch(cause){inputLog.push({screenshotError:String(cause)});error||=cause;}}GLib.file_set_contents(${JSON.stringify(resultFile)},JSON.stringify({ok:!error,error:error?String(error)+'; '+String(error.stack||''):null,phase,journey,inputLog,actionMode:Main.actionMode,overview:Main.overview.visible,windows:global.get_window_actors().map(actor=>({title:actor.meta_window.get_title(),minimized:actor.meta_window.minimized,focused:actor.meta_window===global.display.focus_window})),states:[...this._states].map(([surface,s])=>({surface,visible:s.visible,pinned:s.pinned,selection:s.selection,detail:s.detail})),assertions}));if(this._focusFixture){this._focusFixture.force_exit();await new Promise(resolve=>this._focusFixture.wait_async(null,(child,result)=>{child.wait_finish(result);resolve();}));}if(this._inputCapture)global.stage.disconnect(this._inputCapture);global.stage.disconnect(this._pointerCapture);this.disable();global.context.terminate();}
 async probe(){
  this._settings.set_string('pui-path',${JSON.stringify(pui)});
  check(this._bindings.size===5,'native shortcut acquisition');
  const qa=this._states.get('quick-access'),goals=this._states.get('goals');
  const seat=Clutter.get_default_backend().get_default_seat();
  check(typeof seat.create_virtual_device==='function','native seat supports input injection');
  const keyboard=seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  const pointer=seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  check(typeof keyboard.notify_keyval==='function'&&typeof pointer.notify_absolute_motion==='function','native input methods exist');
  this._inputCapture=global.stage.connect('captured-event',(_stage,event)=>{if(event.type()===Clutter.EventType.KEY_PRESS)inputLog.push({key:event.get_key_symbol(),mode:Main.actionMode});return Clutter.EVENT_PROPAGATE;});
  const time=()=>GLib.get_monotonic_time();
  const key=async symbol=>{keyboard.notify_keyval(time(),symbol,Clutter.KeyState.PRESSED);await tick();keyboard.notify_keyval(time(),symbol,Clutter.KeyState.RELEASED);await tick();};
  const chord=async symbols=>{for(const symbol of symbols){keyboard.notify_keyval(time(),symbol,Clutter.KeyState.PRESSED);await tick();}for(const symbol of [...symbols].reverse()){keyboard.notify_keyval(time(),symbol,Clutter.KeyState.RELEASED);await tick();}};
  const primaryButton=Clutter.BUTTON_PRIMARY;
  const click=async findActor=>{
   const deadline=GLib.get_monotonic_time()+2000000;
   do{
    await tick();const actor=findActor();if(!actor)continue;
    const [x,y]=actor.get_transformed_position(),[w,h]=actor.get_transformed_size();
    pointer.notify_absolute_motion(time(),x+w/2,y+h/2);await tick();
    // A canonical source may settle and replace the result controls while
    // the pointer is moving. Never inspect or click the disposed old actor.
    if(findActor()!==actor){inputLog.push({replacedActor:phase});continue;}
    pointer.notify_button(time(),primaryButton,Clutter.ButtonState.PRESSED);await tick();
    pointer.notify_button(time(),primaryButton,Clutter.ButtonState.RELEASED);await tick();return;
   }while(GLib.get_monotonic_time()<deadline);
   throw Error('No stable current native control: '+phase);
  };
  setPhase('desktop startup');
  await waitFor(()=>!Main.layoutManager._startingUp);
  if(Main.overview.visible)await key(Clutter.KEY_Escape);
  await waitFor(()=>Main.actionMode===Shell.ActionMode.NORMAL);
  check(!Main.overview.visible,'desktop ready for normal shortcuts');
  if(journey==='chat'){
   setPhase('chat shortcut and canonical history');
   await chord([Clutter.KEY_Super_L,Clutter.KEY_Shift_L,Clutter.KEY_p]);
   const chat=this._chat;
   await waitFor(()=>chat.ready);
   check(this._states.get('papercup').visible&&this._views.get('papercup').panel.get_parent()!==null,
    'Papercup shortcut opens native Shell actor');
   check(chat.turns.length===1&&chat.turns[0].seq===5,'saved transcript reaches native chat');
   check(this._views.get('papercup').panel.contains(global.stage.get_key_focus()),'canonical history completion focuses native composer');
   setPhase('chat native Markdown and literal code');
   await waitFor(()=>chat.referencePlans.length===1);
   const descendants=actor=>[actor,...(actor.get_children?.()||[]).flatMap(descendants)];
   const contentActors=()=>descendants(this._views.get('papercup').content);
   const contentButton=name=>contentActors().find(actor=>actor instanceof St.Button&&actor.get_label()===name);
   const bold=contentActors().find(actor=>actor instanceof St.Label&&actor.text==='Native bold and literal <&>.');
   check(Boolean(bold)&&bold.clutter_text.get_use_markup()&&Boolean(bold.clutter_text.get_attributes()),
    'Markdown renders styled native text without literal Markdown delimiters');
   const codeActor=contentActors().find(actor=>actor instanceof St.Label&&actor.text===${JSON.stringify(chatCode)});
   check(Boolean(codeActor),
    'fenced code preserves literal markup characters in a native actor');
   await tick();
   const codeViewport=codeActor.get_parent().get_parent();
   const codeHeight=codeActor.get_transformed_size()[1],viewportHeight=codeViewport.get_transformed_size()[1];
   check(codeActor.mapped&&codeHeight>0&&viewportHeight>=codeHeight,
    'native code scroll viewport allocates visible height for its literal text');
   check(!contentButton('WI-999')&&!contentButton('P-007'),'code references and unscoped plan references remain inert');
   const opened=[];this._launchChatUri=uri=>opened.push(uri);
   await click(()=>contentButton('Copy code'));
   const clipboard=await new Promise(resolve=>St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD,(_clipboard,text)=>resolve(text)));
   check(clipboard===${JSON.stringify(chatCode)},'native Copy code writes exact literal code to the clipboard');
   setPhase('chat native plan-context selection and links');
   this._views.get('papercup').compose.set_text('Retained draft');
   const conversationBefore=chat.conversationId;
   await click(()=>this._views.get('papercup').referenceChoice);
   await click(()=>this._views.get('papercup').referenceOptions.get_children().find(actor=>actor.get_label()==='exact-harness / same'));
   check(chat.referenceContext.harness==='exact-harness'&&chat.referenceContext.planSlug==='same'&&
    chat.conversationId===conversationBefore&&chat.draft==='Retained draft',
    'native plan context changes work links while preserving conversation and draft');
   await click(()=>contentButton('WI-123'));
   await click(()=>contentButton('P-007'));
   await click(()=>contentButton('Docs'));
   check(JSON.stringify(opened)===JSON.stringify(['http://fixture/?wpop=exact-harness%3A%3AWI-123',
    'http://fixture/?wppop=exact-harness%3A%3Asame','https://example.test/docs?x=1&y=2']),
    'native links activate exact shared work-item and plan-item popup grammar and external URL');
   await captureScreen();
   await click(()=>this._views.get('papercup')?.earlier);
   await waitFor(()=>!chat.loading&&chat.turns[0]?.seq===1);
   check(chat.turns.length===2&&!chat.hasMoreEarlier,'Earlier messages prepends canonical page');
   setPhase('chat draft and conversation isolation');
   this._views.get('papercup').compose.set_text('Retained draft');
   check(this._views.get('papercup').panel.contains(global.stage.get_key_focus()),'chat child control owns keyboard focus');
   setPhase('chat Escape after Earlier action');
   await key(Clutter.KEY_Escape);await waitFor(()=>!this._views.has('papercup'));
   check(!this._states.get('papercup').visible,'Escape closes chat without application window');
   setPhase('chat reopen restores draft');
   await chord([Clutter.KEY_Super_L,Clutter.KEY_Shift_L,Clutter.KEY_p]);await waitFor(()=>chat.ready);
   check(this._views.get('papercup').compose.get_text()==='Retained draft','reopen preserves conversation draft');
   GLib.file_set_contents(${JSON.stringify(join(temp,'conversation-id'))},'different-conversation');
   setPhase('chat different conversation binding');
   this._refreshChat();await waitFor(()=>chat.ready&&chat.conversationId==='different-conversation');
   check(chat.draft===''&&this._views.get('papercup').compose.get_text()==='','another conversation cannot inherit draft');
   GLib.file_set_contents(${JSON.stringify(join(temp,'conversation-id'))},'conversation+/=&');
   this._refreshChat();await waitFor(()=>chat.ready&&chat.conversationId==='conversation+/=&');
   check(chat.draft==='Retained draft','returning to conversation restores only its draft');
   setPhase('chat progressive native send');
   this._views.get('papercup').compose.grab_key_focus();
   await chord([Clutter.KEY_Control_L,Clutter.KEY_a]);
   for(const symbol of [Clutter.KEY_h,Clutter.KEY_e,Clutter.KEY_l,Clutter.KEY_l,Clutter.KEY_o])await key(symbol);
   check(chat.draft==='hello','seat typing reaches native chat composer');
   await key(Clutter.KEY_Return);
   await waitFor(()=>chat.reply?.displayText==='Hello');
   check(!chat.reply.complete&&!chat.canSend,'partial reply renders before producer is released and blocks duplicate send');
   check(chat.draft===''&&chat.turns.at(-1).role==='user','exact saved acknowledgement clears submitted draft');
   check(this._views.get('papercup').content.get_children().some(actor=>actor.text==='Hello'),
    'progressive reply is present in actual Shell actor');
   GLib.file_set_contents(${JSON.stringify(join(temp,'chat-release'))},'consumer observed');
   await waitFor(()=>chat.ready&&!chat.reply&&chat.turns.at(-1)?.text==='Hello from Papercup');
   check(chat.turns.filter(row=>row.role==='user'&&row.text==='hello').length===1,
    'completion reloads persisted transcript without duplicate user turn');
   setPhase('chat reconnect exact saved turn');
   this._views.get('papercup').compose.set_text('recover');await click(()=>this._views.get('papercup')?.send);
   await waitFor(()=>chat.reply?.phase==='needs-reconciliation');
   check(!chat.canSend&&this._views.get('papercup').reconnect.visible,'disconnect exposes reconciliation without a second send');
   await click(()=>this._views.get('papercup')?.reconnect);
   await waitFor(()=>chat.ready&&!chat.reply&&chat.turns.at(-1)?.role==='assistant');
   let [ok,bytes]=GLib.file_get_contents(${JSON.stringify(join(temp,'chat-actions.json'))});
   let requests=JSON.parse(new TextDecoder().decode(bytes));
   check(requests[0].operation==='send'&&requests[0].text==='hello'&&requests[0].environment.workspaceId==='exact'&&
    requests[0].conversationId==='conversation+/=&'&&typeof requests[0].userTurnId==='string',
    'Send retains exact selected environment conversation and saved user identity');
   check(ok&&requests.length===3&&requests[2].operation==='reconnect'&&requests[2].afterSequence===1&&
    requests[2].turnId==='00000000-0000-4000-8000-000000000002'&&!requests[2].text,
    'Reconnect passes exact saved turn and cursor without replaying send');
   setPhase('chat canonical cancellation');
   this._views.get('papercup').compose.set_text('cancel');await click(()=>this._views.get('papercup')?.send);
   await waitFor(()=>chat.reply?.displayText==='Hello');
   await click(()=>this._views.get('papercup')?.cancelReply);
   await waitFor(()=>chat.reply?.phase==='cancelled');
   check(chat.reply.complete,'Cancel requires canonical saved cancellation receipt');
   [ok,bytes]=GLib.file_get_contents(${JSON.stringify(join(temp,'chat-actions.json'))});requests=JSON.parse(new TextDecoder().decode(bytes));
   check(requests.at(-1).operation==='cancel'&&requests.at(-1).conversationId==='conversation+/=&',
    'Cancel retains exact conversation identity');
   check(global.get_window_actors().length===0,'Papercup remains outside Dock taskbar and Alt-Tab application windows');
   await captureScreen();return this.finish(null);
  }
  if(journey!=='resume'){
  if(!['focus','organizer'].includes(journey)){
  setPhase('controller');
  this._toggle('quick-access');
  await waitFor(()=>Object.values(this._states.get('quick-access').sources).every(s=>s.status!=='loading'));
  check(qa.results().some(r=>r.row.harness==='exact-harness'),'qualified plan reached native actor model');
  check(this._views.get('quick-access').panel.get_parent()!==null,'Shell actor is attached');
  check(this._views.get('quick-access').content.get_children().length===3,'native result controls rendered');
  qa.pinned=true;this._toggle('goals');
  await waitFor(()=>goals.sources.goals?.status==='ready');
  check(this._views.size===2&&qa.visible&&goals.visible,'independent pinned panels coexist');
  check(Object.keys(goals.sources).join(',')==='goals','Goals requests only its canonical source');
  check(global.get_window_actors().length===0,'panels and GTK helper create no application windows');
  this._views.get('quick-access').search.set_text('Needle');
  await waitFor(()=>qa.sources.reports?.status==='ready'&&qa.sources.reports.rows[0]?.title==='Report Needle');
  check(qa.query==='Needle'&&qa.results().some(r=>r.row.report_id==='exact+/=&'),'debounced canonical query renders current result');
  await this._activate('quick-access',qa.results().find(r=>r.kind==='reports'));
  check(qa.detail?.text==='# Exact report exact+/=&','exact report body in native detail');
  this._escape('quick-access');
  check(!qa.detail&&qa.visible&&goals.visible,'first Escape dismisses detail only');
  this._escape('quick-access');
  check(!qa.visible&&goals.visible&&this._views.size===1,'second Escape dismisses only its surface');
  goals.pinned=true;
  this._toggle('quick-access');
  check(qa.query==='Needle'&&qa.selection.includes('exact+/=&'),'reopen retains query and exact selection');
  qa.pinned=false;goals.pinned=true;qa.outsideFocus();this._hide('quick-access',false);
  check(!qa.visible&&goals.visible,'outside dismissal preserves another pinned surface');
  this._toggle('goals');
  check(this._views.size===0&&!goals.visible,'repeated shortcut toggles pinned surface');
  setPhase('inbox');this._toggle('inbox');
  await waitFor(()=>this._inbox.listReady&&this._inbox.bulkReady);
  check(this._inbox.rows[0].id==='question+/=&','Inbox canonical list reaches native actor');
  check(this._views.get('inbox').bulkStatus.text.includes('1/8 decided'),'Inbox persisted denominator reaches native status');
  await this._loadInboxContext('question+/=&');
  check(this._inbox.context.body==='Exact context','Inbox selected context preserves exact identity');
  this._inbox.answer=' Native answer ';this._prepareInbox('resolve',{actionId:'answer'});
  check(this._views.get('inbox').confirmRequests[0].answer==='Native answer','Inbox confirmation freezes edited answer');
  await this._confirmInbox();await waitFor(()=>this._inbox.listReady&&this._inbox.bulkReady);
  check(this._inbox.applied.has('question+/=&'),'Inbox write uses helper native-inbox and verifies terminal receipt');
  check(global.get_window_actors().length===0,'Inbox adds no application window');
  this._hide('inbox',false);
  check(!this._views.has('inbox'),'Inbox dismissal removes native actors and run refresh');
  if(journey==='inbox')return this.finish(null);
  // These go through Mutter's virtual seat and the actual event dispatch path.
  // No Workbench controller or synthetic signal is called for this phase.
  qa.pinned=false;goals.pinned=false;
  setPhase('shortcut');
  await chord([Clutter.KEY_Super_L,Clutter.KEY_Alt_L,Clutter.KEY_space]);
  await waitFor(()=>qa.visible&&qa.sources.reports?.status==='ready');
  check(this._views.has('quick-access'),'seat shortcut opens panel');
  setPhase('typing');
  await chord([Clutter.KEY_Control_L,Clutter.KEY_a]);
  for(const symbol of [Clutter.KEY_n,Clutter.KEY_e,Clutter.KEY_e,Clutter.KEY_d,Clutter.KEY_l,Clutter.KEY_e])await key(symbol);
  await waitFor(()=>qa.query==='needle'&&qa.sources.reports?.rows?.[0]?.title==='Report needle');
  check(this._views.get('quick-access').search.get_text()==='needle','seat typing reaches focused native search');
  setPhase('navigation');
  // Each source completes independently. A report response alone does not
  // establish the two-result population that this navigation case exercises.
  await waitFor(()=>Object.values(qa.sources).every(source=>source.status==='ready')&&
    qa.results().some(row=>row.kind==='goals'));
  await key(Clutter.KEY_Down);
  check(qa.selected()?.kind==='goals','seat arrow navigates results');
  await key(Clutter.KEY_Up);
  check(qa.selected()?.kind==='reports','seat Up restores exact report selection');
  let entryActivated=false;
  this._views.get('quick-access').search.clutter_text.connect('activate',()=>{entryActivated=true;});
  await key(Clutter.KEY_Return);
  check(entryActivated,'focused search consumes Enter through native activate signal');
  await waitFor(()=>qa.detail?.text==='# Exact report exact+/=&');
  check(qa.visible,'seat Enter opens exact selected detail');
  setPhase('detail escape');
  await key(Clutter.KEY_Escape);
  await waitFor(()=>!qa.detail);
  check(qa.visible,'seat Escape dismisses detail before surface');
  setPhase('pin click');
  const pin=this._views.get('quick-access').panel.get_first_child().get_children()[1];
  await click(()=>this._views.get('quick-access')?.panel.get_first_child().get_children()[1]);
  check(qa.pinned&&pin.label==='Unpin','seat click pins native panel');
  setPhase('second shortcut');
  await chord([Clutter.KEY_Super_L,Clutter.KEY_Shift_L,Clutter.KEY_g]);
  await waitFor(()=>goals.visible&&goals.sources.goals?.status==='ready');
  check(qa.visible&&this._views.size===2,'seat second shortcut preserves independent pin');
  await tick();
  await captureScreen();
  check(global.get_window_actors().length===0,'seat journey keeps native surfaces outside application windows');
  setPhase('outside click');
  pointer.notify_absolute_motion(time(),5,450);await tick();
  pointer.notify_button(time(),primaryButton,Clutter.ButtonState.PRESSED);await tick();
  pointer.notify_button(time(),primaryButton,Clutter.ButtonState.RELEASED);await tick();
  await waitFor(()=>!goals.visible);
  check(qa.visible&&qa.pinned,'seat outside click closes unpinned panel and preserves pin');
  setPhase('final toggle');
  await chord([Clutter.KEY_Super_L,Clutter.KEY_Alt_L,Clutter.KEY_space]);
  await waitFor(()=>!qa.visible);
  check(this._views.size===0,'seat shortcut toggles pinned panel closed');
  if(journey==='input')return this.finish(null);
  }
  setPhase('focus fixture mapping');
  this._focusFixture=Gio.Subprocess.new(['gjs','-m',${JSON.stringify(focusDriver)}],Gio.SubprocessFlags.NONE);
  await waitFor(()=>{
   const actors=global.get_window_actors().filter(actor=>actor.meta_window.get_title()?.startsWith('Needle agent [adv:'));
   return actors.length===2&&actors.every(actor=>actor.mapped);
  });
  setPhase('focus fixture ready');
  const distractor=global.get_window_actors().find(actor=>actor.meta_window.get_title()==='Needle agent [adv:42420]').meta_window;
  const focusSnapshot=step=>inputLog.push({focusStep:step,currentTime:global.get_current_time(),
   windows:global.get_window_actors().map(actor=>({title:actor.meta_window.get_title(),mapped:actor.mapped,
    userTime:actor.meta_window.get_user_time(),focused:actor.meta_window===global.display.focus_window}))});
  focusSnapshot('before mapped fixture activation');
  Main.activateWindow(distractor);
  await waitFor(()=>global.display.focus_window?.get_title()==='Needle agent [adv:42420]');
  focusSnapshot('distractor focus verified');
  const agent={ownerId:'exact-local-agent',label:'Needle agent',host:GLib.get_host_name(),
    sessionState:'live',advSessionId:4242,pid:Number(this._focusFixture.get_identifier())};
  if(journey==='organizer'){
   setPhase('native Organizer placement');
   const otherDesktop=global.workspace_manager.append_new_workspace(false,global.get_current_time());
   distractor.change_workspace(otherDesktop);
   const untouched=global.get_window_actors().find(actor=>actor.meta_window.get_title()==='Unselected terminal [adv:99]').meta_window;
   const before=untouched.get_frame_rect(), beforeDesktop=untouched.get_workspace().index();
   const first={...agent,potSlug:'exact-harness',currentPlanSlug:'same',fleetSlug:'exact-fleet'};
   const second={...first,ownerId:'other-desktop-agent',advSessionId:42420};
   const remote={...first,ownerId:'remote-agent',advSessionId:8,host:'remote-host'};
   const offline={...first,ownerId:'offline-agent',advSessionId:9,stale:true};
   const missing={...first,ownerId:'missing-agent',advSessionId:10};
   GLib.file_set_contents(${JSON.stringify(join(temp,'roster.json'))},JSON.stringify({active:[first,second,remote,offline,missing],ended:[]}));
   await chord([Clutter.KEY_Super_L,Clutter.KEY_Shift_L,Clutter.KEY_o]);
   const organizer=this._states.get('organizer');
   await waitFor(()=>organizer.visible&&organizer.sources.agents?.status==='ready');
   check(this._views.get('organizer').panel.get_parent()!==null,'Organizer shortcut summons a native actor');
   const arrange=async text=>{
    await click(()=>this._views.get('organizer')?.content.get_children().find(actor=>actor.label===text));
    await waitFor(()=>!organizer.organizing&&organizer.organizerReceipts?.length===5);
    check(organizer.organizerReceipts.map(row=>row.status).join(',')==='moved,moved,unsupported,offline,failed',
     text+' verifies exact placement and partial failures');
   };
   await arrange('Arrange exact-harness / same');
   check(new Set(organizer.organizerReceipts.filter(row=>row.status==='moved').map(row=>row.desktop)).size===2,
    'selected terminals remain on two distinct desktops');
   const after=untouched.get_frame_rect();
   check(['x','y','width','height'].every(key=>before[key]===after[key])&&untouched.get_workspace().index()===beforeDesktop,
    'unselected terminal sharing the process remains unchanged');
   organizer.organizerKind='fleet';this._renderOrganizer();await arrange('Arrange exact-fleet');
   await waitFor(()=>organizer.sources.goals?.status==='ready');
   organizer.organizerKind='goal';this._renderOrganizer();await arrange('Arrange Goal ');
   check(organizer.organizerReceipts.filter(row=>row.status==='moved').every(row=>row.observed&&row.requested),
    'native receipts retain requested and observed geometry');
   check(this._views.get('organizer').content.get_children().some(actor=>actor.text?.includes('remote-host')&&actor.text.includes('unsupported')),
    'native panel exposes remote desktop failure');
   this._hide('organizer',false);check(!organizer.visible,'Organizer dismisses independently');
   return this.finish(null);
  }
  GLib.file_set_contents(${JSON.stringify(join(temp,'roster.json'))},JSON.stringify({active:[agent],ended:[]}));
  setPhase('focus roster loaded');
  qa.pinned=false;this._toggle('quick-access');
  await waitFor(()=>qa.results().some(row=>row.kind==='agents'));
  const selectedAgent=qa.results().find(row=>row.kind==='agents');
  setPhase('stale native agent focus');
  const priorFocus=global.display.focus_window;
  GLib.file_set_contents(${JSON.stringify(join(temp,'roster.json'))},JSON.stringify({active:[{...agent,advSessionId:4243}],ended:[]}));
  await this._activate('quick-access',selectedAgent);
  check(qa.visible&&qa.detail?.text.includes('session changed'),
    'native activation refuses a newer session behind the same selected owner');
  check(global.display.focus_window===priorFocus,
    'stale selection leaves the previously focused terminal unchanged');
  GLib.file_set_contents(${JSON.stringify(join(temp,'roster.json'))},JSON.stringify({active:[agent],ended:[]}));
  setPhase('exact native agent focus');
  await this._activate('quick-access',selectedAgent);
  check(global.display.focus_window?.get_title()==='Needle agent [adv:4242]',
    'native activation observes exact launch window despite shared process and similar titles');
  check(!qa.visible,'verified terminal focus dismisses its native launcher');
  check(qa.detail===null,'verified terminal focus clears transient loading detail');
  this._toggle('quick-access');
  await waitFor(()=>Object.values(qa.sources).every(source=>source.status==='ready'));
  check(qa.visible&&!qa.detail,'reopened native launcher shows results after verified focus');
  check(this._views.get('quick-access').content.get_children().some(actor=>actor.accessible_name==='agents: Needle agent'),
    'reopened native launcher renders a current agent control');
  return this.finish(null);
  }
  setPhase('native explicit resume');
  const ended={id:4241,coordOwnerId:'ended-owner',agent:'codex',label:'Needle ended session',
    hostname:GLib.get_host_name()};
  const writeRoster=value=>GLib.file_set_contents(${JSON.stringify(join(temp,'roster.json'))},JSON.stringify(value));
  writeRoster({active:[],ended:[ended]});
  this._toggle('quick-access');
  await waitFor(()=>Object.values(qa.sources).every(source=>source.status==='ready')&&qa.results().some(row=>row.row.advSessionId===4241));
  const selectedEnded=qa.results().find(row=>row.row.advSessionId===4241);
  const handoffs=[];
  const launchResume=this._launchResume;
  this._launchResume=argv=>handoffs.push(argv);
  writeRoster({active:[{ownerId:'ended-owner',advSessionId:4243,sessionState:'live'}],ended:[ended]});
  await this._resume('quick-access',selectedEnded);
  check(qa.visible&&qa.detail?.text.includes('running')&&handoffs.length===0,
    'native Resume refuses a running replacement before opening a terminal');
  writeRoster({active:[],ended:[ended]});
  this._launchResume=()=>{throw new Error('fixture terminal unavailable');};
  await this._resume('quick-access',selectedEnded);
  check(qa.visible&&qa.detail?.text.includes('terminal unavailable'),
    'failed terminal launch stays visible with its error');
  this._launchResume=argv=>handoffs.push(argv);
  qa.detail=null;this._render('quick-access');
  const resumeButton=this._views.get('quick-access').content.get_children()
    .find(actor=>actor.accessible_name==='Resume session: Needle ended session');
  check(Boolean(resumeButton),'ended result exposes an explicit native Resume button');
  let replaceControl=true;
  await click(()=>{
    const actor=this._views.get('quick-access')?.content.get_children()
      .find(actor=>actor.accessible_name==='Resume session: Needle ended session');
    if(actor&&replaceControl){replaceControl=false;GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE,()=>{
      this._render('quick-access');return GLib.SOURCE_REMOVE;});}
    return actor;
  });
  check(inputLog.some(row=>row.replacedActor===phase),
    'native click reacquires a result replaced during pointer motion');
  await waitFor(()=>handoffs.length===1);
  check(JSON.stringify(handoffs[0])===JSON.stringify([${JSON.stringify(pui)},'workbench','resume',
    '4241',GLib.get_host_name(),'ended-owner']),
    'seat Resume passes the exact ID, host and owner through the configured PUI argv');
  check(!qa.visible,'accepted terminal handoff dismisses its native launcher');
  setPhase('native saved remote resume');
  writeRoster({active:[],ended:[{...ended,hostname:'saved-remote'}]});
  this._toggle('quick-access');
  await waitFor(()=>Object.values(qa.sources).every(source=>source.status==='ready'));
  await this._resume('quick-access',qa.results().find(row=>row.row.advSessionId===4241));
  check(handoffs.length===2&&handoffs[1][4]==='saved-remote',
    'native remote Resume preserves the saved host for terminal-side connection selection');
  check(qa.detail===null,'accepted Resume clears transient checking detail before reopen');
  setPhase('real GIO terminal launch');
  this._launchResume=launchResume;
  writeRoster({active:[],ended:[ended]});
  this._toggle('quick-access');
  await waitFor(()=>Object.values(qa.sources).every(source=>source.status==='ready'));
  const realResume=this._views.get('quick-access').content.get_children()
    .find(actor=>actor.accessible_name==='Resume session: Needle ended session');
  check(Boolean(realResume),'real terminal journey exposes the selected Resume button');
  await click(()=>this._views.get('quick-access')?.content.get_children()
    .find(actor=>actor.accessible_name==='Resume session: Needle ended session'));
  await waitFor(()=>GLib.file_test(${JSON.stringify(join(temp,'terminal-launch.json'))},GLib.FileTest.EXISTS));
  const launched=JSON.parse(new TextDecoder().decode(GLib.file_get_contents(
    ${JSON.stringify(join(temp,'terminal-launch.json'))})[1]));
  check(JSON.stringify(launched.argv)===JSON.stringify(['workbench','resume','4241',
    GLib.get_host_name(),'ended-owner']),
    'production GIO terminal launch preserves exact arguments and quoted PUI executable path');
  check(launched.tty.every(Boolean),'GIO launches the selected command inside a real terminal PTY');
  check(!qa.visible,'real terminal handoff dismisses its native launcher');
  this.finish(null);
 }
}
`);
            checkScript(join(extension,'extension.js'));
            const sourceCustody={archiveSha256:bundle.sha256,journey,
                files:Object.fromEntries(['extension.js','workbench.js','panel-model.mjs','bridge.js','helper.js','chat-content.js',
                    'schemas/org.gnome.shell.extensions.papercusp-workbench.gschema.xml'].map(file=>
                    [file,createHash('sha256').update(readFileSync(join(extension,file))).digest('hex')])),
                testSha256:createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex')};
            writeFileSync(join(temp,'source-custody.json'),JSON.stringify(sourceCustody,null,2)+'\n');
            const env={...process.env,XDG_DATA_HOME:data,XDG_CONFIG_HOME:config,XDG_CACHE_HOME:join(temp,'cache'),
                XDG_RUNTIME_DIR:runtime,GSETTINGS_BACKEND:'keyfile',GTK_A11Y:'none',
                LIBGL_ALWAYS_SOFTWARE:'1',GIO_USE_VFS:'local',GNOME_SHELL_SESSION_MODE:'user',WAYLAND_DISPLAY:'workbench-test'};
            // The private keyfile backend never touches the owner's dconf.
            const settings=spawnSync('gsettings',['set','org.gnome.shell','enabled-extensions',
                "['workbench@papercusp.ai']"],{env,encoding:'utf8'});
            assert.equal(settings.status,0,settings.stderr);
            if(journey==='resume')await terminalPreflight(temp,env);
            writeFileSync(join(temp,'progress.json'),JSON.stringify({phase:'Shell boot',journey,assertions:[]}));
            const result=await runOwned('dbus-run-session',[privateBus(temp),'--','gnome-shell','--headless','--wayland','--no-x11',
                '--virtual-monitor','1440x900','--wayland-display','workbench-test'],env,45000,temp);
            const evidence=existsSync(resultFile)?JSON.parse(readFileSync(resultFile,'utf8')):null;
            const progress=JSON.parse(readFileSync(join(temp,'progress.json'),'utf8'));
            // Retain failure evidence before assertions or cleanup, so a failed
            // journey is diagnosable without another expensive desktop boot.
            if(evidenceDirectory){
                mkdirSync(evidenceDirectory,{recursive:true});
                writeFileSync(join(evidenceDirectory,'gnome-native-process.json'),
                    JSON.stringify({evidence,progress,sourceCustody,...result},null,2)+'\n');
                if(existsSync(screenshot))cpSync(screenshot,join(evidenceDirectory,'gnome-native-input.png'));
            }
            assert.equal(evidence?.ok,true,JSON.stringify({evidence,progress,...result}));
            assert.equal(result.status,0,JSON.stringify(result));
            assert.equal(result.error,null,JSON.stringify(result));
            const minimumAssertions={inbox:25,input:36,focus:11,resume:16,organizer:13,chat:31};
            assert.ok(evidence.assertions.length>=minimumAssertions[journey],JSON.stringify(evidence));
            assert.deepEqual([...readFileSync(screenshot).subarray(0,8)], [137,80,78,71,13,10,26,10]);
            if(evidenceDirectory){
                mkdirSync(evidenceDirectory,{recursive:true});
                cpSync(screenshot,join(evidenceDirectory,'gnome-native-input.png'));
                writeFileSync(join(evidenceDirectory,'gnome-native-input.json'),
                    JSON.stringify({...evidence,sourceCustody,plane:'private GNOME virtual seat; fixture PUI; current build'},null,2)+'\n');
            }
            console.log('GNOME_NATIVE_PASS '+JSON.stringify({...evidence,sourceCustody}));
    }));
}
