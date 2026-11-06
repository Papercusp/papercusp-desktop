import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {PanelState, readRows, sourceRows, resultFor, searchResults, detailRequest, rebindShortcuts}
    from '../native/gnome/panel-model.mjs';

const root = resolve(import.meta.dirname, '..');
const plan = (harness = 'one', slug = 'same') => ({harness, slug, title: 'Shared title', status: 'active'});
const envelope = rows => ({rows, version: 'canonical-version'});

test('qualified identity survives identical titles, harnesses and literal search characters', () => {
    const one = resultFor('plans', plan('one')), two = resultFor('plans', plan('two'));
    assert.notEqual(one.key, two.key);
    assert.deepEqual(detailRequest(two), {name:'plans.get',args:{slug:'same',harness:'two',mode:'full',includeRaw:true}});
    assert.deepEqual(detailRequest(resultFor('reports', {report_id:'exact+/=&',title:'report'})),
        {name:'reports.get',args:{reportId:'exact+/=&'}});
    assert.throws(() => resultFor('plans', {slug:'same'}), /harness/);
    const sources = {plans:{rows:[{...plan(),title:'100%_ C:\\path'}]}};
    assert.equal(searchResults(sources, '%_').length, 1);
    assert.equal(searchResults(sources, '100.*').length, 0);
});

test('each canonical source has reserved result capacity including Work on everything', () => {
    const sources = {
        plans:{rows:Array.from({length:100}, (_,i) => plan('one',String(i)))},
        agents:{rows:[{ownerId:'exact-owner',label:'same title'}]},
        reports:{rows:[{report_id:'exact-report',title:'same title'}]},
        goals:{rows:[{id:'goal-exact',title:'Renamed goal',goalPackageRef:'work-on-everything'}]},
    };
    assert.deepEqual(Object.groupBy(searchResults(sources), x=>x.kind).plans.length, 26);
    assert.deepEqual(new Set(searchResults(sources).map(x=>x.kind)), new Set(['plans','agents','reports','goals']));
    assert.equal(searchResults(sources,'work-on-everything')[0].row.id, 'goal-exact');
});

test('canonical aggregate rows distinguish a real empty portfolio from unavailable or malformed data', () => {
    assert.deepEqual(sourceRows('goals',envelope([{goals:[],totalGoals:0}])), []);
    assert.deepEqual(sourceRows('agents',envelope([{active:[],ended:[],pending:[{ownerId:'pending'}],starting:[]}])),
        [{ownerId:'pending'}]);
    for (const value of [null, {}, {rows:null}, {rows:[],error:'ACL refused'}, {ok:false,rows:[]}])
        assert.throws(() => readRows(value));
    assert.throws(() => sourceRows('goals',envelope([])), /unavailable/);
    assert.throws(() => sourceRows('agents',envelope([{active:[]}])), /unavailable/);
});

test('independent source failures preserve useful results and stale completions cannot overwrite a refresh', () => {
    const state = new PanelState(), old = state.beginRefresh(), current = state.beginRefresh();
    assert.equal(state.settle('plans',old,envelope([plan('stale')])), false);
    state.settle('plans',current,envelope([plan('current')]));
    state.settle('reports',current,null,new Error('ACL unavailable'));
    state.settle('agents',current,envelope([{active:[],ended:[],degradedFields:[{field:'ended',reason:'offline'}]}]));
    state.settle('goals',current,envelope([{goals:[{id:'g',title:'Work on everything'}],totalGoals:200,truncatedByLimit:true}]));
    assert.equal(state.results()[0].row.harness, 'current');
    assert.match(state.sources.reports.error,/ACL/);
    assert.deepEqual(state.sources.agents.unavailable,[{field:'ended',reason:'offline'}]);
    assert.equal(state.sources.goals.partial,true); assert.equal(state.sources.goals.total,200);
    assert.equal(state.results().length,2);
});

test('Escape closes detail first; toggle, outside focus, independent pins and drafts retain their context', () => {
    const a = new PanelState(), b = new PanelState();
    a.query='retained draft'; a.selection='exact'; a.visible=true; a.detail={text:'selected'};
    assert.equal(a.escape(),'detail'); assert.equal(a.visible,true);
    assert.equal(a.escape(),'panel'); assert.equal(a.visible,false);
    assert.equal(a.toggle(),true); assert.equal(a.query,'retained draft'); assert.equal(a.selection,'exact');
    a.pinned=true; a.outsideFocus(); assert.equal(a.visible,true);
    b.visible=true; b.outsideFocus(); assert.equal(b.visible,false);
    assert.equal(a.toggle(),false); assert.equal(a.pinned,true);
});

test('keyboard selection retains canonical identity when a different source arrives first', () => {
    const state = new PanelState(), gen=state.beginRefresh();
    state.settle('reports',gen,envelope([{report_id:'report',title:'Report'}]));
    state.selection=state.selected().key;
    state.settle('plans',gen,envelope([plan()]));
    assert.equal(state.selected().row.report_id,'report');
    state.move(1); assert.equal(state.selected().row.harness,'one');
    state.move(-1); assert.equal(state.selected().row.report_id,'report');
});

test('shortcut replacement retains old runtime bindings on collision and releases only successful replacements', () => {
    const old=new Map([['quick-access',{accelerator:'old',id:1}],['goals',{accelerator:'goal',id:2}]]);
    const released=[], adapter={grab:key=>key==='collision'?0:3,ungrab:id=>released.push(id)};
    assert.throws(()=>rebindShortcuts(old,{'quick-access':'new',goals:'collision'},adapter),/unavailable/);
    assert.deepEqual(released,[3]); assert.equal(old.get('quick-access').id,1);
    released.length=0;
    const next=rebindShortcuts(old,{'quick-access':'new',goals:'goal'},adapter);
    assert.equal(next.get('quick-access').id,3); assert.equal(next.get('goals').id,2);
    assert.deepEqual(released,[1]);
    assert.throws(()=>rebindShortcuts(old,{'quick-access':'same',goals:'same'},adapter),/different/);
});

test('GSettings schema compiles strictly in private storage', {skip:process.platform!=='linux'}, () => {
    const temp=mkdtempSync(join(tmpdir(),'workbench-schema-'));
    try {
        const name='org.gnome.shell.extensions.papercusp-workbench.gschema.xml';
        writeFileSync(join(temp,name),readFileSync(join(root,'native/gnome/schemas',name)));
        const result=spawnSync('glib-compile-schemas',['--strict',temp],{encoding:'utf8',timeout:10000});
        assert.equal(result.status,0,result.stderr);
    } finally {rmSync(temp,{recursive:true,force:true});}
});

test('actual GJS bridge sends exact stdin through an argv path and rejects failed or malformed reads',
    {skip:process.platform!=='linux',timeout:30000}, () => {
        const temp=mkdtempSync(join(tmpdir(),"workbench '$-"));
        try {
            const pui=join(temp,'pui fixture');
            writeFileSync(pui,`#!/usr/bin/env node\nlet input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const r=JSON.parse(input);if(r.name==='failure'){console.error('canonical ACL refusal');process.exitCode=1;}else if(r.name==='malformed')console.log('{}');else console.log(JSON.stringify({rows:[r],version:'exact'}));});\n`,{mode:0o700});
            const bridge=pathToFileURL(join(root,'native/gnome/bridge.js')).href;
            const driver=join(temp,'driver.mjs');
            writeFileSync(driver,`import {nativeRead} from ${JSON.stringify(bridge)};\nconst pui=${JSON.stringify(pui)};\nconst request={name:'reports.get',args:{reportId:'exact+/=& $()'}};\nconst r=await nativeRead(pui,request);if(JSON.stringify(r.rows[0])!==JSON.stringify(request))throw Error('identity changed');\nfor(const name of ['failure','malformed']){let rejected=false;try{await nativeRead(pui,{name,args:{}});}catch(e){rejected=true;}if(!rejected)throw Error('false empty '+name);}\nprint('NATIVE_BRIDGE_PASS');\n`);
            const result=spawnSync('gjs',['-m',driver],{encoding:'utf8',timeout:20000});
            assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/NATIVE_BRIDGE_PASS/);
            assert.doesNotMatch(result.stderr,/CRITICAL/);
        } finally {rmSync(temp,{recursive:true,force:true});}
    });
