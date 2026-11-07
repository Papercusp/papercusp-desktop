import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {PanelState, InboxState, sameEnvironment, readRows, sourceRows, resultFor, searchResults, detailRequest, rebindShortcuts, sourceRequests,
    agentFocusTarget, agentResumeTarget, resumeArgv, exactAgentWindow,
    organizerGroups, organizerMembers, arrangeOrganizerGroup}
    from '../native/gnome/panel-model.mjs';

const root = resolve(import.meta.dirname, '..');
const plan = (harness = 'one', slug = 'same') => ({harness, slug, title: 'Shared title', status: 'active'});
const envelope = rows => ({rows, version: 'canonical-version'});

const organizerAgent = (id, patch = {}) => ({ownerId:`owner-${id}`, advSessionId:id,
    host:'desktop',sessionState:'live',potSlug:'one',currentPlanSlug:'same',fleetSlug:'fleet',...patch});
const organizerRoster = rows => envelope([{active:rows,ended:[]}]);
const organizerWindow = (id, desktop = 0, monitor = 0) => ({title:`Terminal [adv:${id}]`,desktop,monitor,
    area:{x:monitor*1200,y:desktop*20,width:1200,height:800}});
test('Organizer uses qualified plans, fleet identities and canonical goal links', () => {
    const rows=[organizerAgent(1),organizerAgent(2,{potSlug:'two'}),organizerAgent(3,{currentPlanSlug:null})];
    const groups=organizerGroups(rows,'plan');
    assert.equal(groups.length,2); assert.notEqual(groups[0].key,groups[1].key);
    assert.deepEqual(organizerMembers(groups[0],organizerRoster(rows)),[rows[0]]);
    assert.equal(organizerGroups(rows,'fleet')[0].rows.length,3);
    const goal=organizerGroups(rows,'goal',[{id:'exact-goal',title:'Shared title'}])[0];
    const detail=envelope([{goal:{id:goal.id},plans:[{harnessSlug:'two',planSlug:'same'}],
        agents:[{ownerId:'owner-3',live:true},{ownerId:'owner-1',live:false}],pots:[{harnessSlug:'one'}]}]);
    assert.deepEqual(organizerMembers(goal,organizerRoster(rows),detail),[rows[1],rows[2]]);
    assert.throws(()=>organizerMembers({...goal,id:'other'},organizerRoster(rows),detail),/changed/);
    assert.throws(()=>organizerMembers(goal,organizerRoster(rows),{...detail,partial:true}),/incomplete/);
    assert.equal(organizerGroups([organizerAgent(1,{potSlug:null,harnessSlug:null})],'plan').length,0);
    for (const roster of [{...organizerRoster(rows),partial:true},
        envelope([{active:rows,ended:[],degradedFields:[{field:'active',reason:'offline'}]}])])
        assert.throws(()=>organizerMembers(groups[0],roster),/incomplete/);
});
test('Organizer tiles exact terminals independently within each desktop and monitor', async () => {
    const rows=[1,2,3,4].map(id=>organizerAgent(id));
    const windows=[organizerWindow(1),organizerWindow(2),organizerWindow(3,1),organizerWindow(4,0,1)];
    const placements=[];
    const receipts=await arrangeOrganizerGroup(organizerGroups(rows,'plan')[0],organizerRoster(rows),'desktop',windows,
        async (window,rect)=>{placements.push({window,rect});return {...rect,desktop:window.desktop,monitor:window.monitor};});
    assert.deepEqual(receipts.map(r=>r.status),['moved','moved','moved','moved']);
    assert.equal(placements[0].rect.width,576); assert.equal(placements[1].rect.x,612);
    assert.equal(placements[2].rect.width,1176); assert.equal(placements[3].rect.x,1212);
    for(const {window,rect} of placements){
        assert.ok(rect.x>=window.area.x&&rect.y>=window.area.y);
        assert.ok(rect.x+rect.width<=window.area.x+window.area.width);
        assert.ok(rect.y+rect.height<=window.area.y+window.area.height);
    }
});
test('Organizer reports remote, stale and shared windows without moving them', async () => {
    const selected=[organizerAgent(1),organizerAgent(2,{host:'remote'}),organizerAgent(3,{stale:true}),
        organizerAgent(4),organizerAgent(5),organizerAgent(6)];
    const current=selected.map(row=>row.advSessionId===4?{...row,currentPlanSlug:'changed'}:row);
    const shared={...organizerWindow(5),title:'Terminal [adv:5] [adv:6]'};
    const moved=[];
    const receipts=await arrangeOrganizerGroup(organizerGroups(selected,'fleet')[0],organizerRoster(current),'desktop',
        [organizerWindow(1),shared],async (window,rect)=>{moved.push(window);return {...rect,desktop:window.desktop,monitor:window.monitor};});
    assert.deepEqual(receipts.map(r=>r.status),['moved','unsupported','offline','failed','failed','failed']);
    assert.deepEqual(moved.map(w=>w.title),['Terminal [adv:1]']);
    assert.match(receipts[4].error,/share/); assert.match(receipts[5].error,/share/);
    const changed=await arrangeOrganizerGroup(organizerGroups(selected,'plan')[0],organizerRoster(current),'desktop',[],()=>assert.fail('No valid windows'));
    assert.match(changed[3].error,/changed group/);
});
test('Organizer refuses changed sessions and unverified placement receipts', async () => {
    const rows=[organizerAgent(1),organizerAgent(2),organizerAgent(3),organizerAgent(4)];
    const windows=rows.map(row=>organizerWindow(row.advSessionId));
    windows[3].unsupported='Pinned to every desktop';
    const roster=organizerRoster(rows.map(row=>row.advSessionId===1?{...row,advSessionId:99}:row));
    const receipts=await arrangeOrganizerGroup(organizerGroups(rows,'plan')[0],roster,'desktop',windows,
        async (window,rect)=>{if(window===windows[1])throw Error('Native permission denied');return {...rect,desktop:99,monitor:0};});
    assert.deepEqual(receipts.map(r=>r.status),['failed','failed','failed','unsupported']);
    assert.match(receipts[0].error,/changed/); assert.match(receipts[1].error,/permission/);
    assert.match(receipts[2].error,/within its desktop/);
    await assert.rejects(arrangeOrganizerGroup(organizerGroups(rows,'plan')[0],{error:'ACL refused',rows:[]},'desktop',windows,()=>{}),/ACL/);
});

const environment = {endpoint:'http://selected',workspaceId:'exact',store:{id:'store'},agentChat:{scope:'workspace'}};
const question = {id:'question+/=&',kind:'escalation',title:'Literal %_ question',body:'Context',ref:{kind:'coord-escalation',conversationId:'conversation+/=&'},actions:[{id:'resolve'}]};
const bulk = (items, run = {runId:'run+/=&',phase:'review',totalItems:8}) => envelope([{run,items}]);
const recommended = {itemId:question.id,kind:question.kind,ref:question.ref,runId:'run+/=&',outcome:'recommended',actionId:'answer',draftAnswer:'Original'};
function loadedInbox() {
    const state = new InboxState(), token = state.begin();
    state.settleList(token,envelope([{items:[question]}]));
    state.settleBulk(token,bulk([recommended]));
    return {state,token};
}
test('Inbox context refuses conflicting, partial and stale identities and clears hidden selections', () => {
    const {state,token} = loadedInbox(), context = state.select(question.id);
    assert.equal(state.settleContext(context,question.id,envelope([question])),true);
    assert.equal(state.request('resolve',environment,{actionId:'answer',answer:'  Exact answer  '}).answer,'Exact answer');
    assert.throws(()=>state.request('resolve',environment,{actionId:'resolve'}),/offered/);
    assert.throws(()=>state.request('resolve',environment,{actionId:'answer',answer:' '}),/answer/);
    state.settleContext(context,question.id,{...envelope([question]),partial:true}); assert.equal(state.context,null);
    state.settleContext(context,question.id,envelope([{...question,ref:{kind:'changed'}}])); assert.equal(state.context,null);
    state.settleContext(context,question.id,envelope([question]));
    state.retainVisibleSelection('no such question'); assert.equal(state.selection,null);
    assert.equal(state.settleContext(context,question.id,envelope([question])),false);
    state.settleList(token,envelope([{items:[question,{...question,title:'conflicting'}]}]));
    assert.equal(state.listReady,false); assert.match(state.listError,/Conflicting/);
    assert.equal(state.settleList(token-1,envelope([{items:[]}])),false);
});
test('Inbox named choices require source Resolve and preserve exact option identities', () => {
    const row={...question,ref:{kind:'coord-escalation',options:[{id:'ship+/=&',label:'Ship'},{id:'wait',label:'Wait'}]}};
    assert.deepEqual(InboxState.actions(row).map(a=>a.id),['ship+/=&','wait']);
    assert.deepEqual(InboxState.actions({...row,actions:[]}),[]);
    const {state,token}=loadedInbox(); state.settleList(token,envelope([{items:[row]}]));
    const context=state.select(row.id); state.settleContext(context,row.id,envelope([row]));
    assert.equal(state.request('resolve',environment,{actionId:'ship+/=&'}).actionId,'ship+/=&');
    assert.throws(()=>state.request('resolve',environment,{actionId:'resolve'}),/offered/);
});
test('Inbox saved progress uses the persisted denominator and excludes owner-only work from Apply', () => {
    const owner={...recommended,itemId:'owner',recommendation:{kind:'owner_action'}}, {state,token}=loadedInbox();
    state.settleBulk(token,bulk([recommended,owner]));
    const counts=InboxState.counts(state.run,state.items);
    assert.equal(counts.total,8); assert.equal(counts.percent,25); assert.equal(counts.forReview,1); assert.equal(counts.ownerAction,1);
    assert.equal(state.canSelect('owner'),false); state.selectedReviews.add('owner');
    assert.throws(()=>state.request('apply',environment,{itemId:'owner'}),/recommendation/);
    state.selectedReviews.add(question.id); state.drafts.set(question.id,' Edited answer ');
    const frozen=state.request('apply',environment,{itemId:question.id});
    state.drafts.set(question.id,'Later edit'); assert.equal(frozen.answer,'Edited answer');
    assert.throws(()=>InboxState.counts(state.run,[recommended,recommended]),/identity/);
    assert.throws(()=>InboxState.counts(state.run,[{...recommended,runId:'foreign'}]),/identity/);
    assert.throws(()=>InboxState.counts({...state.run,totalItems:0},[recommended]),/total/);
});
test('Inbox run refresh preserves edits, rejects overlapping writes and recovers read failures', () => {
    const {state,token}=loadedInbox(); state.selectedReviews.add(question.id); state.drafts.set(question.id,'Keep this edit');
    const request=state.request('apply',environment,{itemId:question.id}), action=state.beginAction([request]);
    assert.equal(state.settleLiveBulk(token,'run+/=&',bulk([])),false);
    assert.throws(()=>state.request('stop',environment),/current action/); state.finishAction(action);
    assert.equal(state.settleLiveBulk(token,'foreign',bulk([])),false);
    state.settleLiveBulk(token,'run+/=&',null,new Error('Read unavailable')); assert.equal(state.bulkReady,false);
    state.settleLiveBulk(token,'run+/=&',bulk([recommended])); assert.equal(state.bulkReady,true);
    assert.equal(state.draft(recommended),'Keep this edit'); assert.equal(state.selectedReviews.has(question.id),true);
    state.begin(); assert.equal(state.settleLiveBulk(token,'run+/=&',bulk([])),false);
});
test('Inbox writes demand exact environment and terminal receipt and never repeat confirmed effects', () => {
    const {state}=loadedInbox(); state.selectedReviews.add(question.id);
    const request=state.request('apply',environment,{itemId:question.id}), token=state.beginAction([request]);
    const receipt={environment,rows:[{ok:true,resolved:true,itemId:question.id}]};
    assert.equal(sameEnvironment(environment,{...environment,store:{id:'foreign'}}),false);
    assert.throws(()=>state.recordAction(token,request,{...receipt,environment:{}}),/environment/);
    assert.throws(()=>state.recordAction(token,request,{...receipt,rows:[{ok:true,resolved:false,itemId:question.id}]}),/resolution/);
    assert.throws(()=>state.recordAction(token,request,{...receipt,rows:[{ok:true,resolved:true,itemId:'foreign'}]}),/resolution/);
    assert.throws(()=>state.recordAction(token,request,{...receipt,rows:[{...receipt.rows[0],recorded:false}]}),/do not repeat/);
    state.finishAction(token); assert.throws(()=>state.request('apply',environment,{itemId:question.id}),/current question/);
});
test('Inbox batch admission freezes only visible questions and resumes only retryable items', () => {
    const {state,token}=loadedInbox(); state.settleBulk(token,bulk([],null));
    const request=state.request('start',environment,{query:'%_'});
    assert.equal(request.items.length,1); assert.equal(request.filter.shownCount,1);
    assert.deepEqual(request.items[0].ref,question.ref);
    assert.throws(()=>state.request('start',environment,{query:'absent'}),/visible batch/);
    state.settleBulk(token,bulk([{...recommended,outcome:'failed'},{...recommended,itemId:'owner',recommendation:{kind:'owner_action'}}]));
    assert.deepEqual(state.request('resume',environment).itemIds,[question.id]);
    assert.throws(()=>state.request('stop',environment),/phase/);
});

test('canonical ended session rows retain Agents results and exact launch identities', () => {
    const active = {ownerId:'same-owner',advSessionId:42,label:'Same title',
        host:'desktop',sessionState:'live'};
    const ended = {id:41,coordOwnerId:'same-owner',label:'Same title',
        endedAt:'2026-11-06T00:00:00Z',sessionId:'native-old'};
    const unregistered = {id:40,coordOwnerId:null,label:null,agent:'codex',
        endedAt:'2026-11-05T00:00:00Z',sessionId:'native-unregistered'};
    const payload = envelope([{active:[active],ended:[ended,unregistered],pending:[],starting:[]}]);
    const state = new PanelState(), generation = state.beginRefresh(['agents']);
    state.settle('agents',generation,payload);
    assert.equal(state.sources.agents.status,'ready');
    const results = state.results();
    assert.equal(results.length,3);
    assert.equal(new Set(results.map(row=>row.key)).size,3);
    const previous = results.find(row=>row.row.advSessionId===41);
    assert.equal(previous.row.ownerId,'same-owner');
    assert.equal(previous.row.sessionState,'ended');
    assert.equal(previous.row.sessionId,'native-old');
    assert.match(previous.subtitle,/ended/);
    assert.equal(results.find(row=>row.row.advSessionId===40).title,'codex');
    assert.equal('ownerId' in ended,false,'Do not mutate the canonical payload');
    assert.deepEqual(agentFocusTarget(payload,active,'desktop'),
        {ownerId:'same-owner',windowId:null,advSessionId:42});
    assert.throws(()=>agentFocusTarget(payload,previous.row,'desktop'),/saved connection/);
});

test('native agent selection distinguishes incarnations and retains an unregistered ended session', () => {
    const current = resultFor('agents',{ownerId:'same-owner',advSessionId:42});
    const previous = resultFor('agents',{ownerId:'same-owner',advSessionId:41});
    assert.notEqual(current.key,previous.key);
    const noOwner = sourceRows('agents',envelope([{active:[],ended:[{id:40,coordOwnerId:null}]}]))[0];
    assert.equal(resultFor('agents',noOwner).title,'Session 40');
    assert.throws(()=>agentFocusTarget(envelope([{active:[],ended:[]}]),noOwner,'desktop'),/saved connection/);
    assert.throws(()=>resultFor('agents',{}),/canonical agent/);
});

test('native agent activation revalidates exact owner, live incarnation and actual desktop host', () => {
    const agent = {ownerId:'selected',host:'desktop',sessionState:'parked',advSessionId:42,pid:17};
    const roster = row => envelope([{active:[row],ended:[]}]);
    assert.deepEqual(agentFocusTarget(roster(agent),agent,'desktop'),
        {ownerId:'selected',windowId:null,advSessionId:42});
    for (const patch of [{ownerId:'other'},{host:'remote'},{isLocal:false},{host:null},
        {stale:true},{revoked:true},{sessionState:'ended'},{sessionState:'starting'},
        {advSessionId:null},{advSessionId:1.5}])
        assert.throws(()=>agentFocusTarget(roster({...agent,...patch}),agent,'desktop'));
    assert.throws(()=>agentFocusTarget(envelope([{active:[agent],ended:[agent]}]),agent,'desktop'),/ambiguous/);
    assert.throws(()=>agentFocusTarget({error:'ACL refused',rows:[]},agent,'desktop'),/ACL/);
});

test('native activation refuses a replaced session behind the same selected owner', () => {
    const selected = {ownerId:'selected',host:'desktop',sessionState:'live',advSessionId:42};
    const roster = row => envelope([{active:[row],ended:[]}]);
    assert.throws(()=>agentFocusTarget(roster({...selected,advSessionId:43}),selected,'desktop'),/changed/);
    assert.throws(()=>agentFocusTarget(roster(selected),{...selected,host:'old-desktop'},'desktop'),/changed/);
    const legacy = {ownerId:'selected',host:'desktop',sessionState:'live',windowId:'0x2a'};
    assert.equal(agentFocusTarget(roster(legacy),legacy,'desktop').windowId,'0x2a');
    assert.throws(()=>agentFocusTarget(roster({...legacy,windowId:'0x2b'}),legacy,'desktop'),/changed/);
    assert.throws(()=>agentFocusTarget(roster(selected),{ownerId:'selected'},'desktop'),/identity/);
});

test('native resume retains exact canonical launch and saved host, including an ownerless ended launch', () => {
    const raw = {id:41,coordOwnerId:'selected',hostname:'desktop',sessionId:'native-exact'};
    const roster = envelope([{active:[],ended:[raw]}]);
    const selected = sourceRows('agents',roster)[0];
    assert.deepEqual(agentResumeTarget(roster,selected,'desktop'),
        {advSessionId:41,host:'desktop',ownerId:'selected',remote:false});
    assert.deepEqual(agentResumeTarget(roster,selected,'another-desktop'),
        {advSessionId:41,host:'desktop',ownerId:'selected',remote:true});
    assert.deepEqual(resumeArgv("/installed path/pui '$",agentResumeTarget(roster,selected,'desktop')),
        ["/installed path/pui '$",'workbench','resume','41','desktop','selected']);
    const unregistered = envelope([{active:[],ended:[{...raw,coordOwnerId:null}]}]);
    assert.equal(agentResumeTarget(unregistered,sourceRows('agents',unregistered)[0],'desktop').advSessionId,41);
    assert.equal('advSessionId' in raw,false,'Resume never rewrites canonical records');
});

test('native resume refuses changed, live, ambiguous, inaccessible and hostless selections', () => {
    const raw = {id:41,coordOwnerId:'selected',hostname:'desktop'};
    const roster = (ended=[raw],active=[]) => envelope([{active,ended}]);
    const selected = sourceRows('agents',roster())[0];
    for (const payload of [roster([]),roster([raw,raw]),
        roster([{...raw,hostname:'another-host'}]),roster([{...raw,coordOwnerId:'another-owner'}]),
        roster([{...raw,pidAlive:true}]),roster([{...raw,revoked:true}]),
        roster([],[{...selected,sessionState:'live'}]),
        roster([raw],[{ownerId:'selected',advSessionId:42,sessionState:'parked'}]),
        {ok:false,error:'ACL refused',rows:[]}])
        assert.throws(()=>agentResumeTarget(payload,selected,'desktop'));
    for (const patch of [{advSessionId:0},{advSessionId:1.5},{advSessionId:null},{hostname:null}])
        assert.throws(()=>agentResumeTarget(roster(),{...selected,...patch},'desktop'));
    assert.throws(()=>agentResumeTarget(roster(),selected,''),/desktop host/);
});

test('native focus rejects shared labels, PID guesses, missing windows and conflicting exact handles', () => {
    const windows = [{title:'Same label [adv:42]',id:'0x002a'},
        {title:'Same label [adv:420]',id:'0x002b'}];
    assert.equal(exactAgentWindow({advSessionId:42},windows),windows[0]);
    assert.equal(exactAgentWindow({windowId:'0x2A'},windows),windows[0]);
    assert.equal(exactAgentWindow({windowId:windows[1].title},windows),windows[1]);
    for (const target of [{windowId:'Same label'},{pid:17},{advSessionId:4},
        {windowId:'0x2b',advSessionId:42}])assert.throws(()=>exactAgentWindow(target,windows));
    assert.throws(()=>exactAgentWindow({advSessionId:42},[windows[0],{...windows[0]}]),/ambiguous/);
    assert.throws(()=>exactAgentWindow({windowId:'0x2b',advSessionId:42},[windows[0]]),/unavailable/);
    assert.throws(()=>exactAgentWindow({windowId:'0x2b',advSessionId:42},[windows[1]]),/conflict/);
    assert.equal(exactAgentWindow({windowId:'0x2a',advSessionId:42},[windows[0]]),windows[0]);
});

test('native results expose later matches while retaining exact selection and source capacity', () => {
    const state = new PanelState();
    const plans = Array.from({length:60}, (_, i) => plan('exact', String(i)));
    const refresh = () => {
        const generation = state.beginRefresh(['plans', 'reports']);
        state.settle('plans', generation, envelope(plans));
        state.settle('reports', generation, envelope([{report_id:'report',title:'Report'}]));
    };
    refresh();
    assert.equal(state.results().length, 27);
    assert.equal(state.hasMoreResults(), true);
    state.showMoreResults();
    const later = state.results().find(result => result.row.slug === '51');
    assert.ok(later);
    state.selection = later.key;
    refresh();
    assert.equal(state.selected().row.slug, '51');
    assert.equal(state.results().filter(result => result.kind === 'reports').length, 1);
    state.showMoreResults();
    assert.equal(state.results().length, 61);
    assert.equal(state.hasMoreResults(), false);
    state.query = 'same';
    refresh();
    assert.equal(state.resultLimit, 26);
    state.scope = 'reports';
    refresh();
    assert.equal(state.hasMoreResults(), false);
});

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

test('server search follows the query and scoped refreshes never request unrelated sources', () => {
    const query = 'exact %_ +/= renamed goal';
    assert.deepEqual(sourceRequests(query, 'goals'),
        [{kind:'goals',name:'goals.list',args:{query,limit:500}}]);
    assert.deepEqual(sourceRequests(query, 'reports'),
        [{kind:'reports',name:'reports.list',args:{query,limit:200}}]);
    assert.equal(sourceRequests(query).length,4);
    const state = new PanelState();
    const old = state.beginRefresh();
    const generation = state.beginRefresh(['goals']);
    assert.equal(state.settle('plans',old,envelope([plan()])),false);
    assert.deepEqual(Object.keys(state.sources),['goals']);
    state.settle('goals',generation,envelope([{goals:[],totalGoals:0}]));
    assert.equal(state.sources.goals.status,'ready');
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
