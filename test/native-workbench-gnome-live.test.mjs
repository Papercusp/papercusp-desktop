import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import test from 'node:test';
import {packageNativeWorkbench} from '../bin/package-native-workbench.mjs';

const root = resolve(import.meta.dirname, '..');
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
let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{
const r=JSON.parse(text);let rows=[];
if(r.name==='failure'){console.error('canonical ACL refusal');process.exitCode=1;return;}
if(r.name==='plans.list')rows=[{harness:'exact-harness',slug:'same',title:'Plan'}];
else if(r.name==='advRoster.list')rows=[{active:[],ended:[]}];
else if(r.name==='goals.list')rows=[{goals:[{id:'goal-id',title:'Goal '+(r.args.query||'')}],totalGoals:1}];
else if(r.name==='reports.list')rows=[{report_id:'exact+/=&',title:'Report '+(r.args.query||'')}];
else if(r.name==='reports.get')rows=[{body_md:'# Exact report '+r.args.reportId}];
else rows=[r];
console.log(JSON.stringify({rows,version:'native-fixture'}));});
`, {mode:0o700});
    return file;
}
function runOwned(command, args, env, timeout = 35000) {
    return new Promise(resolveResult => {
        const child=spawn(command,args,{env,detached:true,stdio:['ignore','pipe','pipe']});
        let stdout='',stderr='',error=null;
        child.stdout.on('data',data=>{stdout=(stdout+data).slice(-20000);});
        child.stderr.on('data',data=>{stderr=(stderr+data).slice(-20000);});
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
            resolveResult({status,signal,error,stdout,stderr});});
    });
}

test('GNOME archive installs all runtime sources and preserves private preferences across upgrade',
    {skip:process.platform!=='linux',timeout:45000}, () => {
        const temp=mkdtempSync(join(tmpdir(),'workbench-install-'));
        try {
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
        } finally {rmSync(temp,{recursive:true,force:true});}
    });

test('real GTK4 resident helper correlates concurrent reads, preserves identity and exits on parent EOF',
    {skip:process.platform!=='linux',timeout:45000}, async () => {
        const temp=mkdtempSync(join(tmpdir(),'workbench-helper-'));
        try {
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
                'dbus-run-session',privateBus(temp),'--','gjs','-m',driver],env);
            assert.equal(result.status,0,JSON.stringify(result));
            assert.equal(result.error,null,JSON.stringify(result));
            assert.match(result.stdout,/GTK_RESIDENT_PASS/);
            assert.doesNotMatch(result.stderr,/Gjs-CRITICAL|JS ERROR|GLib-CRITICAL/);
        } finally {rmSync(temp,{recursive:true,force:true});}
    });

test('private GNOME Shell renders actors and handles real seat keyboard, pointer and nested dismissal',
    {skip:process.platform!=='linux',timeout:60000}, async () => {
        const temp=mkdtempSync(join(tmpdir(),'workbench-shell-'));
        try {
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
            writeFileSync(join(extension,'extension.js'), `import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Workbench from './workbench.js';
const assertions=[];
const inputLog=[];
let phase='controller';
function check(value,name){if(!value)throw Error(name);assertions.push(name);}
function waitFor(predicate){return new Promise((resolve,reject)=>{let n=0;GLib.timeout_add(GLib.PRIORITY_DEFAULT,50,()=>{if(predicate()){resolve();return GLib.SOURCE_REMOVE;}if(++n>180){reject(Error('native state deadline: '+phase));return GLib.SOURCE_REMOVE;}return GLib.SOURCE_CONTINUE;});});}
function tick(){return new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,40,()=>{resolve();return GLib.SOURCE_REMOVE;}));}
async function captureScreen(){const stream=Gio.File.new_for_path(${JSON.stringify(screenshot)}).replace(null,false,Gio.FileCreateFlags.REPLACE_DESTINATION,null);const shooter=new Shell.Screenshot();let timer;try{await Promise.race([new Promise((resolve,reject)=>shooter.screenshot(false,stream,(object,result)=>{try{object.screenshot_finish(result);resolve();}catch(error){reject(error);}})),new Promise((_,reject)=>{timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,3000,()=>{timer=null;reject(Error('Screenshot deadline'));return GLib.SOURCE_REMOVE;});})]);}finally{if(timer)GLib.source_remove(timer);stream.close(null);}}
export default class Probe extends Workbench {
 enable(){this._pointerCapture=global.stage.connect('captured-event',(_stage,event)=>{if(event.type()===Clutter.EventType.BUTTON_PRESS){const [x,y]=event.get_coords();const picked=global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,x,y);inputLog.push({button:event.get_button(),x,y,source:String(event.get_source()),picked:String(picked),inside:[...this._views].map(([surface,v])=>({surface,contains:v.panel.contains(picked)}))});}return Clutter.EVENT_PROPAGATE;});super.enable();GLib.timeout_add(GLib.PRIORITY_DEFAULT,500,()=>{this.probe().catch(error=>this.finish(error));return GLib.SOURCE_REMOVE;});}
 async finish(error){if(error){try{await captureScreen();}catch(cause){inputLog.push({screenshotError:String(cause)});}}GLib.file_set_contents(${JSON.stringify(resultFile)},JSON.stringify({ok:!error,error:error?String(error)+'; '+String(error.stack||''):null,phase,inputLog,actionMode:Main.actionMode,overview:Main.overview.visible,states:[...this._states].map(([surface,s])=>({surface,visible:s.visible,pinned:s.pinned,selection:s.selection,detail:s.detail})),assertions}));if(this._inputCapture)global.stage.disconnect(this._inputCapture);global.stage.disconnect(this._pointerCapture);this.disable();global.context.terminate();}
 async probe(){
  this._settings.set_string('pui-path',${JSON.stringify(pui)});
  check(this._bindings.size===2,'native shortcut acquisition');
  this._toggle('quick-access');
  await waitFor(()=>Object.values(this._states.get('quick-access').sources).every(s=>s.status!=='loading'));
  const qa=this._states.get('quick-access'),goals=this._states.get('goals');
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
  // These go through Mutter's virtual seat and the actual event dispatch path.
  // No Workbench controller or synthetic signal is called for this phase.
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
  const click=async actor=>{await tick();const [x,y]=actor.get_transformed_position();const [w,h]=actor.get_transformed_size();pointer.notify_absolute_motion(time(),x+w/2,y+h/2);await tick();pointer.notify_button(time(),primaryButton,Clutter.ButtonState.PRESSED);await tick();pointer.notify_button(time(),primaryButton,Clutter.ButtonState.RELEASED);await tick();};
  phase='desktop startup';
  await waitFor(()=>!Main.layoutManager._startingUp);
  if(Main.overview.visible)await key(Clutter.KEY_Escape);
  await waitFor(()=>Main.actionMode===Shell.ActionMode.NORMAL);
  check(!Main.overview.visible,'desktop ready for normal shortcuts');
  qa.pinned=false;goals.pinned=false;
  phase='shortcut';
  await chord([Clutter.KEY_Super_L,Clutter.KEY_Alt_L,Clutter.KEY_space]);
  await waitFor(()=>qa.visible&&qa.sources.reports?.status==='ready');
  check(this._views.has('quick-access'),'seat shortcut opens panel');
  phase='typing';
  await chord([Clutter.KEY_Control_L,Clutter.KEY_a]);
  for(const symbol of [Clutter.KEY_n,Clutter.KEY_e,Clutter.KEY_e,Clutter.KEY_d,Clutter.KEY_l,Clutter.KEY_e])await key(symbol);
  await waitFor(()=>qa.query==='needle'&&qa.sources.reports?.rows?.[0]?.title==='Report needle');
  check(this._views.get('quick-access').search.get_text()==='needle','seat typing reaches focused native search');
  phase='navigation';
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
  phase='detail escape';
  await key(Clutter.KEY_Escape);
  await waitFor(()=>!qa.detail);
  check(qa.visible,'seat Escape dismisses detail before surface');
  phase='pin click';
  const pin=this._views.get('quick-access').panel.get_first_child().get_children()[1];
  await click(pin);
  check(qa.pinned&&pin.label==='Unpin','seat click pins native panel');
  phase='second shortcut';
  await chord([Clutter.KEY_Super_L,Clutter.KEY_Shift_L,Clutter.KEY_g]);
  await waitFor(()=>goals.visible&&goals.sources.goals?.status==='ready');
  check(qa.visible&&this._views.size===2,'seat second shortcut preserves independent pin');
  await tick();
  await captureScreen();
  check(global.get_window_actors().length===0,'seat journey keeps native surfaces outside application windows');
  phase='outside click';
  pointer.notify_absolute_motion(time(),5,450);await tick();
  pointer.notify_button(time(),primaryButton,Clutter.ButtonState.PRESSED);await tick();
  pointer.notify_button(time(),primaryButton,Clutter.ButtonState.RELEASED);await tick();
  await waitFor(()=>!goals.visible);
  check(qa.visible&&qa.pinned,'seat outside click closes unpinned panel and preserves pin');
  phase='final toggle';
  await chord([Clutter.KEY_Super_L,Clutter.KEY_Alt_L,Clutter.KEY_space]);
  await waitFor(()=>!qa.visible);
  check(this._views.size===0,'seat shortcut toggles pinned panel closed');
  this.finish(null);
 }
}
`);
            checkScript(join(extension,'extension.js'));
            const env={...process.env,XDG_DATA_HOME:data,XDG_CONFIG_HOME:config,XDG_CACHE_HOME:join(temp,'cache'),
                XDG_RUNTIME_DIR:runtime,GSETTINGS_BACKEND:'keyfile',GTK_A11Y:'none',
                LIBGL_ALWAYS_SOFTWARE:'1',GIO_USE_VFS:'local',GNOME_SHELL_SESSION_MODE:'user',WAYLAND_DISPLAY:'workbench-test'};
            // The private keyfile backend never touches the owner's dconf.
            const settings=spawnSync('gsettings',['set','org.gnome.shell','enabled-extensions',
                "['workbench@papercusp.ai']"],{env,encoding:'utf8'});
            assert.equal(settings.status,0,settings.stderr);
            const result=await runOwned('dbus-run-session',[privateBus(temp),'--','gnome-shell','--headless','--wayland','--no-x11',
                '--virtual-monitor','1440x900','--wayland-display','workbench-test'],env,45000);
            const evidence=existsSync(resultFile)?JSON.parse(readFileSync(resultFile,'utf8')):null;
            // Retain failure evidence before assertions or cleanup, so a failed
            // journey is diagnosable without another expensive desktop boot.
            if(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR){
                mkdirSync(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,{recursive:true});
                writeFileSync(join(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,'gnome-native-process.json'),
                    JSON.stringify({evidence,...result},null,2)+'\n');
                if(existsSync(screenshot))cpSync(screenshot,join(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,'gnome-native-input.png'));
            }
            assert.equal(evidence?.ok,true,JSON.stringify({evidence,...result}));
            assert.equal(result.status,0,JSON.stringify(result));
            assert.equal(result.error,null,JSON.stringify(result));
            assert.ok(evidence.assertions.length>=24,JSON.stringify(evidence));
            assert.deepEqual([...readFileSync(screenshot).subarray(0,8)], [137,80,78,71,13,10,26,10]);
            if(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR){
                mkdirSync(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,{recursive:true});
                cpSync(screenshot,join(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,'gnome-native-input.png'));
                writeFileSync(join(process.env.PAPERCUSP_NATIVE_EVIDENCE_DIR,'gnome-native-input.json'),
                    JSON.stringify({...evidence,plane:'private GNOME virtual seat; fixture PUI; current build'},null,2)+'\n');
            }
            console.log('GNOME_NATIVE_PASS '+JSON.stringify(evidence));
        } finally {rmSync(temp,{recursive:true,force:true});}
    });
