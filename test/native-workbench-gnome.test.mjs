import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, readFileSync, cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {buildSync} from 'esbuild';
import {PanelState, InboxState, ChatState, ChatReply, AccountState, nativeVoiceRequest, nativeVoiceResult, readNativeReply, sameEnvironment, readRows, sourceRows, resultFor, searchResults, detailRequest, rebindShortcuts, sourceRequests,
    agentFocusTarget, agentResumeTarget, resumeArgv, exactAgentWindow,
    organizerGroups, organizerMembers, arrangeOrganizerGroup}
    from '../native/gnome/panel-model.mjs';

const root = resolve(import.meta.dirname, '..');
// The shared protocol uses TypeScript's .js source specifiers. Exercise the
// same closed ESM source graph produced for GJS, without Node-specific loaders.
const contentBundle = buildSync({entryPoints:[join(root,'native/gnome/chat-content.mjs')],
    bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false,logLevel:'silent'});
const {nativeChatBlocks, nativeWorkRefLinks, safeChatLink, NativeCard, NativeCardsState} =
    await import('data:text/javascript;base64,' + Buffer.from(contentBundle.outputFiles[0].contents).toString('base64'));
const plan = (harness = 'one', slug = 'same') => ({harness, slug, title: 'Shared title', status: 'active'});
const envelope = rows => ({rows, version: 'canonical-version'});

const accountEnvironment = {endpoint: 'http://fixture', workspaceId: 'workspace', store: {id: 'store'}, agentChat: {scope: 'chat'}};
const accountPayload = rows => ({environment: accountEnvironment, rows});
const accountSteering = {defaultAccountId: 'one', forcedAccounts: ['two'], excludeAccounts: ['one']};
function loadedAccounts() {
    const state = new AccountState(), token = state.begin();
    state.settle(token, accountEnvironment, accountPayload([{id: 'one', name: 'Shared'}, {id: 'two', name: 'Shared'}]),
        accountPayload([accountSteering]));
    assert.equal(state.ready, true); state.selection = 'two';
    return state;
}
test('native Accounts sends exact scoped controls without coupling or optimistically changing axes', () => {
    for (const action of ['default', 'force', 'exclude', 'auto']) {
        const state = loadedAccounts(), {token, request} = state.beginAction(action);
        assert.deepEqual(request, {action, ...(action === 'auto' ? {} : {accountId: 'two'}), environment: accountEnvironment});
        assert.deepEqual(state.override, accountSteering); assert.equal(state.busy, true);
        assert.throws(() => state.beginAction('force'), /Refresh/);
        const confirmed = action === 'auto' ? {...accountSteering, forcedAccounts: [], excludeAccounts: []} :
            {...accountSteering, [action === 'default' ? 'defaultAccountId' : action === 'force' ? 'forcedAccounts' : 'excludeAccounts']:
                action === 'default' ? 'two' : ['one', 'two']};
        assert.equal(state.applied(token, accountEnvironment, accountPayload([confirmed])), true);
        assert.deepEqual(state.override, confirmed); assert.equal(state.busy, false);
        if (action === 'auto') assert.equal(state.override.defaultAccountId, 'one');
    }
});
test('native Accounts retains confirmed state on failed writes and ignores stale or foreign responses', () => {
    const state = loadedAccounts(), {token} = state.beginAction('force');
    state.applied(token, accountEnvironment, null, new Error('Canonical write refused'));
    assert.match(state.error, /write refused/); assert.deepEqual(state.override, accountSteering);
    assert.throws(() => state.beginAction('exclude'), /Refresh/);
    const next = state.begin();
    assert.equal(state.applied(token, accountEnvironment, accountPayload([{...accountSteering, defaultAccountId: 'two'}])), false);
    state.settle(next, accountEnvironment, accountPayload([{id: 'one'}]), accountPayload([accountSteering]));
    state.selection = 'one'; const op = state.beginAction('default');
    state.applied(op.token, accountEnvironment, {...accountPayload([accountSteering]), environment: {...accountEnvironment, workspaceId: 'foreign'}});
    assert.match(state.error, /environment changed/); assert.deepEqual(state.override, accountSteering);
});
test('native Accounts rejects partial or ambiguous pools and every mismatched environment identity', () => {
    for (const pool of [{...accountPayload([{id: 'one'}]), partial: true}, accountPayload([{id: 'one'}, {id: 'one'}]), accountPayload([{}])]) {
        const state = new AccountState(); state.settle(state.generation, accountEnvironment, pool, accountPayload([accountSteering]));
        assert.equal(state.ready, false); assert.equal(state.accounts.length, 0);
    }
    for (const foreign of [{...accountEnvironment, endpoint: 'http://other'}, {...accountEnvironment, workspaceId: 'other'},
        {...accountEnvironment, store: {id: 'other'}}, {...accountEnvironment, agentChat: {scope: 'other'}}]) {
        const state = new AccountState();
        state.settle(state.generation, accountEnvironment, {...accountPayload([{id: 'one'}]), environment: foreign}, accountPayload([accountSteering]));
        assert.equal(state.ready, false); assert.match(state.error, /environment changed/);
    }
    const state = loadedAccounts(); state.selection = 'missing'; assert.throws(() => state.request('default'), /exact account/);
    state.begin(); assert.equal(state.ready, false); assert.equal(state.selection, null);
});

test('native Markdown uses styled native text, copyable literal code, GFM tables and inert HTML', () => {
    const source = '# Heading\n\n**Bold** and *emphasis* with `a < b` and ~~old~~.\n\n'
        + '```js\nconst x = "<b>WI-99</b>";\n```\n\n- [x] Done\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n<script>bad()</script>';
    const blocks = nativeChatBlocks(source, {endpoint:'http://fixture',harness:'h',planSlug:'p'});
    assert.equal(blocks[0].markup,'<b>Heading</b>');
    assert.match(blocks[1].markup,/<b>Bold<\/b>.*<i>emphasis<\/i>.*<tt>a &lt; b<\/tt>.*<s>old<\/s>/);
    assert.deepEqual(blocks.find(row=>row.kind==='code'),{kind:'code',code:'const x = "<b>WI-99</b>";',language:'js',links:[]});
    assert.ok(blocks.some(row=>row.markup?.includes('☑ Done')));
    assert.ok(blocks.some(row=>row.text==='A  │  B'));
    assert.ok(blocks.some(row=>row.markup?.includes('&lt;script&gt;bad()&lt;/script&gt;')));
    assert.equal(blocks.flatMap(row=>row.links).length,0);
});
test('native work links reuse exact popup grammar, omit unscoped refs and skip Markdown code and links', () => {
    const text='WI-42 P-007 `EI-99` [F-8](https://example.test)\n\n```\nWI-88\n```';
    const context={endpoint:'http://localhost:3170/api/trpc',harness:'team+/=&',planSlug:'plan+/=&'};
    assert.deepEqual(nativeWorkRefLinks(text,context).map(row=>[row.text,row.href]),[
        ['WI-42','http://localhost:3170/?wpop='+encodeURIComponent('team+/=&::WI-42')],
        ['P-007','http://localhost:3170/?wppop='+encodeURIComponent('team+/=&::plan+/=&')]]);
    assert.deepEqual(nativeWorkRefLinks(text),[]);
    assert.deepEqual(nativeWorkRefLinks('P-007',{...context,planSlug:null}),[]);
    assert.deepEqual(nativeWorkRefLinks('WI-42',{...context,harness:null}),[]);
    assert.deepEqual(nativeWorkRefLinks(text,{...context,endpoint:'https://user@untrusted.test'}),[]);
    for(const bad of ['javascript:bad()','data:text/html,bad','https://example.test/\nnext','//example.test'])assert.equal(safeChatLink(bad),null);
    const blocks=nativeChatBlocks('[Good](https://example.test) [Bad](javascript:bad)',context);
    assert.deepEqual(blocks.flatMap(row=>row.links),[{text:'Good',href:'https://example.test',kind:'link'}]);
});
test('work link selection is conversation isolated and never changes send identity or the draft', () => {
    const {state,token}=loadedChat();state.draft='Keep this';
    const plans=chatEnvelope([plan('exact')]);
    assert.equal(state.settleReferencePlans(token,chatEnvironment,plans),true);
    state.selectReferencePlan(state.referencePlans[0].key);
    assert.deepEqual(state.referenceContext,{endpoint:'http://fixture',harness:'exact',planSlug:'same'});
    const request=state.send(userId);
    assert.equal(request.conversationId,'conversation');assert.deepEqual(request.environment,chatEnvironment);
    assert.equal(request.text,'Keep this');assert.equal(state.draft,'Keep this');
    const next=state.begin();state.bind(next,chatEnvironment,chatEnvelope([conversation('other')]));
    state.settle(next,chatEnvironment,'other',chatEnvelope([{turns:[],hasMoreEarlier:false}]));
    state.settleReferencePlans(next,chatEnvironment,plans);assert.deepEqual(state.referenceContext,{});
    assert.equal(state.settleReferencePlans(token,chatEnvironment,plans),false);
    const back=state.begin();state.bind(back,chatEnvironment,chatEnvelope([conversation()]));
    state.settle(back,chatEnvironment,'conversation',chatEnvelope([{turns:[],hasMoreEarlier:false}]));
    state.settleReferencePlans(back,chatEnvironment,plans);assert.equal(state.referenceContext.planSlug,'same');
    state.settleReferencePlans(back,chatEnvironment,null,new Error('ACL refusal'));
    assert.match(state.referenceError,/ACL/);assert.deepEqual(state.referenceContext,{});assert.equal(state.draft,'Keep this');
});

const chatEnvironment = {endpoint:'http://fixture',workspaceId:'workspace',store:{id:'store'},agentChat:{scope:'workspace'}};
const userId='00000000-0000-4000-8000-000000000001', replyId='00000000-0000-4000-8000-000000000002';
const chatEnvelope = (rows, environment=chatEnvironment) => ({rows,environment});
const conversation = (id='conversation', environment=chatEnvironment) => ({id,workspaceId:environment.workspaceId,subjectKind:'global',status:'active'});
const turn = (seq, patch={}) => ({id:'message-'+seq,conversationId:'conversation',seq,role:'assistant',text:'Message '+seq,...patch});
function loadedChat(rows=[],hasMoreEarlier=false,conversationId='conversation') {
    const state=new ChatState(),token=state.begin();
    state.bind(token,chatEnvironment,chatEnvelope([conversation(conversationId)]));
    state.settle(token,chatEnvironment,conversationId,chatEnvelope([{turns:rows,hasMoreEarlier}]));
    return {state,token};
}
const chatFrame = (event,data,environment=chatEnvironment) => ({event,data,environment});
const cardRow = (patch={}) => ({correlationId:'question-1',conversationId:'conversation',createdAt:1,prompt:'Choose a route',
    presentation:{kind:'radio',options:[{id:'a',label:'Route A'},{id:'b',label:'Route B'}]},...patch});
const cardSnapshot = (rows=[cardRow()],version=1,runId='run') => chatFrame('snapshot',
    {workspaceId:'workspace',runId,version,snapshot:{openCards:rows}});
function loadedCards() {
    const state=new NativeCardsState(),token=state.begin(chatEnvironment,'conversation');
    state.receive(token,cardSnapshot());return {state,token,card:state.cards[0]};
}
test('canonical card snapshots replace one run, reject foreign identity and ignore stale generations',()=>{
    const {state,token}=loadedCards();
    assert.equal(state.receive(token,cardSnapshot()),false);
    assert.equal(state.receive(token,cardSnapshot([],0)),false);
    assert.throws(()=>state.receive(token,cardSnapshot([cardRow({prompt:'Conflict'})])),/Conflicting/);
    assert.throws(()=>state.receive(token,cardSnapshot([cardRow({conversationId:'foreign'})],2)),/foreign/);
    assert.throws(()=>state.receive(token,{...cardSnapshot([],2),environment:{...chatEnvironment,store:{id:'foreign'}}}),/environment/);
    assert.throws(()=>state.receive(token,cardSnapshot([cardRow()],2,'other')),/multiple runs/);
    assert.equal(state.cards.length,1);
    assert.equal(state.receive(token,cardSnapshot([],2)),true);assert.equal(state.cards.length,0);
    state.begin(chatEnvironment,'other');assert.equal(state.receive(token,cardSnapshot()),false);
});
test('card choices, free text, dates and numeric steps validate before a native submission',()=>{
    const card=new NativeCard('run',cardRow());
    assert.deepEqual(card.answer(['b']),{picks:['b']});
    for(const picks of [[],['a','b'],['a','a'],['foreign']])assert.throws(()=>card.answer(picks),/available/);
    const withPresentation=p=>new NativeCard('run',cardRow({presentation:p}));
    assert.deepEqual(withPresentation({kind:'checkbox',allowEmpty:true,options:card.options}).answer([]),{picks:[]});
    assert.throws(()=>withPresentation({kind:'radio',options:[{id:'a',label:'A'},{id:'a',label:'B'}]}),/incomplete/);
    const text=withPresentation({kind:'text'});assert.deepEqual(text.answer([],'Exact λ'),{value:'Exact λ'});
    for(const value of ['', 'λ'.repeat(17000)])assert.throws(()=>text.answer([],value),/bounded/);
    const date=withPresentation({kind:'date',min:'2026-01-01',max:'2026-12-31'});
    assert.deepEqual(date.answer([],'2026-11-07'),{value:'2026-11-07'});
    for(const value of ['2026-02-30','2025-11-07','next week'])assert.throws(()=>date.answer([],value),/date/);
    const slider=withPresentation({kind:'slider',min:1,max:5,step:0.5});
    assert.deepEqual(slider.answer([],'2.5'),{value:2.5});
    for(const value of ['', 'NaN','2.2','9'])assert.throws(()=>slider.answer([],value),/steps/);
});
test('a card remains pending until its exact environment and canonical response receipt arrive',()=>{
    const {state,token,card}=loadedCards();const request=state.request(card,'submit',card.answer(['a']));
    assert.deepEqual(request,{environment:chatEnvironment,conversationId:'conversation',operation:'respond',
        correlationId:'question-1',action:'submit',payload:{picks:['a']}});
    assert.throws(()=>state.request(card,'cancel'),/changed/);assert.equal(state.cards.length,1);
    const receipt=chatEnvelope([{responded:true,conversationId:'conversation',correlationId:card.id}]);
    assert.throws(()=>state.responded(token,card.id,{...receipt,environment:{...chatEnvironment,workspaceId:'foreign'}}),/reconciliation/);
    assert.throws(()=>state.responded(token,card.id,chatEnvelope([{...receipt.rows[0],correlationId:'foreign'}])),/reconciliation/);
    assert.equal(state.cards.length,1);assert.equal(state.responded(token,card.id,receipt),true);
    assert.equal(state.cards.length,0);assert.equal(state.pending,null);
    state.receive(token,cardSnapshot([cardRow()],2));assert.equal(state.cards.length,0,'ack tombstone prevents stale resurrection');
});
test('failed card responses require reconciliation and cannot affect another conversation',()=>{
    const {state,token,card}=loadedCards();state.request(card,'decline');state.failed(token,new Error('lost acknowledgement'));
    assert.equal(state.cards.length,1);assert.equal(state.connected,false);
    assert.throws(()=>state.request(card,'submit',card.answer(['a'])),/reconnect/);
    state.begin(chatEnvironment,'other');state.failed(token,new Error('late failure'));
    assert.equal(state.error,null);assert.equal(state.responded(token,card.id,{}),false);
});
test('expired and unsupported cards cannot submit; secure links stay on the selected origin',()=>{
    const {state}=loadedCards();state.receive(state.generation,cardSnapshot([cardRow({timeoutMs:1,allowDecline:false})],2));
    const expired=state.cards[0];assert.equal(expired.expired,true);assert.throws(()=>state.request(expired,'cancel'),/changed/);
    const card=new NativeCard('run',cardRow({presentation:{kind:'browser',link:'/api/ui/cards/question-1/link'},
        report:{title:'Review',plans:[{title:'Plan',items:[{id:'P-001',text:'Verify it'}]}]}}));
    assert.equal(card.canSubmit,false);assert.match(card.prose,/Review.*Plan.*Verify it/s);
    assert.equal(card.secureLink(chatEnvironment),'http://fixture/api/ui/cards/question-1/link');
    assert.equal(card.secureLink({...chatEnvironment,endpoint:'https://user@foreign'}),null);
    assert.equal(new NativeCard('run',cardRow({presentation:{link:'https://foreign'}})).secureLink(chatEnvironment),null);
});
const savedEvent = (n,event,patch={}) => chatFrame('chat-event', {schemaVersion:1,conversationId:'conversation',
    turnId:replyId,sequence:n,eventId:'event-'+n,event,...patch});
const replyState = phase => ({schemaVersion:1,conversationId:'conversation',turnId:replyId,revision:1,lastSequence:1,phase,
    capabilities:Object.fromEntries(['connectionReplay','persistedHistory','persistedInteractionDecisions',
        'completedToolCheckpoints','interruptedTurnRecovery'].map(k=>[k,true]))});
function activeReply() {
    const reply=new ChatReply(chatEnvironment,'conversation','Hello',userId);
    reply.receive(chatFrame('turn-meta',{schemaVersion:1,conversationId:'conversation',turnId:replyId}));
    return reply;
}
test('voice requests and receipts retain exact identity and reject malformed, empty and oversized results', () => {
    const request = {environment:chatEnvironment,conversationId:replyId,requestId:userId,operation:'transcribe',audioBase64:'UklGRg=='};
    assert.deepEqual(nativeVoiceRequest(request),request);
    assert.equal(nativeVoiceRequest({...request,audioBase64:'AAAA'.repeat(649999)}).audioBase64.length,2599996);
    for (const audioBase64 of ['AAB=','AB==','AA=A','AAAA='])
        assert.throws(()=>nativeVoiceRequest({...request,audioBase64}),/voice/);
    const receipt = {...request,text:'Recognized speech'}; delete receipt.audioBase64;
    const payload = chatEnvelope([receipt]);
    assert.equal(nativeVoiceResult(request,payload).text,'Recognized speech');
    for (const row of [{...receipt,requestId:replyId},{...receipt,conversationId:userId},
        {...receipt,operation:'speak'},{...receipt,text:''},{...receipt,text:'λ'.repeat(17000)}])
        assert.throws(()=>nativeVoiceResult(request,chatEnvelope([row])),/receipt|usable/);
    assert.throws(()=>nativeVoiceResult(request,chatEnvelope([receipt],{...chatEnvironment,store:{id:'foreign'}})),/receipt/);
    assert.throws(()=>nativeVoiceResult(request,chatEnvelope([receipt,receipt])),/receipt/);
    for (const bad of [{...request,conversationId:'foreign'},{...request,text:'injected'},
        {...request,audioBase64:'not base64'},{...request,audioBase64:'AAAA'.repeat(650001)}])
        assert.throws(()=>nativeVoiceRequest(bad),/voice/);
    const speak={environment:chatEnvironment,conversationId:replyId,requestId:userId,operation:'speak',text:'Read this'};
    assert.deepEqual(nativeVoiceRequest(speak),speak);
    assert.equal(nativeVoiceResult(speak,chatEnvelope([{...speak,audioBase64:'AAEC'}])).audioBase64,'AAEC');
    assert.throws(()=>nativeVoiceResult(speak,chatEnvelope([{...speak,audioBase64:'invalid'}])),/usable/);
});
test('indexed voice rejects malformed requests and foreign or incomplete chunk receipts', () => {
    const request = {environment:chatEnvironment,conversationId:replyId,requestId:userId,operation:'speak',text:'λ'.repeat(5000),chunkIndex:1};
    const row = {...request,audioBase64:'AAEC',totalChunks:3};
    assert.equal(nativeVoiceResult(request,chatEnvelope([row])).totalChunks,3);
    for (const chunkIndex of [-1,0.5,'1',null,32768]) assert.throws(()=>nativeVoiceRequest({...request,chunkIndex}),/chunk/);
    assert.throws(()=>nativeVoiceRequest({...request,operation:'transcribe'}),/chunk/);
    for (const bad of [{chunkIndex:0},{chunkIndex:undefined},{totalChunks:1},{totalChunks:0},
        {totalChunks:'3'},{totalChunks:32769},{totalChunks:2.5}])
        assert.throws(()=>nativeVoiceResult(request,chatEnvelope([{...row,...bad}])),/chunk/);
});
test('full native reading waits for each playback and stops on cancellation, changed totals or later failure', async () => {
    const request = {environment:chatEnvironment,conversationId:replyId,requestId:userId,operation:'speak',text:'λ🙂 literal $() '.repeat(500)};
    for (const scenario of ['complete','cancel-synthesis','cancel-playback','provider','player','total']) {
        const events=[]; let active=true, release;
        const playback = new Promise(resolve=>{release=resolve;});
        const reading=readNativeReply(request,{
            current:()=>active,synthesizing:()=>{events.push('synthesizing');return true;},
            voice:async chunk=>{
                events.push('fetch'+chunk.chunkIndex); assert.equal(chunk.text,request.text);
                if(scenario==='cancel-synthesis')active=false;
                if(scenario==='provider' && chunk.chunkIndex===1)throw Error('provider failed');
                return chatEnvelope([{...chunk,audioBase64:'AAEC',totalChunks:scenario==='total' && chunk.chunkIndex===1?3:2}]);
            },
            play:async ()=>{
                events.push('play');await playback;
                if(scenario==='cancel-playback')active=false;
                if(scenario==='player')throw Error('player failed');
            },
        });
        await Promise.resolve();await Promise.resolve();
        assert.deepEqual(events,scenario==='cancel-synthesis'?['fetch0']:['fetch0','play']);
        release();
        if(['provider','player','total'].includes(scenario))await assert.rejects(reading,/failed|total/);
        else assert.equal(await reading,scenario==='complete');
        if(scenario==='complete')assert.deepEqual(events,['fetch0','play','synthesizing','fetch1','play']);
        else assert.ok(!events.includes('fetch2'));
        if(scenario.startsWith('cancel') || scenario==='player')assert.ok(!events.includes('fetch1'));
        if(scenario==='total')assert.equal(events.filter(e=>e==='play').length,1);
    }
});
test('voice transcription requires the live operation and preserves drafts through edits, refresh and cancellation', () => {
    const conversationId='00000000-0000-4000-8000-000000000003';
    const {state}=loadedChat([],false,conversationId);state.draft='Original draft';
    const request={environment:chatEnvironment,conversationId,requestId:userId,operation:'transcribe',audioBase64:'AAEC'};
    const payload=chatEnvelope([{...request,text:'Voice draft'}]);
    state.beginVoice(userId,'permission');
    assert.equal(state.advanceVoice(userId,'playing'),false);
    assert.equal(state.advanceVoice(userId,'recording'),true);
    assert.throws(()=>state.beginVoice(replyId,'permission'),/finish/);
    assert.equal(state.advanceVoice(userId,'transcribing'),true);
    assert.throws(()=>state.transcribed(userId,request,chatEnvelope([{...request,text:''}])),/usable/);
    assert.equal(state.draft,'Original draft');
    assert.equal(state.transcribed(userId,request,payload),true);
    assert.equal(state.draft,'Voice draft');assert.equal(state.voicePhase,null);
    assert.equal(state.send(replyId).modality,'voice');
    for (const action of ['edit','refresh','cancel','send','earlier']) {
        const {state}=loadedChat([turn(5,{conversationId})],true,conversationId);state.draft='Keep me';
        state.beginVoice(userId,'permission');state.advanceVoice(userId,'recording');state.advanceVoice(userId,'transcribing');
        if(action==='edit')state.draft='New edit';
        if(action==='refresh')state.begin();
        if(action==='cancel')state.cancelVoice();
        if(action==='send')state.send(replyId);
        if(action==='earlier')state.beginEarlier();
        assert.equal(state.transcribed(userId,request,payload),false,action);
        if(action!=='refresh')assert.equal(state.draft,action==='edit'?'New edit':'Keep me',action);
    }
});
test('voice playback cannot follow a changed conversation, draft or active reply', () => {
    const {state}=loadedChat([turn(5,{role:'assistant',text:'Spoken reply'})]);
    assert.equal(state.spokenReply,'Spoken reply');
    state.beginVoice(userId,'synthesizing');
    assert.equal(state.advanceVoice(userId,'playing'),true);
    state.draft='Typed correction';
    assert.equal(state.voiceCurrent(userId),false);
    assert.equal(state.send(replyId).modality,'text');
    assert.throws(()=>state.beginVoice(userId,'permission'),/Load/);
});
test('Papercup history rejects foreign, duplicate, unordered and incomplete pages without changing the transcript', () => {
    for (const rows of [[turn(3),turn(2)],[turn(2),turn(3,{id:'message-2'})],
        [turn(2,{conversationId:'foreign'})],[turn(2,{seq:NaN})],[turn(2,{role:'unknown'})],[turn(2,{text:null})]]) {
        const {state,token}=loadedChat([turn(5)],true),cursor=state.beginEarlier();
        assert.throws(()=>state.settle(token,chatEnvironment,'conversation',chatEnvelope([{turns:rows,hasMoreEarlier:false}]),cursor),/invalid|foreign/);
        assert.deepEqual(state.turns,[turn(5)]);
    }
    const {state,token}=loadedChat([turn(5)],true),cursor=state.beginEarlier();
    assert.throws(()=>state.settle(token,chatEnvironment,'conversation',chatEnvelope([{turns:[],hasMoreEarlier:true}]),cursor),/incomplete/);
    assert.throws(()=>state.settle(token,chatEnvironment,'conversation',chatEnvelope([{turns:[turn(4)],hasMoreEarlier:false}],
        {...chatEnvironment,store:{id:'other'}}),cursor),/environment/);
    assert.equal(state.settle(token,chatEnvironment,'conversation',chatEnvelope([{turns:[turn(2),turn(3)],hasMoreEarlier:false}]),cursor),true);
    assert.deepEqual(state.turns.map(r=>r.seq),[2,3,5]); assert.equal(state.hasMoreEarlier,false);
});
test('Papercup drafts and late history are isolated by generation, environment and conversation', () => {
    const {state,token}=loadedChat();state.draft='Keep my draft';
    const next=state.begin();
    assert.equal(state.settle(token,chatEnvironment,'conversation',chatEnvelope([{turns:[turn(1)],hasMoreEarlier:false}])),false);
    state.bind(next,chatEnvironment,chatEnvelope([conversation('other')]));
    state.settle(next,chatEnvironment,'other',chatEnvelope([{turns:[],hasMoreEarlier:false}]));
    assert.equal(state.draft,'');state.draft='Other draft';
    const back=state.begin();state.bind(back,chatEnvironment,chatEnvelope([conversation()]));
    state.settle(back,chatEnvironment,'conversation',chatEnvelope([{turns:[],hasMoreEarlier:false}]));
    assert.equal(state.draft,'Keep my draft');
    const foreign={...chatEnvironment,endpoint:'http://different'},changed=state.begin();
    state.bind(changed,foreign,chatEnvelope([conversation()],foreign));
    state.settle(changed,foreign,'conversation',chatEnvelope([{turns:[],hasMoreEarlier:false}],foreign));
    assert.equal(state.draft,'');
    assert.throws(()=>state.bind(changed,foreign,chatEnvelope([conversation()],chatEnvironment)),/environment/);
});
test('Papercup clears a draft only after the exact saved acknowledgement and refuses duplicate sends', () => {
    const {state,token}=loadedChat();state.draft='Hello';
    assert.deepEqual(state.send(userId),{environment:chatEnvironment,conversationId:'conversation',operation:'send',
        text:'Hello',userTurnId:userId,modality:'text'});
    assert.equal(state.draft,'Hello');assert.equal(state.canSend,false);
    assert.throws(()=>state.send(userId),/Load/);
    assert.throws(()=>state.receive(token,chatFrame('user-saved',{conversationId:'foreign',turn:turn(1,{id:userId,role:'user',text:'Hello'})})),/acknowledgement/);
    state.receive(token,chatFrame('user-saved',{conversationId:'conversation',turn:turn(1,{id:userId,role:'user',text:'Hello'})}));
    assert.equal(state.draft,'');assert.equal(state.turns.length,1);
    state.draft='A newer edit';state.receive(token,chatFrame('user-saved',{conversationId:'conversation',turn:turn(1,{id:userId,role:'user',text:'Hello'})}));
    assert.equal(state.draft,'A newer edit');assert.equal(state.turns.length,1);
    state.replyFailed(token,new Error('Lost acknowledgement'));assert.equal(state.canSend,false);
    assert.equal(state.reply.phase,'needs-reconciliation');
    state.invalidate();assert.equal(state.receive(token,chatFrame('error',{})),false);
});
test('Papercup progressively projects say text and enforces exact event replay and atomic sequence gaps', () => {
    const reply=activeReply();
    const first=savedEvent(1,{type:'delta',text:'<think>private</think><say>Hi</sa'});reply.receive(first);
    assert.equal(reply.displayText,'Hi');
    reply.receive(first);assert.equal(reply.displayText,'Hi');
    assert.throws(()=>reply.receive(savedEvent(1,{type:'delta',text:'conflict'})),/Conflicting/);
    assert.throws(()=>reply.receive(savedEvent(3,{type:'delta',text:'gap'})),/gap/);
    assert.equal(reply.sequence,1);assert.equal(reply.displayText,'Hi');
    reply.receive(savedEvent(2,{type:'delta',text:'y><think>hidden</think>'}));assert.equal(reply.displayText,'Hi');
    reply.receive(savedEvent(3,{type:'tool_call',name:'plans:get',callId:'literal+/=&'}));
    reply.receive(savedEvent(4,{type:'tool_result',name:'plans:get',callId:'literal+/=&',ok:false}));
    assert.deepEqual(reply.tools,['plans:get · running','plans:get · failed']);
    const cursor=reply.sequence;
    assert.throws(()=>reply.receive(savedEvent(5,{type:'tool_result',name:'plans:get',callId:'literal+/=&'})),/tool/);
    assert.equal(reply.sequence,cursor);
});
test('Papercup reconnect and cancellation require the saved reply identity and terminal canonical receipt', () => {
    const reply=activeReply();reply.receive(savedEvent(1,{type:'delta',text:'<say>Partial'}));reply.disconnected();
    assert.deepEqual(reply.control('reconnect'),{environment:chatEnvironment,conversationId:'conversation',
        operation:'reconnect',turnId:replyId,afterSequence:1});
    assert.equal(reply.control('cancel').turnId,replyId);
    assert.throws(()=>reply.receive(chatFrame('cancelled',{ok:true,state:{...replyState('cancelled'),turnId:userId}})),/state/);
    assert.equal(reply.complete,false);
    reply.receive(chatFrame('cancelled',{ok:true,state:replyState('cancelled')}));
    assert.equal(reply.complete,true);assert.equal(reply.phase,'cancelled');
    assert.throws(()=>reply.control('reconnect'),/identity/);
    const unbound=new ChatReply(chatEnvironment,'conversation','Hello',userId);
    assert.throws(()=>unbound.control('cancel'),/identity/);
});
test('Papercup completion refuses mismatched persistence and environment while preserving its reply', () => {
    const reply=activeReply();
    assert.throws(()=>reply.receive(chatFrame('done',{persistedTurn:{conversationId:'foreign',turnId:replyId,seq:2}})),/acknowledgement/);
    assert.throws(()=>reply.receive(chatFrame('run-meta',{chatProtocolVersion:1,conversationId:'conversation'},
        {...chatEnvironment,agentChat:{scope:'other'}})),/environment/);
    assert.throws(()=>reply.receive(chatFrame('turn-state',replyState('failed'))),/failed/);
    assert.equal(reply.complete,false);
    reply.receive(chatFrame('done',{phase:'completed',persistedTurn:{conversationId:'conversation',turnId:replyId,seq:2}}));
    assert.equal(reply.phase,'completed');assert.equal(reply.complete,true);
});

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
test('Inbox connection changes retire old action receipts and isolate review state with identical IDs', () => {
    for (const operation of ['apply', 'start']) {
        const {state, token: readToken} = loadedInbox();
        if (operation === 'start') state.settleBulk(readToken, bulk([], null));
        state.selectedReviews.add(question.id); state.drafts.set(question.id, 'Previous connection draft');
        state.applied.add('previously-resolved'); state.selection = question.id; state.answer = 'Previous answer';
        const request = state.request(operation, environment, {itemId: question.id});
        const oldAction = state.beginAction([request]);
        const nextRead = state.begin({resetEnvironment: true});
        const receipt = {environment, rows: [{ok: true, resolved: true, itemId: question.id, runId: 'old-run'}]};
        assert.throws(() => state.recordAction(oldAction, request, receipt), /environment changed/);
        assert.equal(state.pending, false);
        assert.equal(state.savedRunId, null); assert.equal(state.selection, null);
        assert.equal(state.answer, ''); assert.equal(state.actionNotice, null);
        assert.equal(state.selectedReviews.size, 0); assert.equal(state.drafts.size, 0);
        assert.equal(state.applied.size, 0);
        state.settleList(nextRead, envelope([{items: [question]}]));
        state.settleBulk(nextRead, bulk([recommended]));
        assert.equal(state.canSelect(question.id), true);
        assert.equal(state.draft(recommended), recommended.draftAnswer || '');
        state.selectedReviews.add(question.id);
        const nextRequest = state.request('apply', environment, {itemId: question.id});
        const nextAction = state.beginAction([nextRequest]);
        state.finishAction(oldAction, new Error('Old connection ended'));
        assert.equal(state.pending, true); assert.equal(state.actionNotice, null);
        state.finishAction(nextAction);
    }
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

// Real subprocess/pipe tests: the producer waits for the consumer's receipt
// before emitting its final frame, so a buffered bridge cannot pass.
function streamFixture(temp) {
    const pui = join(temp, 'pui fixture');
    writeFileSync(pui, `#!/usr/bin/env node
import fs from 'node:fs';
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
 const r=JSON.parse(input), command=process.argv[2];
 if(command==='native-read'||command==='native-cards'&&r.operation==='respond'){
  console.log(JSON.stringify({rows:[r],environment:r.environment,version:'exact'}));return;}
 const emit=event=>console.log(JSON.stringify({environment:r.environment,event,data:{request:r,pid:process.pid}}));
 if(r.mode==='empty')return;
 if(r.mode==='failure'){process.stderr.write('canonical ACL refusal\\n'.repeat(5000));process.exitCode=1;return;}
 if(r.mode==='malformed'){console.log('{broken');return;}
 emit('first');
 if(r.mode==='wait'){setInterval(()=>{},1000);return;}
 let attempts=0; const timer=setInterval(()=>{if(fs.existsSync(r.ack)){clearInterval(timer);emit('done');}
 else if(++attempts>300){clearInterval(timer);console.error('consumer never acknowledged incremental delivery');process.exitCode=9;}},10);
});
`, {mode: 0o700});
    return pui;
}
function runStreamDriver(temp, script, helper = false) {
    const driver = join(temp, 'driver.mjs'); writeFileSync(driver, script);
    const command = helper ? 'dbus-run-session' : 'gjs';
    const config = join(temp,'session-bus.conf');
    // Same no-service-activation boundary as the maintained private Shell
    // driver: never start the host's keyring, portals or volume monitors.
    if (helper) writeFileSync(config,'<busconfig><type>session</type><listen>unix:tmpdir=/tmp</listen>'+
        '<policy context="default"><allow send_destination="*" eavesdrop="true"/>'+
        '<allow eavesdrop="true"/><allow own="*"/></policy></busconfig>');
    const args = helper ? ['--config-file='+config, '--', 'xvfb-run', '-a', 'gjs', '-m', driver] : ['-m', driver];
    const result = spawnSync(command, args, {encoding:'utf8',timeout:22000,
        env:{...process.env,GIO_USE_VFS:'local',GTK_A11Y:'none',GSETTINGS_BACKEND:'memory'}});
    writeFileSync(join(temp, 'result.json'), JSON.stringify(result, null, 2));
    assert.equal(result.status, 0, `Retained ${temp}\n${result.stderr}\n${result.stdout}`);
    assert.doesNotMatch(result.stderr, /CRITICAL/);
    assert.match(result.stdout, /NATIVE_STREAM_PASS/);
    rmSync(temp,{recursive:true,force:true});
}

// Hardware is explicitly opted into: ordinary CI must never open a microphone
// or speaker. Exercise production defaults and reject GStreamer's dummy sink,
// which otherwise makes an unavailable desktop sound device look successful.
test('production-default physical audio devices record and play without synthetic fallback',
    {skip: process.platform !== 'linux' || process.env.PAPERCUSP_NATIVE_PHYSICAL_AUDIO !== '1', timeout: 30000}, () => {
        const temp = mkdtempSync(join(tmpdir(), 'workbench-physical-audio-'));
        const audio = pathToFileURL(join(root, 'native/gnome/audio.js')).href;
        runStreamDriver(temp, `import Gio from 'gi://Gio';import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import {AudioDevices} from ${JSON.stringify(audio)};
Gst.init(null);
const parse=Gst.parse_launch;let pipeline;
Gst.parse_launch=description=>{pipeline=parse(description);return pipeline;};
// Gst.Iterator exposes conflicting boxed copy methods in GJS. GStreamer's
// own graph diagnostic includes the selected auto-device children instead.
const graph=()=>Gst.debug_bin_to_dot_data(pipeline,Gst.DebugGraphDetails.ALL);
const names=()=>{const dir=GLib.Dir.open(GLib.get_tmp_dir(),0),rows=[];let name;
 while((name=dir.read_name())!==null)if(name.startsWith('papercusp-voice-'))rows.push(name);return rows.sort().join('\\n');};
const before=names(),devices=new AudioDevices({durationMs:500}),observed=[];
for(let attempt=0;attempt<2;attempt++){
 const inspect=state=>{const selected=graph();
  if(/Gst(?:FakeSrc|FakeSink|AudioTestSrc)/.test(selected))throw Error('default audio selected a synthetic device');
  const physical=[...new Set(selected.match(/Gst(?:PipeWire|Pulse|Alsa|Jack|Oss|OpenAL)[A-Za-z]+/g)||[])];
  if(!physical.length)throw Error('default audio has no identified hardware backend: '+selected);
  observed.push({attempt,phase:state.phase,backends:physical});};
 const result=await devices.record(new Gio.Cancellable(),inspect).done;
 const bytes=GLib.base64_decode(result.audioBase64),header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<=44||header.getUint16(20,true)!==1||header.getUint16(22,true)!==1||
    header.getUint32(24,true)!==16000||header.getUint16(34,true)!==16)throw Error('physical capture did not produce mono PCM16 WAV');
 if(devices.active||names()!==before)throw Error('physical capture leaked a device or private recording');
 if(!(await devices.play(result.audioBase64,new Gio.Cancellable(),inspect).done).played)throw Error('physical playback did not complete');
 if(devices.active||names()!==before)throw Error('physical playback leaked a device or private recording');
}
if(observed.map(row=>row.phase).join(',')!=='recording,playing,recording,playing')throw Error('physical device phases incomplete');
print(JSON.stringify({physicalAudio:observed,scope:'current-build default device backend lifecycle; no installed artifact or audible quality claim'}));
print('NATIVE_STREAM_PASS');
`);
    });

test('GStreamer devices finalize mono PCM WAV, play, bound duration and clean up failed or cancelled operations',
    {skip:process.platform!=='linux',timeout:30000}, () => {
        const temp=mkdtempSync(join(tmpdir(),'workbench-audio-devices-'));
        const audio=pathToFileURL(join(root,'native/gnome/audio.js')).href;
        runStreamDriver(temp,`import Gio from 'gi://Gio';import GLib from 'gi://GLib';
import {AudioDevices} from ${JSON.stringify(audio)};
const names=()=>{const dir=GLib.Dir.open(GLib.get_tmp_dir(),0),rows=[];let name;
 while((name=dir.read_name())!==null)if(name.startsWith('papercusp-voice-'))rows.push(name);return rows.sort().join('\\n');};
const before=names(),devices=new AudioDevices({source:'audiotestsrc is-live=true wave=sine',sink:'fakesink sync=true',durationMs:2000});
let phases=[],recording;
recording=devices.record(new Gio.Cancellable(),state=>{phases.push(state.phase);
 const directory=GLib.Dir.open(GLib.get_tmp_dir(),0);let name,found=false;
 while((name=directory.read_name())!==null){if(!name.startsWith('papercusp-voice-')||before.includes(name))continue;
  const path=GLib.build_filenamev([GLib.get_tmp_dir(),name]);
  const mode=value=>Gio.File.new_for_path(value).query_info('unix::mode',Gio.FileQueryInfoFlags.NONE,null).get_attribute_uint32('unix::mode')&0o777;
  if(mode(path)!==0o700||mode(path+'/audio')!==0o600)throw Error('recording exposes private audio');found=true;}
 if(!found)throw Error('recording has no private capture file');
 GLib.timeout_add(GLib.PRIORITY_DEFAULT,100,()=>{recording.stop();return GLib.SOURCE_REMOVE;});});
let busy=false;try{devices.record(new Gio.Cancellable(),()=>{});}catch(error){busy=error.message.includes('current');}
if(!busy)throw Error('a second capture claimed the device');
const result=await recording.done,bytes=GLib.base64_decode(result.audioBase64),header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
if(bytes.length<=44||header.getUint16(20,true)!==1||header.getUint16(22,true)!==1||
 header.getUint32(24,true)!==16000||header.getUint16(34,true)!==16)throw Error('recording is not bounded mono PCM16 WAV');
if(devices.active||names()!==before)throw Error('successful recording leaked devices or private files');
const played=await devices.play(result.audioBase64,new Gio.Cancellable(),state=>phases.push(state.phase)).done;
if(!played.played||phases.join(',')!=='recording,playing'||devices.active||names()!==before)throw Error('playback lifecycle or cleanup failed');
const bounded=new AudioDevices({source:'audiotestsrc is-live=true',durationMs:100});
if(!(await bounded.record(new Gio.Cancellable(),()=>{}).done).audioBase64||names()!==before)throw Error('recording limit did not finalize');
const cancel=new Gio.Cancellable();let cancelled=false;
try{await devices.record(cancel,()=>cancel.cancel()).done;}catch(error){cancelled=error.message.includes('stopped');}
if(!cancelled||devices.active||names()!==before)throw Error('cancellation retained audio or device state');
const already=new Gio.Cancellable();already.cancel();let refused=false;
try{await devices.record(already,()=>{throw Error('cancelled capture started');}).done;}catch(error){refused=error.message.includes('stopped');}
if(!refused||names()!==before)throw Error('cancelled capture touched a device');
for(const operation of ['record','play']){let failed=false;
 try{const handle=operation==='record'?new AudioDevices({source:'no_such_audio_device'}).record(new Gio.Cancellable(),()=>{}):
 devices.play('AAEC',new Gio.Cancellable(),()=>{});await handle.done;}catch(error){failed=true;}
 if(!failed||names()!==before)throw Error('failed '+operation+' leaked private audio or reported success');}
let malformed=false;try{devices.play('AB==',new Gio.Cancellable(),()=>{});}catch(error){malformed=true;}
if(!malformed||devices.active)throw Error('noncanonical playback admitted');
print('NATIVE_STREAM_PASS');
`,true);
    });

test('resident audio helper delivers recording state, finalized WAV and playback through its GTK loop',
    {skip:process.platform!=='linux',timeout:30000}, () => {
        const temp=mkdtempSync(join(tmpdir(),'workbench-resident-audio-'));
        const helper=join(temp,'helper');
        cpSync(join(root,'native/gnome'),helper,{recursive:true});
        const helperPath=join(helper,'helper.js');
        writeFileSync(helperPath,readFileSync(helperPath,'utf8').replace('new AudioDevices()',
            "new AudioDevices({source:'audiotestsrc is-live=true',sink:'fakesink sync=true',durationMs:2000})"));
        const bridge=pathToFileURL(join(root,'native/gnome/bridge.js')).href;
        runStreamDriver(temp,`import Gio from 'gi://Gio';import GLib from 'gi://GLib';
import {ResidentBridge} from ${JSON.stringify(bridge)};
const bridge=new ResidentBridge(${JSON.stringify(helperPath)});
let timer=0,recording,phases=[];
try {
 const ready=new Promise((resolve,reject)=>{
  timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,4000,()=>{timer=0;reject(Error('resident recording state never arrived'));return GLib.SOURCE_REMOVE;});
  recording=bridge.record('/bin/false',state=>{phases.push(state.phase);if(state.phase==='recording')resolve();});
 });
 const result=recording.done;
 await Promise.race([ready,result.then(()=>{throw Error('capture completed without a recording state');})]);
 if(timer){GLib.source_remove(timer);timer=0;}
 await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,100,()=>{resolve();return GLib.SOURCE_REMOVE;}));
 recording.stop();const audio=await result;
 const bytes=GLib.base64_decode(audio.audioBase64);
 if(bytes.length<=44||new TextDecoder().decode(bytes.slice(0,4))!=='RIFF')throw Error('resident capture did not finalize WAV');
 await bridge.play('/bin/false',audio.audioBase64,state=>phases.push(state.phase)).done;
 if(phases.join(',')!=='recording,playing')throw Error('resident audio lost or duplicated its state frames');
 print('NATIVE_STREAM_PASS');
} finally {if(timer)GLib.source_remove(timer);bridge.close();}
`,true);
    });

test('resident voice transport accepts bounded audio, isolates cancellation and reaps PUI before completion',
    {skip:process.platform!=='linux',timeout:30000}, () => {
        const temp=mkdtempSync(join(tmpdir(),"workbench-voice '$-")),pui=join(temp,'pui fixture');
        writeFileSync(pui,`#!/usr/bin/env node
const fs=require('node:fs');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
 const r=JSON.parse(input);
 if(process.argv[2]!=='native-voice'){console.log(JSON.stringify({rows:[r]}));return;}
 if(r.text==='wait'){fs.writeFileSync(${JSON.stringify(join(temp,'waiting-pid'))},String(process.pid));setInterval(()=>{},1000);return;}
 console.log(JSON.stringify({environment:r.environment,rows:[{conversationId:r.conversationId,
 requestId:r.requestId,operation:r.operation,text:'Recognized speech',audioBytes:r.audioBase64?.length}]}));
});`,{mode:0o700});
        const bridge=pathToFileURL(join(root,'native/gnome/bridge.js')).href;
        runStreamDriver(temp,`import Gio from 'gi://Gio';import GLib from 'gi://GLib';
import {ResidentBridge} from ${JSON.stringify(bridge)};
const bridge=new ResidentBridge(${JSON.stringify(join(root,'native/gnome/helper.js'))}),pui=${JSON.stringify(pui)};
const environment={endpoint:'http://selected',workspaceId:'exact',store:{id:'store'},agentChat:{scope:'workspace'}};
const request={environment,conversationId:'15138297-1c15-4a94-8d70-e6bfdb15ae01',
 requestId:'25138297-1c15-4a94-8d70-e6bfdb15ae01',operation:'transcribe',audioBase64:'AAAA'.repeat(32000)};
const result=await bridge.voice(pui,request).done;
if(result.rows[0].audioBytes!==128000||result.rows[0].requestId!==request.requestId)throw Error('voice admission or identity changed');
const waiting=bridge.voice(pui,{...request,audioBase64:undefined,operation:'speak',text:'wait'});
// Attach rejection handling before requesting cancellation.
const outcome=waiting.done.then(()=>false,error=>error.message.includes('stopped'));
const file=${JSON.stringify(join(temp,'waiting-pid'))};
let attempts=0;while(!GLib.file_test(file,GLib.FileTest.EXISTS)){
 if(++attempts>500)throw Error('voice fixture never started');
 await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,10,()=>{resolve();return GLib.SOURCE_REMOVE;}));}
const pid=new TextDecoder().decode(GLib.file_get_contents(file)[1]);
const sibling=bridge.read(pui,{name:'reports.get',args:{id:'unrelated'}});waiting.cancel();
if(!await outcome||GLib.file_test('/proc/'+pid,GLib.FileTest.EXISTS))throw Error('cancelled voice PUI was not reaped');
if((await sibling).rows[0].args.id!=='unrelated')throw Error('voice cancellation poisoned another read');
bridge.close();print('NATIVE_STREAM_PASS');
`,true);
    });

test('actual GJS streaming bridge delivers incrementally, drains errors and reaps cancelled children',
    {skip:process.platform!=='linux',timeout:30000}, () => {
        const temp=mkdtempSync(join(tmpdir(),"workbench-stream '$-")), pui=streamFixture(temp);
        const bridge=pathToFileURL(join(root,'native/gnome/bridge.js')).href;
        runStreamDriver(temp, `import Gio from 'gi://Gio';import GLib from 'gi://GLib';
import {nativeStream,nativeRead} from ${JSON.stringify(bridge)};
const pui=${JSON.stringify(pui)}, ack=${JSON.stringify(join(temp,'ack'))};
const environment={endpoint:'http://selected',workspaceId:'exact',store:{id:'store'},agentChat:{scope:'workspace'}};
const request={environment,conversationId:'literal +/=& $()',ack};let frames=[];
await nativeStream(pui,request,frame=>{frames.push(frame);if(frame.event==='first')GLib.file_set_contents(ack,'received');});
if(frames.length!==2||frames[0].event!=='first'||frames[1].event!=='done'||
 JSON.stringify(frames[0].data.request)!==JSON.stringify(request))throw Error('stream identity/order changed');
for(const mode of ['malformed','failure','empty']){let rejected=false;try{await nativeStream(pui,{...request,mode},()=>{});}
catch(e){rejected=true;if(mode==='failure'&&!e.message.includes('canonical ACL refusal'))throw e;}if(!rejected)throw Error('false success '+mode);}
let child=0;const cancel=new Gio.Cancellable();let cancelled=false;
try{await nativeStream(pui,{...request,mode:'wait'},f=>{child=f.data.pid;cancel.cancel();},cancel);}catch(e){cancelled=e.message.includes('stopped');}
if(!cancelled||!child||GLib.file_test('/proc/'+child,GLib.FileTest.EXISTS))throw Error('cancelled child not reaped');
for(const command of ['native-read','shell']){let rejected=false;try{await nativeStream(pui,request,()=>{},null,command);}catch(e){rejected=true;}if(!rejected)throw Error('stream allowlist widened');}
let callbackRejected=false;try{await nativeStream(pui,{...request,mode:'wait'},()=>{throw Error('foreign conversation');});}
catch(e){callbackRejected=e.message==='foreign conversation';}if(!callbackRejected)throw Error('callback failure lost');
const already=new Gio.Cancellable();already.cancel();let refused=false;try{await nativeStream(pui,request,()=>{},already);}catch(e){refused=true;}if(!refused)throw Error('cancelled request spawned');
let oversized=false;try{await nativeStream(pui,{text:'x'.repeat(65536)},()=>{});}catch(e){oversized=true;}if(!oversized)throw Error('oversized request accepted');
print('NATIVE_STREAM_PASS');
`);
    });

test('resident GTK helper isolates concurrent reads, streams, cancellation and callback refusal',
    {skip:process.platform!=='linux',timeout:30000}, () => {
        const temp=mkdtempSync(join(tmpdir(),"workbench-resident-stream '$-")), pui=streamFixture(temp);
        const bridge=pathToFileURL(join(root,'native/gnome/bridge.js')).href;
        runStreamDriver(temp, `import GLib from 'gi://GLib';import {ResidentBridge} from ${JSON.stringify(bridge)};
const bridge=new ResidentBridge(${JSON.stringify(join(root,'native/gnome/helper.js'))}),pui=${JSON.stringify(pui)};
print('STREAM_PHASE start');
const environment={endpoint:'http://selected',workspaceId:'exact',store:{id:'store'},agentChat:{scope:'workspace'}};
let stream, frames=0, child=0;const request={environment,conversationId:'A +/=&',mode:'wait'};
stream=bridge.stream(pui,request,f=>{++frames;child=f.data.pid;stream.cancel();});
const read=bridge.read(pui,{name:'reports.get',args:{id:'B +/=&'}});let cancelled=false;
try{await stream.done;}catch(e){cancelled=e.message.includes('stopped');}
print('STREAM_PHASE cancelled');
const result=await read;if(!cancelled||frames!==1||result.rows[0].args.id!=='B +/=&')throw Error('request isolation failed');
const cardReceipt=await bridge.read(pui,{environment,conversationId:'exact-card-chat',operation:'respond',
 correlationId:'exact-card',action:'submit',payload:{value:'private answer'}},'native-cards');
if(cardReceipt.rows[0].correlationId!=='exact-card'||cardReceipt.rows[0].payload.value!=='private answer')
 throw Error('native card response used the streaming route or lost identity');
print('STREAM_PHASE read');
if(GLib.file_test('/proc/'+child,GLib.FileTest.EXISTS))throw Error('helper did not reap cancelled PUI');
const ack=${JSON.stringify(join(temp,'cards-ack'))};let cards=0;
const good=bridge.stream(pui,{environment,ack,operation:'subscribe'},f=>{++cards;if(f.event==='first')GLib.file_set_contents(ack,'received');},'native-cards');
const bad=bridge.stream(pui,request,()=>{throw Error('foreign conversation');});let refused=false;
try{await bad.done;}catch(e){refused=e.message==='foreign conversation';}await good.done;
print('STREAM_PHASE cards');
if(!refused||cards!==2)throw Error('callback refusal stopped another stream');
let malformed=false;try{await bridge.stream(pui,{environment,mode:'malformed'},()=>{}).done;}catch(e){malformed=true;}
if(!malformed||(await bridge.read(pui,{name:'still-ready',args:{}})).rows[0].name!=='still-ready')throw Error('malformed stream poisoned helper');
bridge.close();await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,150,()=>{resolve();return GLib.SOURCE_REMOVE;}));
let closed=false;try{await bridge.read(pui,{name:'closed'});}catch(e){closed=true;}if(!closed)throw Error('closed bridge accepted work');
print('NATIVE_STREAM_PASS');
`, true);
    });
