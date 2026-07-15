import{a as e,n as t,o as n,r}from"./chunk-CMxvf4Kt.js";import{t as i}from"./react-C1Wm8aMI.js";import{t as a}from"./jsx-runtime-sLPvdpSW.js";import{t as o}from"./esm-CP9a18wB.js";import{r as s}from"./SyncContext-DIxztLg9.js";import{n as c,t as l}from"./connectivity-POP_UdA-.js";import{i as u,t as d}from"./src-9yZgxa51.js";import{n as f}from"./dist-CcY72VL8.js";import{c as p,o as m,r as h}from"./dist-C9QKTU6c.js";import{n as g,t as _}from"./state-delta--NOtocKv.js";import{r as v}from"./browser-workspace-AWq1Xprv.js";import{n as y,r as b,t as x}from"./voice-prefs-client-BpdrFH-G.js";import{_ as S,a as C,c as w,d as T,f as E,g as D,h as O,i as k,l as ee,m as A,o as j,p as M,r as N,s as P,u as F}from"./operator-converse-tags-C_H_lNxe.js";import{C as I,D as te,E as L,F as ne,L as R,M as z,N as re,O as B,P as ie,d as V,f as ae,g as H,j as oe,p as se,s as ce,u as U,w as le}from"./voice-mode-CRFaqfb3.js";import{t as ue}from"./use-workspace-id-aYUt1bea.js";import{t as de}from"./voice-converse-handler-hUXbYtef.js";import{a as fe}from"./operator-shared-state-PM6_4xyE.js";import{i as pe,n as me}from"./profile-pref-BX83HuOO.js";import{t as he}from"./hotkeys-D0rMMmgG.js";import{n as W}from"./client-navigation-M0wbLHBb.js";import{t as G}from"./Tooltip-S0_1wvLs.js";import{n as K,t as q}from"./useLexicon-CKUxYaO4.js";import{t as ge}from"./createLucideIcon-Bq4a7IPy.js";import{t as _e}from"./arrow-up-right-BZX3b4q5.js";import{t as ve}from"./chevron-left-DP1TdhHw.js";import{t as ye}from"./chevron-right-OQ6shWOP.js";import{t as J}from"./coffee-CSs9HRWF.js";import{n as be,t as Y}from"./thermometer-BQI-dZqv.js";import{t as xe}from"./graduation-cap-CjmhB6A7.js";import{t as Se}from"./lightbulb-DjRyUfjr.js";import{t as Ce}from"./settings-2-BBMEXL_R.js";import{t as we}from"./wrench-Mq5rv_Ht.js";import{i as Te}from"./HiveVisualIdentity-CYadcsdi.js";import{n as Ee,t as De}from"./InputCard-B75QXEg9.js";var X=n(i()),Z=a();d(),g();function Oe(e,t){if(t.kind===`snapshot`){let{env:n}=t,r=e.get(n.runId);if(r&&r.version>=n.version)return e;let i=new Map(e);return i.set(n.runId,n),i}let{delta:n}=t,r=e.get(n.runId);if(!r)return e;let i=_(r,n);if(!i)return e;let a=new Map(e);return a.set(n.runId,{runId:i.runId,version:i.version,snapshot:i.snapshot}),a}function ke(e){if(!e||typeof e!=`object`)return!1;let t=e;return!(typeof t.runId!=`string`||t.runId.length===0||typeof t.version!=`number`||!Number.isFinite(t.version)||!t.snapshot||typeof t.snapshot!=`object`||!Array.isArray(t.snapshot.openCards))}function Ae(e){if(!e||typeof e!=`object`)return!1;let t=e;return typeof t.runId==`string`&&t.runId.length>0&&typeof t.baseVersion==`number`&&typeof t.version==`number`&&Array.isArray(t.cards)&&Array.isArray(t.order)}function je(){let[e,t]=(0,X.useState)(()=>new Map),[n,r]=(0,X.useState)(!1);return(0,X.useEffect)(()=>{let e=u({url:`/api/operator/state-snapshot?delta=1`,onOpen:()=>{r(!0),l()},onError:()=>{r(!1),c()},handlers:{snapshot:e=>{let n;try{n=JSON.parse(e)}catch{console.warn(`[useStateSnapshots] non-JSON snapshot payload`,e);return}if(!ke(n)){console.warn(`[useStateSnapshots] dropping malformed snapshot`,n);return}t(e=>Oe(e,{kind:`snapshot`,env:n}))},delta:e=>{let n;try{n=JSON.parse(e)}catch{console.warn(`[useStateSnapshots] non-JSON delta payload`,e);return}if(!Ae(n)){console.warn(`[useStateSnapshots] dropping malformed delta`,n);return}t(e=>Oe(e,{kind:`delta`,delta:n}))}}});return()=>e.close()},[]),{cards:(0,X.useMemo)(()=>{let t=[];for(let n of e.values())for(let e of n.snapshot.openCards)t.push({...e,runId:n.runId});return t},[e]),connected:n,byRun:e}}function Me(e){return e.length===0?null:e[0]}O(),N();function Ne(e,t){let n=e.presentation;if(!n||n.kind!==`radio`)return e.prompt;let r=new Map;for(let e of n.options)r.set(e.id,e.label);let i=[];for(let e of t){let t=r.get(e);t&&i.push(t)}return i.length===0?e.prompt:i.length===1?`Did you mean ${i[0]}?`:i.length===2?`Did you mean ${i[0]}, or ${i[1]}?`:`Did you mean ${i.slice(0,-1).join(`, `)}, or ${i[i.length-1]}?`}var Pe=new Set([`skip`,`cancel`,`never mind`,`nevermind`,`not now`,`forget it`,`no thanks`,`no thank you`,`pass`,`dismiss`]);function Fe(e){return Pe.has(e)}function Ie(e){return e.toLowerCase().replace(/[^a-z0-9\s]/g,` `).replace(/\s+/g,` `).trim()}var Le=new Set([`ready`,`continue`,`go`,`ok`,`okay`]),Re=new Set([`the`,`a`,`an`,`and`,`or`,`to`,`of`,`for`,`in`,`on`,`with`]);function ze(e,t,n={}){let r=t.presentation;if(!r||r.kind!==`radio`)return null;let i=r.options;if(i.length===0)return null;let a=n.minConfidence??.6;if(typeof e.confidence==`number`&&e.confidence<a)return null;let o=Ie(e.text);if(o.length===0)return null;for(let e of i)if(Ie(e.id)===o)return Be(e.id);if(i.length===1&&Le.has(o))return Be(i[0].id);for(let e of i)if(Ie(e.label)===o)return Be(e.id);if(Fe(o))return{action:`decline`};let s=Ve(o);if(s.size===0)return null;let c=[];for(let e of i){let t=Ve(Ie(e.label));t.size!==0&&(He(s,t)||He(t,s))&&c.push(e.id)}return c.length===1?Be(c[0]):c.length>1?{action:`ambiguous`,candidateIds:c}:null}function Be(e){return{action:`submit`,payload:{picks:[e]}}}function Ve(e){let t=new Set;for(let n of e.split(/\s+/))n&&(Re.has(n)||t.add(n));return t}function He(e,t){if(e.size===0)return!1;for(let n of e)if(!t.has(n))return!1;return!0}function Ue(){return{pendingObservedAtMs:null,active:null,buffer:[],ambiguityRounds:0}}var We=1e3;function Ge(e,t,n){if(e.pendingObservedAtMs!==null&&e.active===null)return t.tsMs<e.pendingObservedAtMs-250?{kind:`fall_through`}:(e.buffer.push(t),{kind:`buffered`});if(e.active===null)return{kind:`fall_through`};let r=ze(t,e.active.card);if(r===null)return{kind:`fall_through`};if(r.action===`submit`){let t={kind:`submit`,correlationId:e.active.correlationId,runId:e.active.runId,payload:r.payload};return Ye(e),t}if(r.action===`decline`){let t={kind:`decline`,correlationId:e.active.correlationId,runId:e.active.runId};return Ye(e),t}if(e.ambiguityRounds+=1,e.ambiguityRounds>2)return{kind:`fall_through`};let i=n(e.active.card,r.candidateIds);return{kind:`ambiguous`,correlationId:e.active.correlationId,runId:e.active.runId,prompt:i,round:e.ambiguityRounds}}function Ke(e,t){e.pendingObservedAtMs=t}function qe(e,t){e.active=t,e.ambiguityRounds=0,e.pendingObservedAtMs=null;let n=e.buffer.slice();return e.buffer=[],n}function Je(e){e.pendingObservedAtMs=null;let t=e.buffer.slice();return e.buffer=[],t}function Ye(e){e.active=null,e.ambiguityRounds=0}function Xe(e){e.pendingObservedAtMs=null,e.active=null,e.buffer=[],e.ambiguityRounds=0}async function Ze(e,t){let n=await fetch(`/api/operator/conversations/${encodeURIComponent(e)}/card-response`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify(t),credentials:`same-origin`});if(n.ok)return{ok:!0,status:n.status};let r={};try{r=await n.json()}catch{}return{ok:!1,status:n.status,error:r.error,details:r.details}}async function Qe(e,t){let n=await fetch(`/api/operator/conversations/${encodeURIComponent(e)}/run-cancel`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify(t),credentials:`same-origin`});if(n.ok)return{ok:!0,status:n.status};let r={};try{r=await n.json()}catch{}return{ok:!1,status:n.status,error:r.error,details:r.details}}function $e(e){return e.wakeWordEngine===`porcupine`?e.porcupineKeyword.toLowerCase():e.wakeWordEngine===`openwakeword`?e.openwakewordKeyword.replace(/_/g,` `).toLowerCase():null}function et(e){return e.map(e=>`${e.seq}:${e.tools==null?``:JSON.stringify(e.tools)}`).join(``)}var tt=`<say>`,nt=`</say>`;function rt(e){let t=Math.min(e.length,5);for(let n=t;n>0;--n)if(e.endsWith(nt.slice(0,n)))return n;return 0}var it=class{raw=``;emittedLength=0;projectedText=``;closed=!1;push(e){if(!e||this.closed)return``;this.raw+=e;let t=this.raw.indexOf(tt);if(t<0)return``;let n=t+5,r=this.raw.indexOf(nt,n),i=this.raw.slice(n,r>=0?r:void 0),a=r>=0?i:i.slice(0,i.length-rt(i));if(r>=0&&(this.closed=!0),a.length<=this.emittedLength)return``;let o=a.slice(this.emittedLength);return this.emittedLength=a.length,this.projectedText=a,o}get text(){return this.projectedText}get complete(){return this.closed}},at=r({_resetClientIdCacheForTests:()=>ct,getOrCreateClientId:()=>st});function ot(){if(typeof globalThis.crypto?.randomUUID==`function`)return globalThis.crypto.randomUUID();let e=new Uint8Array(16);globalThis.crypto.getRandomValues(e),e[6]=e[6]&15|64,e[8]=e[8]&63|128;let t=Array.from(e,e=>e.toString(16).padStart(2,`0`)).join(``);return`${t.slice(0,8)}-${t.slice(8,12)}-${t.slice(12,16)}-${t.slice(16,20)}-${t.slice(20)}`}function st(){if(typeof window>`u`)return``;if(Q)return Q;try{let e=window.sessionStorage.getItem(lt);if(e&&/^[0-9a-f-]{36}$/i.test(e))return Q=e,e;let t=ot();return window.sessionStorage.setItem(lt,t),Q=t,t}catch{return Q||=ot(),Q}}function ct(){Q=null}var lt,Q,ut=t((()=>{lt=`papercusp_ui_client_id`,Q=null})),dt={mode:`active`,sub:`ready`,messages:[],error:null,recentUserTurnTsMs:[],wantActiveAskedAtMs:0,wantActiveDeclinedAtMs:0,userTurnsSinceDecline:0,lastTurnAtMs:0,consecutiveErrorCount:0};function ft(){if(typeof window>`u`)return dt;let e=C();return e.length===0?dt:{...dt,messages:e}}function pt(e,t){switch(t.type){case`set_mode`:{let n=t.mode===`passive`?`passive_idle`:`ready`;return{...e,mode:t.mode,sub:n}}case`set_sub`:try{typeof window<`u`&&window.dispatchEvent(new CustomEvent(`papercusp:operatorSub`,{detail:{sub:t.sub}}))}catch{}return{...e,sub:t.sub};case`append_message`:return{...e,messages:[...e.messages,t.message]};case`replace_message_id`:{let n=e.messages.findIndex(e=>e.id===t.oldId);if(n<0)return e;let r=e.messages.slice();return r[n]={...r[n],id:t.newId},{...e,messages:r}}case`update_message_tools`:{let n=e.messages.findIndex(e=>e.seq===t.seq);if(n<0)return e;let r=e.messages[n].tools;if((r?JSON.stringify(r):``)===JSON.stringify(t.tools))return e;let i=e.messages.slice();return i[n]={...i[n],tools:t.tools},{...e,messages:i}}case`append_assistant_delta`:{let n=e.messages[e.messages.length-1];if(!n||n.role!==`assistant`||n.id!==t.id)return{...e,messages:[...e.messages,{role:`assistant`,content:t.text,id:t.id}]};let r=[...e.messages];return r[r.length-1]={...n,content:n.content+t.text},{...e,messages:r}}case`finalize_assistant_stream`:{let n=e.messages.findIndex(e=>e.id===t.id);if(n<0)return{...e,messages:[...e.messages,t.message]};let r=e.messages.slice();return r[n]=t.message,{...e,messages:r}}case`remove_message_id`:return e.messages.some(e=>e.id===t.id)?{...e,messages:e.messages.filter(e=>e.id!==t.id)}:e;case`set_error`:return{...e,error:t.error};case`record_user_turn`:{let n=t.tsMs-120*1e3,r=e.recentUserTurnTsMs.filter(e=>e>=n);return r.push(t.tsMs),{...e,recentUserTurnTsMs:r,userTurnsSinceDecline:e.userTurnsSinceDecline+1}}case`record_want_active_asked`:return{...e,wantActiveAskedAtMs:t.tsMs};case`record_want_active_declined`:return{...e,wantActiveDeclinedAtMs:t.tsMs,userTurnsSinceDecline:0};case`mark_turn`:return e.lastTurnAtMs===t.tsMs?e:{...e,lastTurnAtMs:t.tsMs};case`mark_error`:return{...e,consecutiveErrorCount:e.consecutiveErrorCount+1};case`reset_error_count`:return e.consecutiveErrorCount===0?e:{...e,consecutiveErrorCount:0};case`reset_messages`:return{...e,messages:[],error:null};case`replace_messages`:return{...e,messages:t.messages,error:null,lastTurnAtMs:t.lastTurnAtMs??e.lastTurnAtMs};case`prepend_messages`:return{...e,messages:[...t.messages,...e.messages]}}}var mt=3,ht=120*1e3,gt=600*1e3,_t=5;function vt(e,t=Date.now()){if(e.mode!==`passive`||P()>t)return!1;let n=t-ht;return!(e.recentUserTurnTsMs.filter(e=>e>=n).length<mt||e.wantActiveDeclinedAtMs>0&&t-e.wantActiveDeclinedAtMs<gt&&e.userTurnsSinceDecline<_t)}var yt=/(want.*back.*active|back into active|go.*active.*mode)/i;function bt(e){return yt.test(e)}var xt=/^(no\b|nah\b|nope\b|not (yet|now|really)|keep (it )?(quiet|passive)|stay (passive|quiet)|leave it)/i;function St(e){return xt.test(e.trim())}var Ct=/(shut up|leave me alone|stop talking|stop asking|ease off|be quiet|go quiet|i'?m busy|i am busy|let me (think|work|focus)|i need (quiet|silence)|you'?re talking too much|too much talking)/i,wt=50,Tt=/^(hey|ok(ay)?|wait|listen|um|uh|so|well)[,!\s.]+/i;function Et(e){let t=e.trim();if(!t||t.includes(`?`))return!1;let n=t.replace(Tt,``);return n.length<=wt&&Ct.test(n)?!0:RegExp(`^`+Ct.source,`i`).test(n)}function Dt(e,t){return t&&t.some(e=>e?.name===`chat:ask_choice`)?!0:e?e.trim().replace(/[*_`~]+$/g,``).endsWith(`?`):!1}var Ot=/^\s*(ready|next|what's next\??|whats next\??|what now\??|go|continue|keep going|let's go|lets go|resume|what should i (do|work on)( next)?\??)\s*[.!?]*\s*$/i;function kt(e){return Ot.test(e)}var At=3e4,jt=async t=>{let{getOrCreateClientId:n}=(ut(),e(at)),r=n(),i=await fetch(`/api/agent-mcp/operator-converse`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({messages:t.messages,trigger:t.trigger,mayAskActive:t.mayAskActive,modality:t.modality,welcomed_user:t.welcomedUser?{display_name:t.welcomedUser.displayName}:void 0,uiClientId:r||void 0,conversationId:t.conversationId??void 0,isAutoFire:t.isAutoFire??void 0,audienceMode:t.audienceMode}),signal:t.signal});if(!i.ok||!i.body){let e=await i.text().catch(()=>`HTTP ${i.status}`);throw Error(e||`HTTP ${i.status}`)}let a=i.body.getReader(),o=new TextDecoder,s=[];return{tools:s,chunks:(async function*(){let e=``;for(;;){let{value:t,done:n}=await a.read();if(n)break;e+=o.decode(t,{stream:!0});let r;for(;(r=e.indexOf(`

`))!==-1;){let t=e.slice(0,r);e=e.slice(r+2);let n=t.match(/^event:\s*(.+)$/m),i=t.match(/^data:\s*(.+)$/m);if(!n||!i)continue;let a=n[1].trim();if(a!==`delta`&&a!==`done`&&a!==`error`&&a!==`tool_call`)continue;let o;try{o=JSON.parse(i[1])}catch{continue}if(a===`delta`){let e=o?.text;typeof e==`string`&&(yield e)}else if(a===`tool_call`){let e=o;if(typeof e?.name==`string`&&(s.push({name:e.name,input:e.input}),typeof window<`u`))try{window.dispatchEvent(new CustomEvent(`papercusp:operatorToolCall`,{detail:{name:e.name,input:e.input,tsMs:Date.now()}}))}catch{}}else if(a===`error`){let e=o?.message;throw Error(typeof e==`string`?e:`stream error`)}else if(a===`done`)return}}})()}},Mt=(0,X.createContext)(null);function Nt(){let e=(0,X.useContext)(Mt);if(!e)throw Error(`useOperatorConversation must be used inside OperatorConversationProvider`);return e}function Pt({children:e,generationFn:t=jt}){let[n,r]=(0,X.useReducer)(pt,dt,ft),i=ue(),a=(0,X.useRef)(Ue()),o=(0,X.useRef)(null),c=(0,X.useRef)(`engineer`),l=(0,X.useRef)(!0),u=(0,X.useRef)(null),d=(0,X.useCallback)(()=>{u.current&&clearTimeout(u.current);let e=x(),t=Math.max(0,Math.min(120,e.silenceNudgeGraceSecs??30));t!==0&&(u.current=setTimeout(()=>{if(u.current=null,G.current&&typeof window<`u`)try{window.dispatchEvent(new CustomEvent(`papercusp:voiceSilenceTeardown`,{detail:{wakeword:$e(e)}}))}catch{}},t*1e3))},[]),f=(0,X.useCallback)(()=>{u.current&&=(clearTimeout(u.current),null)},[]),p=(0,X.useRef)(0),m=(0,X.useRef)(0),h=(0,X.useRef)(0),g=(0,X.useCallback)(()=>{p.current=0,m.current=0},[]),_=(0,X.useRef)(null),[v,y]=(0,X.useState)(null),C=(0,X.useRef)(null),O=(0,X.useRef)(null),N=(0,X.useRef)(!1),[I,te]=(0,X.useState)(!1),[L,ne]=(0,X.useState)(!1),R=s({queryName:`operatorConversations.current`,args:{workspaceId:i},staleTime:3e4}).data?.[0];(0,X.useEffect)(()=>{!R?.id||R.id===_.current||(_.current=R.id,y(R.id),N.current=!1)},[R?.id]);let z=s({queryName:`operatorTurns.page`,args:{conversationId:v??``,limit:200},enabled:!!v,staleTime:3e4}).data?.[0],re=(0,X.useRef)(null);(0,X.useEffect)(()=>{if(!v||!z||re.current===v)return;let e=z.turns??[];re.current=v,e.length>0?(C.current=e[0].seq,O.current=e[e.length-1].seq,te(z.hasMoreEarlier),r({type:`replace_messages`,messages:e.map(e=>({role:e.role,content:e.text,id:typeof e.id==`string`?e.id:void 0,seq:typeof e.seq==`number`?e.seq:void 0,tools:Array.isArray(e.tools)?e.tools:void 0})),lastTurnAtMs:e[e.length-1].createdAt??0})):(C.current=null,O.current=null,te(!1),r({type:`replace_messages`,messages:[]})),N.current=!0},[v,z]);let[B,V]=(0,X.useState)(null),H=s({queryName:`operatorTurns.page`,args:{conversationId:v??``,beforeSeq:B??0,limit:200},enabled:!!v&&B!==null,staleTime:6e4}),se=(0,X.useRef)(null);(0,X.useEffect)(()=>{let e=H.data?.[0];if(!e||B===null||!v)return;let t=`${v}:${B}`;se.current!==t&&(se.current=t,e.turns.length===0?te(!1):(C.current=e.turns[0].seq,te(e.hasMoreEarlier),r({type:`prepend_messages`,messages:e.turns.map(e=>({role:e.role,content:e.text,id:typeof e.id==`string`?e.id:void 0,seq:typeof e.seq==`number`?e.seq:void 0,tools:Array.isArray(e.tools)?e.tools:void 0}))})),V(null),ne(!1))},[v,B,H.data]);let ce=(0,X.useCallback)(async()=>{!_.current||L||C.current===null||!I||(ne(!0),V(C.current))},[I,L]),U=s({queryName:`operatorTurns.byConversation`,args:{conversationId:v??``,limit:200},enabled:!!v}).data??[],le=et(U);(0,X.useEffect)(()=>{if(!N.current||!Array.isArray(U)||U.length===0)return;let e=[...U].sort((e,t)=>e.seq-t.seq),t=O.current,i=new Set(n.messages.map(e=>e.id).filter(e=>!!e)),a=new Map;for(let e=n.messages.length-1;e>=Math.max(0,n.messages.length-8);e--){let t=n.messages[e];t.id&&t.id.startsWith(`opt-`)&&a.set(`${t.role}\x00${t.content}`,t.id)}let o=0,s=new Map;for(let e of n.messages)typeof e.seq==`number`&&s.set(e.seq,e.tools);for(let n of e){if(t!==null&&n.seq<=t){if(Array.isArray(n.tools)&&typeof n.seq==`number`){let e=s.get(n.seq);JSON.stringify(n.tools)!==(e?JSON.stringify(e):``)&&r({type:`update_message_tools`,seq:n.seq,tools:n.tools})}continue}if(typeof n.id==`string`&&i.has(n.id)){O.current=n.seq;continue}let e=`${n.role}\x00${n.text}`,c=a.get(e);if(c){r({type:`replace_message_id`,oldId:c,newId:n.id}),a.delete(e),O.current=n.seq;continue}r({type:`append_message`,message:{role:n.role,content:n.text,id:typeof n.id==`string`?n.id:void 0,seq:typeof n.seq==`number`?n.seq:void 0,tools:Array.isArray(n.tools)?n.tools:void 0}}),O.current=n.seq,C.current===null&&(C.current=n.seq);let l=n.createdAt??Date.now();l>o&&(o=l),n.role===`user`&&r({type:`record_user_turn`,tsMs:l})}o>0&&r({type:`mark_turn`,tsMs:o})},[U.length,le,v]),(0,X.useEffect)(()=>{ee(n.messages)},[n.messages]);let pe=(0,X.useCallback)((e,t,n=`text_typed`,i,a,o)=>{let s={role:e,text:t,source:n};a&&a.length>0&&(s.tools=a),o&&(s.report=o);let c=JSON.stringify(s);(async()=>{for(let e=1;e<=3;e++){let t=_.current??`active`;try{let e=await fetch(`/api/operator/conversations/${t}/turns`,{method:`POST`,headers:{"content-type":`application/json`},body:c});if(!e.ok)throw Error(`persist ${e.status}`);let n=await e.json();t===`active`&&typeof n.conversationId==`string`&&!_.current&&(_.current=n.conversationId,y(n.conversationId));let a=n?.turn?.seq,o=n?.turn?.id;typeof a==`number`&&((O.current===null||a>O.current)&&(O.current=a),C.current===null&&(C.current=a)),i&&typeof o==`string`&&r({type:`replace_message_id`,oldId:i,newId:o});return}catch(t){if(e===3){console.warn(`[conversation] persist failed after retries:`,t),r({type:`set_error`,error:`A message could not be saved to the conversation — it may be missing on other windows.`});return}await new Promise(t=>setTimeout(t,300*e))}}})()},[]),me=(0,X.useCallback)(async(e,t=250)=>{try{let n=_.current??`active`,r=await fetch(`/api/operator/conversations/${n}/turns?limit=30`,{signal:AbortSignal.timeout(t)});if(!r.ok)return e;let i=await r.json(),a=O.current,o=new Set(e.map(e=>e.id).filter(Boolean)),s=(i.turns??[]).filter(e=>typeof e.seq==`number`&&(a===null||e.seq>a)&&(e.role===`user`||e.role===`assistant`)&&typeof e.text==`string`&&e.text.trim()!==``&&!(typeof e.id==`string`&&o.has(e.id)));if(s.length===0)return e;let c=s.map(e=>({role:e.role,content:e.text,id:typeof e.id==`string`?e.id:void 0}));return[...e.slice(0,-1),...c,...e.slice(-1)]}catch{return e}},[]);(0,X.useEffect)(()=>{let e=j();if(e)e!==n.mode&&r({type:`set_mode`,mode:e});else{let e=M();if(e){F(e.mode),e.sleepUntilMs>0&&E(e.sleepUntilMs),e.mode!==n.mode&&r({type:`set_mode`,mode:e.mode});try{window.dispatchEvent(new CustomEvent(`papercusp:operatorMode`,{detail:{mode:e.mode}}))}catch{}}else if(F(`active`),x().operatorActiveOnStartup===!1){F(`passive`),r({type:`set_mode`,mode:`passive`});try{window.dispatchEvent(new CustomEvent(`papercusp:operatorMode`,{detail:{mode:`passive`}}))}catch{}}}let t=e=>{let t=e.detail;(t?.mode===`active`||t?.mode===`passive`)&&r({type:`set_mode`,mode:t.mode})};window.addEventListener(`papercusp:operatorMode`,t);let o=e=>{let t=e.detail,n=typeof t?.tsMs==`number`?t.tsMs:Date.now(),o=typeof t?.text==`string`?t.text:``,s=typeof t?.confidence==`number`?t.confidence:void 0;if(t?.transcriptSource,o){let e=Ge(a.current,{text:o,tsMs:n,confidence:s},Ne);if(e.kind===`buffered`)return;if(e.kind===`submit`||e.kind===`decline`){let t=_.current;t&&Ze(t,{correlationId:e.correlationId,workspaceId:i,action:e.kind,payload:e.kind===`submit`?e.payload:void 0}),r({type:`record_user_turn`,tsMs:n}),r({type:`mark_turn`,tsMs:n});return}if(e.kind===`ambiguous`){try{oe(e.prompt,`system:operator`,`polite`)}catch{}return}}r({type:`record_user_turn`,tsMs:n}),r({type:`mark_turn`,tsMs:n}),f(),g(),o&&W.current.mode===`active`&&Et(o)&&T(n)};return window.addEventListener(`papercusp:operatorUserTurn`,o),()=>{window.removeEventListener(`papercusp:operatorMode`,t),window.removeEventListener(`papercusp:operatorUserTurn`,o)}},[]);let he=(0,X.useRef)(null),W=(0,X.useRef)(n);(0,X.useEffect)(()=>{W.current=n},[n]);let G=(0,X.useRef)(!1),K=(0,X.useCallback)(async(e,n)=>{if(n?.isAutoFire&&S()){console.debug(`[operator] auto-fire deferred — a peer window is generating`);return}he.current?.abort();let i=new AbortController;he.current=i,r({type:`set_sub`,sub:`generating`}),r({type:`set_error`,error:null}),A(!0);let a=Date.now(),o=new it,s=null,l=!1,u=W.current,d=n?.messagesOverride??u.messages;try{let f=await t({messages:d,trigger:e,mayAskActive:vt(u),modality:G.current?`voice`:`text`,welcomedUser:n?.welcomedUser,signal:i.signal,conversationId:_.current??void 0,isAutoFire:n?.isAutoFire,audienceMode:c.current}),v=``;for await(let e of f.chunks){if(i.signal.aborted)return;v+=e;let t=o.push(e);t&&(s??=`opt-assistant-${typeof crypto<`u`&&crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)}`,r({type:`append_assistant_delta`,id:s,text:t})),Date.now()-a>5e3&&(a=Date.now(),A(!0))}if(i.signal.aborted)return;let y=k(v),b=f.tools&&f.tools.length>0?f.tools.slice():void 0,S=y.report??void 0,C=!!y.say||!!b||!!S;if(C){let e=y.say??``,t={role:`assistant`,content:e,...s?{id:s}:{}};if(b&&(t.tools=b),r(s?{type:`finalize_assistant_stream`,id:s,message:t}:{type:`append_message`,message:t}),n?.spokenReply&&e.trim())try{oe(e.trim(),`system:operator`,`polite`)}catch{}y.say&&bt(y.say)?r({type:`record_want_active_asked`,tsMs:Date.now()}):y.say&&r({type:`record_want_active_asked`,tsMs:0}),r({type:`mark_turn`,tsMs:Date.now()}),pe(`assistant`,e,n?.spokenReply?`voice_tts`:`text_typed`,s??void 0,b,S),l=!0}else s&&r({type:`remove_message_id`,id:s});r({type:`reset_error_count`}),y.sleep&&E(w(y.sleep));let T=y.setMode;if(!T&&W.current.mode===`active`){let e=[...d].reverse().find(e=>e.role===`user`);e&&Et(e.content)&&(T=`passive`)}if(T){F(T);try{window.dispatchEvent(new CustomEvent(`papercusp:operatorMode`,{detail:{mode:T}}))}catch{}r({type:`set_mode`,mode:T});return}let D=Dt(y.say,b),O;O=W.current.mode===`passive`?`passive_idle`:D?`awaiting_reply`:`ready`,r({type:`set_sub`,sub:O});let ee=C?b?{role:`assistant`,content:y.say??``,tools:b}:{role:`assistant`,content:y.say??``}:null,j=ee?[...W.current.messages,ee]:W.current.messages,M=x();if(y.continue&&!y.sleep){let e=Date.now();p.current===0&&(m.current=e),p.current+=1;let t=Math.max(1,Math.min(20,M.maxConsecutiveContinues??5)),r=Math.max(30,Math.min(1800,M.maxContinueChainSecs??300)),i=(e-m.current)/1e3;if(p.current<=t&&i<=r){K(`continue`,{messagesOverride:j,isAutoFire:n?.isAutoFire,spokenReply:n?.spokenReply});return}console.warn(`[operator] <continue/> chain capped`,{count:p.current,elapsedSecs:i,maxCount:t,maxSecs:r}),g()}if(!y.continue&&!y.sleep&&!D&&W.current.mode===`active`&&!fe.paused&&!G.current&&(M.proactiveTicksEnabled??!0)===!0&&P()<=Date.now()&&!n?.isAutoFire){let e=Date.now()-h.current;if(h.current===0||e>3e5){g(),K(`user_says_ready`,{messagesOverride:j,isAutoFire:!0});return}}y.continue||g()}catch(e){if(s&&!l&&r({type:`remove_message_id`,id:s}),i.signal.aborted)return;r({type:`set_error`,error:e instanceof Error?e.message:String(e)}),r({type:`mark_error`}),r({type:`set_sub`,sub:W.current.mode===`passive`?`passive_idle`:`ready`})}finally{i.signal.aborted&&s&&!l&&r({type:`remove_message_id`,id:s}),he.current===i&&A(!1),i.signal.aborted&&he.current===i&&(r({type:`set_sub`,sub:W.current.mode===`passive`?`passive_idle`:`ready`}),he.current=null)}},[t,pe]),[q,ge]=(0,X.useState)(()=>{try{return ae().mode!==`off`}catch{return!1}});(0,X.useEffect)(()=>{G.current=q},[q]),(0,X.useEffect)(()=>ie(e=>ge(e.mode!==`off`)),[]);let[_e,ve]=(0,X.useState)(!1);(0,X.useEffect)(()=>D({onModeFromPeer:e=>{F(e),r({type:`set_mode`,mode:e});try{window.dispatchEvent(new CustomEvent(`papercusp:operatorMode`,{detail:{mode:e}}))}catch{}},onSleepFromPeer:e=>{E(e)},onMirrorCleared:()=>{F(`active`),E(0),r({type:`set_mode`,mode:`active`});try{window.dispatchEvent(new CustomEvent(`papercusp:operatorMode`,{detail:{mode:`active`}}))}catch{}},onPeerGenerating:ve}),[]);let{cards:ye}=je(),J=(0,X.useMemo)(()=>Me(ye),[ye]);(0,X.useEffect)(()=>{let e=e=>{let t=e.detail;if(!t||t.name!==`chat:ask_choice`||!G.current)return;let n=typeof t.tsMs==`number`?t.tsMs:Date.now();Ke(a.current,n),o.current&&clearTimeout(o.current),o.current=setTimeout(()=>{let e=Je(a.current);for(let t of e)typeof window>`u`||window.dispatchEvent(new CustomEvent(`papercusp:operatorUserTurn`,{detail:{text:t.text,source:`voice_stt`,tsMs:t.tsMs,confidence:t.confidence,transcriptSource:`providerSTT`}}))},We)};return window.addEventListener(`papercusp:operatorToolCall`,e),()=>{window.removeEventListener(`papercusp:operatorToolCall`,e)}},[]);let be=(0,X.useRef)(new Set);(0,X.useEffect)(()=>{if(!G.current){Ye(a.current);return}if(J===null){Ye(a.current);return}if(!be.current.has(J.correlationId)&&(be.current.add(J.correlationId),typeof window<`u`))try{window.dispatchEvent(new CustomEvent(`operator:cardOpen`,{detail:{correlationId:J.correlationId,prompt:J.prompt,fallbackText:J.fallbackText}}))}catch{}let e=J.presentation,t=e!==void 0&&e.kind===`radio`&&e.voiceAnswerable===!0,n=l.current;if(!t||!n){Ye(a.current);return}if(a.current.active?.correlationId===J.correlationId)return;let r=qe(a.current,{correlationId:J.correlationId,runId:J.runId,card:J});if(r.length>0&&typeof window<`u`)for(let e of r)window.dispatchEvent(new CustomEvent(`papercusp:operatorUserTurn`,{detail:{text:e.text,source:`voice_stt`,tsMs:e.tsMs,confidence:e.confidence,transcriptSource:`providerSTT`}}));o.current&&=(clearTimeout(o.current),null)},[J]),(0,X.useEffect)(()=>{let e=new Set(ye.map(e=>e.correlationId));for(let t of Array.from(be.current))e.has(t)||be.current.delete(t)},[ye]),(0,X.useEffect)(()=>{q||(Xe(a.current),o.current&&=(clearTimeout(o.current),null),f())},[q,f]),(0,X.useEffect)(()=>{J===null&&f()},[J,f]),(0,X.useEffect)(()=>{let e=()=>{h.current=Date.now()};return window.addEventListener(`papercusp:voiceSilenceTeardown`,e),()=>{window.removeEventListener(`papercusp:voiceSilenceTeardown`,e)}},[]),(0,X.useEffect)(()=>(c.current=x().audienceMode??`engineer`,b(e=>{c.current=e.audienceMode??`engineer`})),[]),(0,X.useEffect)(()=>(l.current=x().cardAnsweringEnabled!==!1,b(e=>{let t=e.cardAnsweringEnabled!==!1,n=l.current;l.current=t,n&&!t&&Ye(a.current)})),[]);let[Y,xe]=(0,X.useState)(()=>{try{return P()}catch{return 0}});(0,X.useEffect)(()=>{let e=()=>xe(P());return e(),window.addEventListener(`papercusp:operatorSleep`,e),()=>window.removeEventListener(`papercusp:operatorSleep`,e)},[]),(0,X.useEffect)(()=>{if(Y<=0)return;let e=Y-Date.now();if(e<=0){xe(0);return}let t=setTimeout(()=>xe(0),e+100);return()=>clearTimeout(t)},[Y]);let Se=n.consecutiveErrorCount>0?2**Math.min(n.consecutiveErrorCount,6):1,Ce=(0,X.useCallback)(async()=>{let e=_.current;if(!e)return;let t=$e(x());try{await fetch(`/api/operator/conversations/${encodeURIComponent(e)}/silence-nudge`,{method:`POST`,headers:{"content-type":`application/json`},credentials:`same-origin`,body:JSON.stringify({workspaceId:i,voiceActive:G.current,...t?{wakeword:t}:{}})}),d()}catch(e){console.warn(`[silence-nudge] POST failed:`,e)}r({type:`set_sub`,sub:`nudged`})},[i,d]);(0,X.useEffect)(()=>{if(n.mode!==`active`||q||Y>Date.now())return;let e=Date.now()-n.lastTurnAtMs;if(n.lastTurnAtMs===0||e>3e5)return;let t=null;if(n.sub===`awaiting_reply`){let n=Math.max(0,At*Se-e);t=setTimeout(()=>void Ce(),n)}return()=>{t&&clearTimeout(t)}},[n.mode,n.sub,n.lastTurnAtMs,Se,q,Y]);let we=(0,X.useRef)(!1);(0,X.useEffect)(()=>{if(we.current||!N.current||n.mode!==`active`||q||Y>Date.now()||n.sub!==`ready`)return;let e=null;try{e=sessionStorage.getItem(`papercusp_just_logged_in`),e&&sessionStorage.removeItem(`papercusp_just_logged_in`)}catch{}if(e){we.current=!0,K(`user_welcomed`,{welcomedUser:{displayName:e}});return}n.messages.length>0||(we.current=!0,K(`open_canvas`))},[n.mode,n.sub,n.messages.length,q,Y,K]);let Te=(0,X.useCallback)((e,t)=>{let n=e.trim();if(!n)return;let i=`opt-${typeof crypto<`u`&&crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)}`,a={role:`user`,content:n,id:i},o=Date.now();r({type:`append_message`,message:a}),r({type:`record_user_turn`,tsMs:o}),r({type:`mark_turn`,tsMs:o}),f(),g();let s=W.current.wantActiveAskedAtMs;s>0&&o-s<6e4&&St(n)&&r({type:`record_want_active_declined`,tsMs:o}),pe(`user`,n,t?.spoken===!0?`voice_stt`:`text_typed`,i);let c=`user_message`;kt(n)?c=`user_says_ready`:(W.current.sub===`quiet_wait`||W.current.sub===`nudged`)&&(c=`quiet_wait_resume`);let l=[...W.current.messages,a];(async()=>{let e=await me(l);K(c,{messagesOverride:e,spokenReply:t?.spoken===!0})})()},[K,pe,me,f,g]);(0,X.useEffect)(()=>(de(Te),()=>de(null)),[Te]);let Ee=(0,X.useCallback)(()=>{g(),f(),K(`user_says_ready`)},[K,g,f]),De=(0,X.useCallback)(e=>{if(F(e),e===`active`){E(0);try{window.dispatchEvent(new Event(`papercusp:operatorSleep`))}catch{}}try{window.dispatchEvent(new CustomEvent(`papercusp:operatorMode`,{detail:{mode:e}}))}catch{}r({type:`set_mode`,mode:e})},[]),Oe=(0,X.useMemo)(()=>n.sub===`quiet_wait`?`Operator is quiet — type to pick up where you left off.`:null,[n.sub]),ke=(0,X.useCallback)(async e=>{let t=_.current;if(!t)throw Error(`answerChoice: no active conversation`);let n=await fetch(`/api/operator/conversations/${t}/turn-answer`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify(e)});if(!n.ok){let e=await n.text().catch(()=>``);throw Error(`turn-answer ${n.status}: ${e.slice(0,200)}`)}let i=Date.now(),a=W.current.messages.find(t=>t.seq===e.assistantSeq),o=W.current.messages;if(a?.tools&&a.tools[e.toolIndex]){let t=a.tools.map((t,n)=>n===e.toolIndex?{...t,answered:{picks:e.picks,...e.declined?{declined:!0}:{},at:i}}:t);r({type:`update_message_tools`,seq:e.assistantSeq,tools:t}),o=o.map(n=>n.seq===e.assistantSeq?{...n,tools:t}:n)}let s=e.declined?`Skipped`:e.picks.map(e=>e.label).join(` · `),c={role:`user`,content:s,id:`opt-${typeof crypto<`u`&&crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)}`};r({type:`append_message`,message:c}),r({type:`record_user_turn`,tsMs:i}),r({type:`mark_turn`,tsMs:i});let l=W.current.wantActiveAskedAtMs;l>0&&i-l<6e4&&St(s)&&r({type:`record_want_active_declined`,tsMs:i});let u=`user_message`;kt(s)?u=`user_says_ready`:(W.current.sub===`quiet_wait`||W.current.sub===`nudged`)&&(u=`quiet_wait_resume`),K(u,{messagesOverride:[...o,c]})},[K]),Ae=(0,X.useMemo)(()=>({mode:n.mode,sub:n.sub,messages:n.messages,error:n.error,busy:n.sub===`generating`,peerBusy:_e,sendUserMessage:Te,generateIdeas:Ee,flipMode:De,bannerText:Oe,hasMoreEarlier:I,loadingEarlier:L,loadEarlier:ce,answerChoice:ke,conversationId:v}),[n.mode,n.sub,n.messages,n.error,_e,Te,Ee,De,Oe,I,L,ce,ke,v]);return(0,Z.jsx)(Mt.Provider,{value:Ae,children:e})}var Ft=ge(`volume-2`,[[`path`,{d:`M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z`,key:`uqj9uw`}],[`path`,{d:`M16 9a5 5 0 0 1 0 6`,key:`1q6k2b`}],[`path`,{d:`M19.364 18.364a9 9 0 0 0 0-12.728`,key:`ijwkga`}]]),It=ge(`volume-x`,[[`path`,{d:`M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z`,key:`uqj9uw`}],[`line`,{x1:`22`,x2:`16`,y1:`9`,y2:`15`,key:`1ewh16`}],[`line`,{x1:`16`,x2:`22`,y1:`9`,y2:`15`,key:`5ykzw1`}]]),Lt={mug:J,kettle:Y,papercup:be};function Rt(e){for(let t=e.length-1;t>=0;t--)if(e[t].role===`user`&&e[t].content.trim())return e[t].content;return null}function zt(e){let{messages:t,busy:n,peerThinking:r,error:i,emptyState:a,iconForRole:s,labelForRole:c,renderToolChip:l,renderToolCard:u,inputValue:d,onInputChange:f,onSubmit:p,inputPlaceholder:m=`Send a message…`,inputIcon:h,sendLabel:g=`Send`,busyLabel:_=`…`,composerExtra:v,banner:y,thinkingLabel:b,hideInput:x,bodyClassName:S,bodyStyle:C,onLoadEarlier:w,hasMoreEarlier:T,loadingEarlier:E}=e,D=(0,X.useRef)(null),O=(0,X.useRef)(null),k=(0,X.useRef)(null),ee=(0,X.useRef)(null),A=(0,X.useRef)(null),j=(0,X.useRef)(null),M=(0,X.useRef)(null),N=t.length>0?`${t[0].role}:${t[0].content.slice(0,32)}`:null,P=t.length>0?`${t[t.length-1].role}:${t[t.length-1].content.slice(0,32)}`:null;typeof window<`u`&&A.current!==null&&N!==null&&N!==A.current&&k.current&&(M.current=k.current.scrollHeight);let F=(0,X.useRef)(!1),I=(0,X.useRef)(!1);(0,X.useEffect)(()=>{let e=k.current;if(!e)return;let t=()=>{F.current=!0};return e.addEventListener(`scroll`,t,{passive:!0}),()=>e.removeEventListener(`scroll`,t)},[]),(0,X.useEffect)(()=>{I.current=!!E},[E]),(0,X.useEffect)(()=>{if(!w)return;let e=ee.current;if(!e)return;let t=new IntersectionObserver(e=>{for(let t of e)t.isIntersecting&&F.current&&T&&(I.current||(I.current=!0,w()))},{root:k.current??null,rootMargin:`120px 0px 0px 0px`});return t.observe(e),()=>t.disconnect()},[w,T]);let te=h??a.icon,L=a.icon,ne=b??a.title,R=()=>{!d.trim()||n||(p(),requestAnimationFrame(()=>O.current?.focus()))},z=o({count:t.length,getScrollElement:()=>k.current,estimateSize:()=>64,overscan:8,getItemKey:e=>{let n=t[e];return n?`${n.role}::${n.content.slice(0,40)}::${e}`:e}}),re=z.getVirtualItems(),B=z.getTotalSize(),ie=(0,X.useRef)(!0),V=(0,X.useRef)(!1),ae=(0,X.useRef)(0),H=(0,X.useRef)(!1),oe=(0,X.useCallback)(()=>{if(ae.current=45,H.current)return;H.current=!0;let e=()=>{let t=k.current;if(!t||ae.current<=0||!ie.current){H.current=!1;return}--ae.current;let n=t.scrollHeight-t.clientHeight;Math.abs(t.scrollTop-n)>1&&(V.current=!0,t.scrollTop=n),requestAnimationFrame(e)};requestAnimationFrame(e)},[]);return(0,X.useEffect)(()=>{let e=k.current;if(!e)return;let t=()=>{if(V.current){V.current=!1;return}ie.current=e.scrollHeight-e.scrollTop-e.clientHeight<100};return e.addEventListener(`scroll`,t,{passive:!0}),()=>e.removeEventListener(`scroll`,t)},[]),(0,X.useEffect)(()=>{let e=k.current;if(!e){A.current=N,j.current=P;return}let n=M.current!==null;if(ie.current){let e=t.length-1;e>=0&&(z.scrollToIndex(e,{align:`end`}),oe()),M.current=null}else if(n){let t=e.scrollHeight-M.current;V.current=!0,e.scrollTop+=t,M.current=null}A.current=N,j.current=P},[t,n,N,P,z,oe]),(0,Z.jsxs)(Z.Fragment,{children:[y,(0,Z.jsxs)(`div`,{ref:k,className:S?`oracle-body ${S}`:`oracle-body`,style:C,tabIndex:0,role:`region`,"aria-label":`Conversation messages`,children:[w&&t.length>0&&(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(`div`,{ref:ee,"aria-hidden":`true`,style:{height:1}}),T&&E&&(0,Z.jsx)(`div`,{className:`oracle-load-earlier`,"aria-live":`polite`,children:(0,Z.jsx)(`span`,{children:`Loading earlier…`})}),!T&&(0,Z.jsx)(`div`,{className:`oracle-load-earlier`,"aria-hidden":`true`,children:(0,Z.jsx)(`span`,{className:`oracle-load-earlier-end`,children:`Beginning of conversation`})})]}),t.length===0?(0,Z.jsxs)(`div`,{className:`oracle-empty-state`,children:[(0,Z.jsx)(`span`,{className:`oracle-empty-state-icon`,children:(0,Z.jsx)(L,{"aria-hidden":!0,className:`oracle-empty-state-glyph`})}),(0,Z.jsx)(`strong`,{className:`oracle-empty-state-title`,children:a.title}),(0,Z.jsx)(`span`,{className:`oracle-empty-state-text`,children:a.body}),a.extra]}):(0,Z.jsx)(`div`,{className:`oracle-virtual-container`,style:{height:B,minHeight:B,position:`relative`,width:`100%`,flex:`0 0 auto`},children:re.map(e=>{let n=t[e.index];if(!n)return null;let r=(n.agent?Lt[n.agent]:void 0)??(s?s(n.role):a.icon),i=c?.(n.role)??(n.role===`user`?`You`:a.title),o=i.trim().length>0;return(0,Z.jsxs)(`div`,{"data-index":e.index,"data-message-index":e.index,ref:z.measureElement,className:`oracle-msg oracle-msg-${n.role}`,style:{position:`absolute`,top:0,left:0,width:`100%`,transform:`translateY(${e.start}px)`},children:[(0,Z.jsx)(`span`,{className:`oracle-msg-avatar`,"aria-hidden":`true`,children:(0,Z.jsx)(r,{className:`oracle-msg-icon`})}),(0,Z.jsxs)(`div`,{className:`oracle-msg-stack`,children:[o&&(0,Z.jsx)(`div`,{className:`oracle-msg-role`,children:i}),(()=>{let e=[],t=[];return n.tools?.forEach((r,i)=>{let a=u?.(r,n,i);a?e.push({index:i,node:a}):l&&t.push({tool:r,index:i})}),(0,Z.jsxs)(Z.Fragment,{children:[t.map(({tool:e,index:t})=>l?l(e,t):null),n.content&&(0,Z.jsx)(`div`,{className:`oracle-msg-content`,children:n.content}),e.map(({index:e,node:t})=>(0,Z.jsx)(`div`,{children:t},`tool-card-${e}`))]})})()]})]},e.key)})}),(n||r)&&(0,Z.jsxs)(`div`,{className:`oracle-thinking-row`,"aria-live":`polite`,children:[(0,Z.jsx)(`span`,{children:n?`${ne} is thinking`:`${ne} is answering in another window`}),(0,Z.jsxs)(`span`,{className:`oracle-thinking-dots`,children:[(0,Z.jsx)(`span`,{}),(0,Z.jsx)(`span`,{}),(0,Z.jsx)(`span`,{})]})]}),i&&(0,Z.jsxs)(`div`,{className:`oracle-error`,children:[`⚠ `,i]}),(0,Z.jsx)(`div`,{ref:D})]}),!x&&(0,Z.jsxs)(`form`,{className:`oracle-form`,onSubmit:e=>{e.preventDefault(),R()},children:[(0,Z.jsxs)(`div`,{className:`oracle-input-shell`,children:[(0,Z.jsx)(te,{"aria-hidden":!0,className:`oracle-input-icon`}),(0,Z.jsx)(`input`,{ref:O,value:d,onChange:e=>f(e.target.value),onKeyDown:e=>{if(e.key!==`ArrowUp`||d!==``||n)return;let r=Rt(t);r&&(e.preventDefault(),f(r))},placeholder:n?`thinking…`:m,disabled:n,"aria-label":m}),(0,Z.jsx)(`span`,{className:`oracle-input-meta`,"aria-hidden":`true`,children:n?`busy`:`enter`})]}),v,(0,Z.jsxs)(`button`,{type:`submit`,disabled:n||!d.trim(),className:`pc-button oracle-send-button`,children:[(0,Z.jsx)(_e,{"aria-hidden":`true`,className:`oracle-send-icon`}),(0,Z.jsx)(`span`,{children:n?_:g})]})]})]})}function Bt(e){let t=e.presentation;return!t||t.kind!==`radio`&&t.kind!==`checkbox`?null:{question:e.prompt,options:t.options.map(e=>({id:e.id,label:e.label,hint:e.hint,style:e.style})),multi:t.kind===`checkbox`,report:e.report}}function Vt({conversationId:e,workspaceId:t}){let{cards:n,connected:r}=je(),[i,a]=(0,X.useState)(!1),[o,s]=(0,X.useState)(null),[c,l]=(0,X.useState)(()=>new Set),u=n.filter(e=>!c.has(e.correlationId)),d=Me(u);if(d===null)return null;let f=u.length-1,p=async n=>{a(!0),s(null);let r=d.correlationId;try{let i=await Ze(e,{correlationId:r,workspaceId:t,...n});i.ok?l(e=>{let t=new Set(e);return t.add(r),t}):s(i.error??`card-response failed (${i.status})`)}catch(e){s(e instanceof Error?e.message:String(e))}finally{a(!1)}},m=e=>{e.action===`submit`?p({action:`submit`,payload:{picks:e.picks.map(e=>e.option_id)}}):e.action===`decline`?p({action:`decline`,reason:e.reason}):p({action:`cancel`})},h=e=>{e.action===`submit`?p({action:`submit`,payload:{value:e.value}}):p({action:`decline`,reason:e.reason})},g=async()=>{a(!0),s(null);let n=d.runId,r=u.filter(e=>e.runId===n).map(e=>e.correlationId);try{let i=await Qe(e,{runId:n,workspaceId:t});i.ok?l(e=>{let t=new Set(e);for(let e of r)t.add(e);return t}):s(i.error??`run-cancel failed (${i.status})`)}catch(e){s(e instanceof Error?e.message:String(e))}finally{a(!1)}},_=Bt(d),v=d.presentation?.kind,y=v===`text`||v===`date`||v===`slider`,b;return b=_?(0,Z.jsx)(Ee,{args:_,onResponse:m,allowDecline:d.allowDecline??!0}):y&&d.presentation?(0,Z.jsx)(De,{prompt:d.prompt,presentation:d.presentation,fallbackText:d.fallbackText,allowDecline:d.allowDecline??!0,onResponse:h}):(0,Z.jsxs)(`div`,{className:`pending-cards-bar pending-cards-bar--fallback`,role:`status`,children:[(0,Z.jsx)(`p`,{children:d.prompt}),(0,Z.jsx)(`p`,{className:`pending-cards-bar-hint`,children:d.fallbackText??`No renderer for this card type yet.`})]}),(0,Z.jsxs)(`div`,{className:`pending-cards-bar`,"data-busy":i?`true`:`false`,children:[b,(0,Z.jsxs)(`div`,{className:`pending-cards-bar-meta`,children:[f>0&&(0,Z.jsxs)(`p`,{className:`pending-cards-bar-queue`,"aria-live":`polite`,children:[f,` more `,f===1?`card`:`cards`,` after this`]}),(0,Z.jsx)(G,{label:`Cancel — abort all pending prompts under this run`,children:(0,Z.jsx)(`button`,{type:`button`,className:`pending-cards-bar-cancel-run`,onClick:()=>void g(),disabled:i,"aria-label":`Cancel this run`,children:`Cancel`})})]}),!r&&(0,Z.jsx)(`p`,{className:`pending-cards-bar-disconnected`,role:`status`,children:`Live updates disconnected — submitted answers still apply.`}),o&&(0,Z.jsx)(`p`,{className:`pending-cards-bar-error`,role:`alert`,children:o})]})}var Ht=new Map;function Ut(e,t){Ht.set(e,t)}function Wt(e,t){let n=Ht.get(e);return n?n(t):null}Ut(`chat:ask_choice`,({args:e,answered:t,onAnswer:n})=>!e||typeof e!=`object`||!e.question||!Array.isArray(e.options)||e.options.length===0?null:(0,Z.jsx)(Ee,{args:e,answered:t,onResponse:e=>{e.action===`submit`?n({picks:e.picks}):e.action===`decline`&&n({picks:[],declined:!0})}}));var Gt=(0,X.forwardRef)(function({className:e,decorative:t=!0,variant:n=`full`,...r},i){let a=K(),o=(0,X.useId)().replace(/:/g,``);if(a===`the-hive`)return(0,Z.jsx)(Te,{ref:i,className:e,decorative:t,"data-hive-mark":n,...r});let s={bg:`${o}-bg`,ring:`${o}-ring`,cup:`${o}-cup`,coffee:`${o}-coffee`,glow:`${o}-glow`},c=n===`compact`;return(0,Z.jsxs)(`svg`,{ref:i,viewBox:`18 12 92 92`,className:e,"aria-hidden":t?!0:void 0,focusable:`false`,...r,children:[(0,Z.jsxs)(`defs`,{children:[(0,Z.jsxs)(`radialGradient`,{id:s.bg,cx:`50%`,cy:`38%`,r:`68%`,children:[(0,Z.jsx)(`stop`,{offset:`0%`,stopColor:`var(--bg-raised-high, #17324a)`}),(0,Z.jsx)(`stop`,{offset:`58%`,stopColor:`var(--bg-1, #0b1624)`}),(0,Z.jsx)(`stop`,{offset:`100%`,stopColor:`var(--bg, #07101d)`})]}),(0,Z.jsxs)(`linearGradient`,{id:s.ring,x1:`0%`,y1:`0%`,x2:`100%`,y2:`100%`,children:[(0,Z.jsx)(`stop`,{offset:`0%`,stopColor:`var(--accent-soft, #b9efff)`}),(0,Z.jsx)(`stop`,{offset:`52%`,stopColor:`var(--accent, #57d8ff)`}),(0,Z.jsx)(`stop`,{offset:`100%`,stopColor:`var(--accent-deep, #178db8)`})]}),(0,Z.jsxs)(`linearGradient`,{id:s.cup,x1:`50%`,y1:`0%`,x2:`50%`,y2:`100%`,children:[(0,Z.jsx)(`stop`,{offset:`0%`,stopColor:`var(--fg, #f3eef9)`,stopOpacity:`0.95`}),(0,Z.jsx)(`stop`,{offset:`100%`,stopColor:`var(--fg-dim, #d7d2e2)`,stopOpacity:`0.78`})]}),(0,Z.jsxs)(`linearGradient`,{id:s.coffee,x1:`0%`,y1:`0%`,x2:`100%`,y2:`0%`,children:[(0,Z.jsx)(`stop`,{offset:`0%`,stopColor:`var(--warn, #c8a57b)`}),(0,Z.jsx)(`stop`,{offset:`100%`,stopColor:`var(--accent-deep, #8b5e3d)`})]}),(0,Z.jsxs)(`filter`,{id:s.glow,x:`-40%`,y:`-40%`,width:`180%`,height:`180%`,children:[(0,Z.jsx)(`feGaussianBlur`,{stdDeviation:`4`,result:`blur`}),(0,Z.jsxs)(`feMerge`,{children:[(0,Z.jsx)(`feMergeNode`,{in:`blur`}),(0,Z.jsx)(`feMergeNode`,{in:`SourceGraphic`})]})]})]}),c?(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(`circle`,{cx:`64`,cy:`64`,r:`57`,fill:`url(#${s.bg})`,stroke:`color-mix(in srgb, var(--accent-soft), transparent 84%)`,strokeWidth:`1`}),(0,Z.jsx)(`path`,{d:`M64 18c0 7.5-8.5 12-16 18`,fill:`none`,stroke:`var(--warn, #d9a977)`,strokeWidth:`3.2`,strokeLinecap:`round`}),(0,Z.jsx)(`path`,{d:`M64 18c0 7.5 8.5 12 16 18`,fill:`none`,stroke:`var(--warn, #d9a977)`,strokeWidth:`3.2`,strokeLinecap:`round`}),(0,Z.jsxs)(`g`,{transform:`translate(0 7)`,children:[(0,Z.jsx)(`path`,{d:`M34 39h60l-4.5 45c0 6-9.5 10.5-25.5 10.5S38.5 90 38.5 84z`,fill:`url(#${s.cup})`,fillOpacity:`0.16`,stroke:`var(--accent-soft, #d8f4ff)`,strokeOpacity:`0.88`,strokeWidth:`2.35`,strokeLinejoin:`round`}),(0,Z.jsx)(`ellipse`,{cx:`64`,cy:`39`,rx:`30`,ry:`6.2`,fill:`url(#${s.cup})`,fillOpacity:`0.2`,stroke:`var(--accent-soft, #d8f4ff)`,strokeOpacity:`0.88`,strokeWidth:`2.35`}),(0,Z.jsx)(`ellipse`,{cx:`64`,cy:`39`,rx:`23.5`,ry:`3.8`,fill:`url(#${s.coffee})`,fillOpacity:`0.9`}),(0,Z.jsx)(`path`,{d:`M44.5 58c11.2-3 27.8-3 39 0`,fill:`none`,stroke:`var(--warn, #d9a977)`,strokeOpacity:`0.74`,strokeWidth:`2.15`,strokeLinecap:`round`}),(0,Z.jsx)(`rect`,{x:`60.75`,y:`55`,width:`6.5`,height:`21`,rx:`3`,fill:`var(--accent-strong, #7ce2ff)`,fillOpacity:`0.84`}),(0,Z.jsx)(`path`,{d:`M54.5 86c2.4 3 5.6 4.5 9.5 4.5s7.1-1.5 9.5-4.5`,fill:`none`,stroke:`var(--accent-strong, #7ce2ff)`,strokeOpacity:`0.84`,strokeWidth:`2.05`,strokeLinecap:`round`})]})]}):(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(`circle`,{cx:`64`,cy:`64`,r:`59`,fill:`url(#${s.bg})`,stroke:`color-mix(in srgb, var(--accent-soft), transparent 90%)`,strokeWidth:`0.8`}),(0,Z.jsx)(`circle`,{cx:`64`,cy:`64`,r:`56`,fill:`none`,stroke:`url(#${s.ring})`,strokeOpacity:`0.38`,strokeWidth:`1.4`}),(0,Z.jsx)(`path`,{d:`M64 18c0 8-9 13-17 20`,fill:`none`,stroke:`var(--warn, #d9a977)`,strokeWidth:`3.45`,strokeLinecap:`round`}),(0,Z.jsx)(`path`,{d:`M64 18c0 8 9 13 17 20`,fill:`none`,stroke:`var(--warn, #d9a977)`,strokeWidth:`3.45`,strokeLinecap:`round`}),(0,Z.jsx)(`g`,{filter:`url(#${s.glow})`,children:(0,Z.jsx)(`circle`,{cx:`64`,cy:`29`,r:`2.8`,fill:`var(--accent-strong, #7ce2ff)`})}),(0,Z.jsxs)(`g`,{transform:`translate(0 3)`,children:[(0,Z.jsx)(`path`,{d:`M31 39h66l-4.5 48c0 6.8-10.8 12.2-28.5 12.2S35.5 93.8 35.5 87z`,fill:`url(#${s.cup})`,fillOpacity:`0.16`,stroke:`var(--accent-soft, #d8f4ff)`,strokeOpacity:`0.88`,strokeWidth:`2.45`,strokeLinejoin:`round`}),(0,Z.jsx)(`ellipse`,{cx:`64`,cy:`39`,rx:`33`,ry:`6.8`,fill:`url(#${s.cup})`,fillOpacity:`0.2`,stroke:`var(--accent-soft, #d8f4ff)`,strokeOpacity:`0.88`,strokeWidth:`2.45`}),(0,Z.jsx)(`ellipse`,{cx:`64`,cy:`39`,rx:`25.5`,ry:`4.1`,fill:`url(#${s.coffee})`,fillOpacity:`0.9`}),(0,Z.jsx)(`path`,{d:`M43.5 59c11.8-3.2 29.2-3.2 41 0`,fill:`none`,stroke:`var(--warn, #d9a977)`,strokeOpacity:`0.74`,strokeWidth:`2.25`,strokeLinecap:`round`}),(0,Z.jsx)(`rect`,{x:`60.6`,y:`56`,width:`6.8`,height:`22`,rx:`3.2`,fill:`var(--accent-strong, #7ce2ff)`,fillOpacity:`0.84`}),(0,Z.jsx)(`path`,{d:`M54 88c2.6 3.3 6 4.9 10 4.9s7.4-1.6 10-4.9`,fill:`none`,stroke:`var(--accent-strong, #7ce2ff)`,strokeOpacity:`0.84`,strokeWidth:`2.1`,strokeLinecap:`round`})]})]})]})}),Kt=[{title:`Scan workspaces`,hint:`find active harnesses and urgent issues`,prompt:`Scan my workspaces for active harnesses and urgent issues.`},{title:`Review blockers`,hint:`surface failing runs, audits, and pending answers`,prompt:`Review current blockers, failing runs, audits, and pending answers.`},{title:`Summarize state`,hint:`get a quick brief on what changed recently`,prompt:`Summarize the current workspace state and what changed recently.`}];function qt({messages:e,busy:t,peerBusy:n,passive:r,onSend:i,onGenerateIdeas:a,banner:o,error:s,onLoadEarlier:c,hasMoreEarlier:l,loadingEarlier:u,onAnswerChoice:d,conversationId:f,workspaceId:p}){let[m,h]=(0,X.useState)(``),g=(0,X.useCallback)(()=>{let e=m.trim();e&&(h(``),i(e))},[m,i]),_=(0,X.useCallback)((e,t,n)=>Wt(e.name,{args:e.input??{},answered:e.answered,onAnswer:e=>{if(typeof t.seq!=`number`||!d)return;let{picks:r,declined:i}=e;Promise.resolve(d({assistantSeq:t.seq,toolIndex:n,picks:r,...i?{declined:!0}:{}})).catch(e=>{console.warn(`[operator-chat] answerChoice failed:`,e)})}}),[d]);return(0,Z.jsx)(zt,{messages:e,busy:t,peerThinking:n,error:s,banner:(0,Z.jsxs)(Z.Fragment,{children:[o,f&&p&&(0,Z.jsx)(Vt,{conversationId:f,workspaceId:p})]}),emptyState:{title:`Papercup`,body:r?`In passive mode. Type below to wake them.`:`Tell me what you want to inspect, scan, or unblock.`,icon:Gt,extra:(0,Z.jsxs)(`div`,{className:`op-chat-empty-panel`,"aria-label":`Quick draft prompts`,children:[(0,Z.jsxs)(`div`,{className:`op-chat-empty-panel-head`,children:[(0,Z.jsx)(Gt,{variant:`compact`,className:`op-chat-empty-panel-logo`}),(0,Z.jsx)(`div`,{className:`op-chat-empty-panel-label`,children:`Quick draft prompts`})]}),(0,Z.jsx)(`div`,{className:`op-chat-empty-panel-list`,children:Kt.map(({title:e,hint:n,prompt:r})=>(0,Z.jsxs)(`button`,{type:`button`,className:`op-chat-empty-row`,onClick:()=>h(r),disabled:t,"aria-label":`${e}: ${n}. Draft this prompt.`,children:[(0,Z.jsx)(`span`,{className:`op-chat-empty-row-title`,children:e}),(0,Z.jsx)(`span`,{className:`op-chat-empty-row-hint`,children:n})]},e))})]})},labelForRole:()=>``,inputPlaceholder:r?`Type to wake Papercup…`:`Reply to Papercup…`,inputValue:m,onInputChange:h,onSubmit:g,composerExtra:a?(0,Z.jsx)(G,{label:`Generate ideas`,side:`top`,align:`center`,children:(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Generate ideas`,onClick:a,disabled:t,className:`pc-button oracle-send-button op-chat-ideas-button`,children:(0,Z.jsx)(Se,{"aria-hidden":`true`,className:`oracle-send-icon`})})}):void 0,renderToolChip:Jt,renderToolCard:_,onLoadEarlier:c,hasMoreEarlier:l,loadingEarlier:u})}function Jt(e,t){let n=e.input??{},r=typeof n.role==`string`?n.role:typeof n.spawnId==`string`?n.spawnId:typeof n.featureId==`string`?n.featureId:typeof n.scope==`string`?n.scope:null,i=`${Yt(e.name)}${r?` (${r})`:``}`;return(0,Z.jsx)(G,{label:(0,Z.jsxs)(`span`,{className:`op-chat-tool-tooltip`,children:[(0,Z.jsxs)(`strong`,{children:[e.name,r?` (${r})`:``]}),(0,Z.jsx)(`span`,{children:JSON.stringify(n).slice(0,240)})]}),side:`right`,align:`start`,children:(0,Z.jsxs)(`span`,{className:`oracle-tool-chip`,tabIndex:0,"aria-label":`Tool call: ${i}. Raw id: ${e.name}`,children:[(0,Z.jsx)(we,{size:12}),(0,Z.jsx)(`span`,{children:i})]})},t)}function Yt(e){let t=e.replace(/^mcp__agentmcp_/,``).replace(/^mcp__/,``).replace(/^agentmcp_/,``).replace(/^search_tool_/,`search_`).replace(/_/g,` `).replace(/\s+/g,` `).trim();return t.length>0?t:e}function Xt(e,t=Date.now()){if(e==null)return`—`;let n=typeof e==`number`?e:Date.parse(e);if(!Number.isFinite(n))return`—`;let r=Math.max(0,Math.round((t-n)/1e3));if(r<60)return`${r}s`;let i=Math.round(r/60);if(i<60)return`${i}m`;let a=Math.round(i/60);return a<48?`${a}h`:`${Math.round(a/24)}d`}function Zt(e,t=99){return e>t?`${t}+`:String(e)}function Qt(e){let t=e.match(/^((?:WI|EI|F)-\d+)\s+(.*)$/);return t?{wi:t[1],rest:t[2]}:{wi:null,rest:e}}var $t={nudge:`NUDGE`,escalate:`ESCALATE`,observe:`OBSERVE`},en={nudge:`nudge`,escalate:`esc`,observe:`obs`};function tn(e){return e?`ok`:`bad`}function $({k:e,v:t,tone:n}){return(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(`span`,{className:`op-ph-k`,children:e}),(0,Z.jsxs)(`span`,{className:`op-ph-v`,children:[n!=null&&(0,Z.jsx)(`span`,{className:`op-pot-dot ${n}`,"aria-hidden":`true`}),t]})]})}function nn(){let e=s({queryName:`mugBrief.floorView`,args:{},staleTime:3e4}),t=s({queryName:`overwatch.snapshot`,args:{},staleTime:15e3}),n=s({queryName:`overwatch.liveness`,args:{},staleTime:15e3}),r=e.data?.[0],i=t.data?.[0],a=n.data?.[0],o=(0,X.useMemo)(()=>(i?.anomalies??[]).filter(e=>e.severity!==`info`).length+(i?.plans.agingEscalations??0)+(r?.escalations.length??0),[i,r]);if(!r&&!i&&!a)return(0,Z.jsx)(`div`,{className:`op-ph`,role:`region`,"aria-label":`Pot health`,children:(0,Z.jsx)(`div`,{className:`op-pot-empty op-ph-loading`,children:`Loading pot health…`})});let c=!!i&&!i.queen.stalled,l=!!a&&a.alive,u=r?Math.max(0,r.frontierTotal-r.frontier.length):0,d=i?.tokens.pausedBuckets??[],f=i?.anomalies??[],p=Object.entries(i?.observations.recentByRole??{});return(0,Z.jsxs)(`div`,{className:`op-ph`,role:`region`,"aria-label":`Pot health`,children:[(0,Z.jsxs)(`div`,{className:`op-ph-chips`,children:[(0,Z.jsxs)(`span`,{className:`op-ph-chip ${c?`ok`:`bad`}`,children:[`Mug `,Xt(i?.queen.lastWakeAt??null)]}),(0,Z.jsxs)(`span`,{className:`op-ph-chip ${l?`ok`:`bad`}`,children:[`Kettle `,Xt(a?.lastRunAt??null)]}),(0,Z.jsxs)(`span`,{className:`op-ph-chip`,children:[i?.bees.running??0,` working`]}),(0,Z.jsxs)(`span`,{className:`op-ph-chip`,children:[i?.workFeed.frontier??0,` ready`]}),i!=null&&(0,Z.jsxs)(`span`,{className:`op-ph-chip ${i.tokens.accountsAvailable>0?``:`warn`}`,children:[i.tokens.accountsAvailable,` accounts up`]}),o>0&&(0,Z.jsxs)(`span`,{className:`op-ph-chip bad`,children:[Zt(o),` need you`]})]}),(0,Z.jsxs)(`div`,{className:`op-ph-body`,children:[(0,Z.jsxs)(`h3`,{className:`op-ph-sec ket`,children:[(0,Z.jsx)(Y,{size:12,strokeWidth:2,"aria-hidden":`true`}),`What the Kettle looks at`,(0,Z.jsx)(`span`,{className:`op-ph-sec-d`,children:`system healing`})]}),!i&&(0,Z.jsx)(`div`,{className:`op-pot-empty`,children:`Loading the Kettle's brief…`}),i&&(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsxs)(`section`,{className:`op-ph-card ket`,"aria-label":`Health panels`,children:[(0,Z.jsx)(`h4`,{className:`op-ph-card-h`,children:`Health panels`}),(0,Z.jsxs)(`div`,{className:`op-ph-kv`,children:[(0,Z.jsx)($,{k:`mug`,v:`${i.queen.stalled?`stalled`:i.queen.cadenceOk?`on cadence`:`off cadence`} · woke ${Xt(i.queen.lastWakeAt)} ago · driving ${i.queen.workingTracked}`,tone:i.queen.stalled?`bad`:i.queen.cadenceOk?`ok`:`warn`}),(0,Z.jsx)($,{k:`cups`,v:`${i.bees.running} running · ${i.bees.completed} completed · ${i.bees.churning} churning · ${i.bees.deadClaims} dead claims`,tone:i.bees.churning>0||i.bees.deadClaims>0?`warn`:`ok`}),(0,Z.jsx)($,{k:`work-feed`,v:`${i.workFeed.frontier} ready · ${i.workFeed.autoEligibleStuck} stuck · ${i.workFeed.deadRoutines} dead routines · ${i.workFeed.blockedStranded} stranded`,tone:i.workFeed.deadRoutines>0?`bad`:i.workFeed.autoEligibleStuck>0?`warn`:`ok`}),(0,Z.jsx)($,{k:`tokens`,v:`${i.tokens.accountsAvailable} accounts up${d.length>0?` · paused: ${d.join(`, `)}`:``}${i.tokens.gatewayWedged?` · gateway WEDGED`:i.tokens.gatewaySustainedThrottle?` · gateway throttling`:``}`,tone:i.tokens.gatewayWedged?`bad`:d.length>0||i.tokens.gatewaySustainedThrottle?`warn`:`ok`}),(0,Z.jsx)($,{k:`plans`,v:`${i.plans.active} active · ${i.plans.stalledItems} stalled items · ${i.plans.agingEscalations} aging escalations`,tone:i.plans.agingEscalations>0?`warn`:`ok`})]})]}),(0,Z.jsxs)(`section`,{className:`op-ph-card ket`,"aria-label":`Anomalies and suggested actions`,children:[(0,Z.jsxs)(`h4`,{className:`op-ph-card-h`,children:[`Anomalies → suggested action`,f.length>0&&(0,Z.jsxs)(`span`,{className:`op-ph-card-n`,children:[f.length,` open`]})]}),f.length===0?(0,Z.jsx)(`div`,{className:`op-pot-empty`,children:`none — system healthy`}):(0,Z.jsx)(`ul`,{className:`op-pot-list`,children:f.map(e=>(0,Z.jsxs)(`li`,{className:`op-pot-attn sev-${e.severity}`,children:[(0,Z.jsxs)(`span`,{className:`op-pot-attn-text`,children:[(0,Z.jsx)(`b`,{className:`op-pot-attn-subj`,children:e.subject}),` — `,e.detail]}),(0,Z.jsx)(`span`,{className:`op-pot-chip ${en[e.suggestedAction.type]??`obs`}`,children:$t[e.suggestedAction.type]??`OBSERVE`})]},`${e.kind}:${e.subject}`))})]}),(0,Z.jsxs)(`section`,{className:`op-ph-card ket`,"aria-label":`Cross monitor and wake`,children:[(0,Z.jsx)(`h4`,{className:`op-ph-card-h`,children:`Cross-monitor & wake`}),(0,Z.jsxs)(`div`,{className:`op-ph-kv`,children:[(0,Z.jsx)($,{k:`mug alive`,v:i.crossMonitor.queenAlive?`yes`:`DARK`,tone:tn(i.crossMonitor.queenAlive)}),(0,Z.jsx)($,{k:`kettle alive`,v:l?`yes · last run ${Xt(a?.lastRunAt??null)} ago`:`DARK`,tone:tn(l)}),i.wokeBy!=null&&(0,Z.jsx)($,{k:`woke by`,v:i.wokeBy}),(0,Z.jsx)($,{k:`owner steering`,v:i.ownerSteering.pauseNewWork?`new work paused`:`new work allowed`,tone:i.ownerSteering.pauseNewWork?`warn`:`ok`})]})]}),(0,Z.jsxs)(`section`,{className:`op-ph-card ket`,"aria-label":`Observations`,children:[(0,Z.jsxs)(`h4`,{className:`op-ph-card-h`,children:[`Observations`,(0,Z.jsx)(`span`,{className:`op-ph-card-n`,children:`fed to ideation`})]}),i.observations.laneCount===0?(0,Z.jsx)(`div`,{className:`op-pot-empty`,children:`none recorded this window`}):(0,Z.jsxs)(`div`,{className:`op-ph-kv`,children:[(0,Z.jsx)($,{k:`this window`,v:`${i.observations.laneCount} recorded`}),p.map(([e,t])=>(0,Z.jsx)($,{k:e,v:`${t}`},e))]})]})]}),(0,Z.jsxs)(`h3`,{className:`op-ph-sec mug`,children:[(0,Z.jsx)(J,{size:12,strokeWidth:2,"aria-hidden":`true`}),`What the Mug looks at`,(0,Z.jsx)(`span`,{className:`op-ph-sec-d`,children:`work placement`})]}),!r&&(0,Z.jsx)(`div`,{className:`op-pot-empty`,children:`Loading the Mug's brief…`}),r&&(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsxs)(`section`,{className:`op-ph-card mug`,"aria-label":`Ranked frontier`,children:[(0,Z.jsxs)(`h4`,{className:`op-ph-card-h`,children:[`Ranked frontier`,(0,Z.jsxs)(`span`,{className:`op-ph-card-n`,children:[r.frontierTotal,` ready · `,r.frontierBlocked,` blocked · `,r.frontierQuarantined,` quarantined`]})]}),r.frontier.length===0?(0,Z.jsx)(`div`,{className:`op-pot-empty`,children:r.frontierQuarantined>0?`frontier empty — ${r.frontierQuarantined} quarantined by the admission gate`:`no ready work`}):(0,Z.jsx)(`ol`,{className:`op-pot-list op-pot-queue`,children:r.frontier.map(e=>(0,Z.jsxs)(`li`,{className:`op-pot-next`,children:[(0,Z.jsx)(`span`,{className:`op-pot-next-id`,children:e.id}),(0,Z.jsx)(`span`,{className:`op-pot-next-title`,children:e.title})]},e.id))}),u>0&&(0,Z.jsxs)(`div`,{className:`op-pot-foot`,children:[`+`,u,` more in rank order`]})]}),(0,Z.jsxs)(`section`,{className:`op-ph-card mug`,"aria-label":`Cups`,children:[(0,Z.jsxs)(`h4`,{className:`op-ph-card-h`,children:[`Cups`,(0,Z.jsx)(`span`,{className:`op-ph-card-n`,children:`load · liveness · doing`})]}),r.cups.length===0?(0,Z.jsx)(`div`,{className:`op-pot-empty`,children:`no live cups`}):(0,Z.jsx)(`ul`,{className:`op-pot-list op-pot-cups`,children:r.cups.map(e=>{let t=e.doing==null?null:Qt(e.doing);return(0,Z.jsxs)(`li`,{className:`op-pot-cup${e.doing==null?` idle`:``}`,children:[(0,Z.jsx)(`span`,{className:`op-pot-cup-glyph`,"aria-hidden":`true`,children:`☕`}),(0,Z.jsx)(`span`,{className:`op-pot-cup-id`,children:e.id}),(0,Z.jsx)(`span`,{className:`op-pot-cup-doing`,children:t==null?`idle`:(0,Z.jsxs)(Z.Fragment,{children:[t.wi!=null&&(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(`span`,{className:`op-pot-wi`,children:t.wi}),` `]}),t.rest]})}),(0,Z.jsx)(`span`,{className:`op-pot-cup-load`,children:e.load}),(0,Z.jsx)(`span`,{className:`op-pot-dot ${tn(e.alive)}`,"aria-hidden":`true`})]},e.id)})})]}),(0,Z.jsxs)(`section`,{className:`op-ph-card mug`,"aria-label":`Placements and capacity`,children:[(0,Z.jsx)(`h4`,{className:`op-ph-card-h`,children:`Placements & capacity`}),(0,Z.jsxs)(`div`,{className:`op-ph-kv`,children:[(0,Z.jsx)($,{k:`placements`,v:`${r.openPlacements.workingTracked} working · ${r.openPlacements.recovering} recovering · ${r.openPlacements.stranded} stranded`,tone:r.openPlacements.stranded>0?`warn`:`ok`}),r.capacity?(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)($,{k:`inference pool`,v:`${Math.round(r.capacity.factor*100)}% headroom${r.capacity.utilizationPct==null?``:` · ${Math.round(r.capacity.utilizationPct)}% used`}${r.capacity.paused?` · paused`:``}`,tone:r.capacity.paused?`bad`:r.capacity.factor<.25?`warn`:`ok`}),r.capacity.dispatchBudget!=null&&(0,Z.jsx)($,{k:`dispatch budget`,v:`${r.capacity.dispatchBudget} spare cup slots`}),(0,Z.jsx)($,{k:`advice`,v:r.capacity.advice})]}):(0,Z.jsx)($,{k:`inference pool`,v:`no capacity read (gateway unreachable)`,tone:`warn`})]})]}),(0,Z.jsxs)(`section`,{className:`op-ph-card mug`,"aria-label":`Escalations and steering`,children:[(0,Z.jsxs)(`h4`,{className:`op-ph-card-h`,children:[`Escalations & steering`,r.escalations.length>0&&(0,Z.jsxs)(`span`,{className:`op-ph-card-n`,children:[r.escalations.length,` open`]})]}),r.escalations.length===0?(0,Z.jsx)(`div`,{className:`op-pot-empty`,children:`no open escalations`}):(0,Z.jsx)(`ul`,{className:`op-pot-list`,children:r.escalations.map(e=>(0,Z.jsxs)(`li`,{className:`op-pot-attn sev-${e.severity===`critical`?`critical`:`warning`}`,children:[(0,Z.jsxs)(`span`,{className:`op-pot-attn-text`,children:[(0,Z.jsx)(`b`,{className:`op-pot-attn-subj`,children:e.id}),` — `,e.summary]}),(0,Z.jsx)(`span`,{className:`op-pot-chip esc`,children:`OWNER`})]},e.id))}),(0,Z.jsxs)(`div`,{className:`op-pot-steering op-ph-steering`,children:[r.steering?(0,Z.jsxs)(Z.Fragment,{children:[r.steering.directive&&(0,Z.jsxs)(`div`,{className:`op-pot-directive`,children:[`“`,r.steering.directive,`”`]}),(0,Z.jsxs)(`div`,{className:`op-pot-steer-facts`,children:[(0,Z.jsxs)(`span`,{children:[`New work: `,(0,Z.jsx)(`b`,{children:r.steering.pauseNewWork?`paused`:`allowed`})]}),r.steering.eligiblePlans.length>0&&(0,Z.jsxs)(`span`,{children:[`Eligible: `,r.steering.eligiblePlans.join(`, `)]})]})]}):(0,Z.jsx)(`div`,{className:`op-pot-empty`,children:`un-steered — the Mug places by rank`}),r.carryNote&&(0,Z.jsxs)(`div`,{className:`op-ph-carry`,title:`written ${Xt(r.carryNote.at)} ago`,children:[`carry-note: `,r.carryNote.note]})]})]})]})]})]})}var rn=Symbol.for(`papercusp.askUserLocalRegistry`);function an(){let e=globalThis;return e[rn]||(e[rn]={listeners:new Set}),e[rn]}function on(e){return an().listeners.add(e),()=>{an().listeners.delete(e)}}function sn(){let[e,t]=(0,X.useState)([]);if((0,X.useEffect)(()=>on(e=>{t(t=>[...t,e])}),[]),e.length===0)return null;let n=e[0],r=e.length-1,i=n.spec,a=i.prompt??``,o=i.presentation,s=i.fallbackText,c=i.allowDecline??!0,l=e=>{n.resolve(e),t(e=>e.slice(1))},u;if(o&&(o.kind===`radio`||o.kind===`checkbox`)){let e={question:a,options:o.options.map(e=>({id:e.id,label:e.label,hint:e.hint,style:e.style})),multi:o.kind===`checkbox`,report:i.report};u=(0,Z.jsx)(Ee,{args:e,onResponse:e=>{e.action===`submit`?l({action:`submit`,payload:{picks:e.picks.map(e=>e.option_id)}}):e.action===`decline`?l({action:`decline`,reason:e.reason}):l({action:`cancel`})},allowDecline:c})}else u=o&&(o.kind===`text`||o.kind===`date`||o.kind===`slider`)?(0,Z.jsx)(De,{prompt:a,presentation:o,fallbackText:s,allowDecline:c,onResponse:e=>{e.action===`submit`?l({action:`submit`,payload:{value:e.value}}):l({action:`decline`,reason:e.reason})}}):(0,Z.jsxs)(`div`,{className:`local-card-host-fallback`,role:`status`,children:[(0,Z.jsx)(`p`,{children:a||s||`No renderer available`}),(0,Z.jsx)(`button`,{type:`button`,onClick:()=>l({action:`cancel`}),"aria-label":`Dismiss`,children:`Dismiss`})]});return(0,Z.jsxs)(`div`,{className:`local-card-host`,"data-remaining":r,children:[u,r>0&&(0,Z.jsxs)(`p`,{className:`local-card-host-queue`,"aria-live":`polite`,children:[r,` more `,r===1?`card`:`cards`,` after this`]})]})}function cn({title:e,subtitle:t,className:n,titleClassName:r,subtitleClassName:i,leading:a}){let o=K(),s=e??(o===`the-hive`?`The Swarm`:`Papercusp`),c=t??(o===`the-hive`?`Hive console`:`mission console`);return(0,Z.jsxs)(`span`,{className:n?`operator-wordmark ${n}`:`operator-wordmark`,children:[a,(0,Z.jsxs)(`span`,{className:`operator-wordmark__copy`,children:[(0,Z.jsx)(`span`,{className:r?`operator-wordmark__title ${r}`:`operator-wordmark__title`,children:s}),c?(0,Z.jsx)(`span`,{className:i?`operator-wordmark__subtitle ${i}`:`operator-wordmark__subtitle`,children:c}):null]})]})}N();var ln=`papercusp:operatorMode`,un=`papercusp:operatorSleep`;function dn(){let[e,t]=(0,X.useState)(`active`);return(0,X.useEffect)(()=>{let e=j()??`active`;t(e),F(e);let n=e=>{let n=e.detail;(n?.mode===`active`||n?.mode===`passive`)&&t(n.mode)};return window.addEventListener(ln,n),()=>window.removeEventListener(ln,n)},[]),[e,(0,X.useCallback)(e=>{if(F(e),e===`active`){E(0);try{window.dispatchEvent(new Event(un))}catch{}}t(e);try{window.dispatchEvent(new CustomEvent(ln,{detail:{mode:e}}))}catch{}},[])]}function fn(){let[e,t]=(0,X.useState)(0);return(0,X.useEffect)(()=>{let e=()=>t(P());e(),window.addEventListener(un,e);let n=setInterval(e,5e3);return()=>{window.removeEventListener(un,e),clearInterval(n)}},[]),e}var pn=`papercusp:operatorSub`;function mn(){let[e,t]=(0,X.useState)(`ready`);return(0,X.useEffect)(()=>{let e=e=>{let n=e.detail;typeof n?.sub==`string`&&t(n.sub)};return window.addEventListener(pn,e),()=>window.removeEventListener(pn,e)},[]),e}function hn(){let[e,t]=(0,X.useState)(()=>x().silenceVoice??!1);return(0,X.useEffect)(()=>b(e=>t(e.silenceVoice??!1)),[]),[e,(0,X.useCallback)(e=>{t(e),typeof fetch==`function`&&fetch(`/api/user/preferences`,{method:`PATCH`,headers:{"content-type":`application/json`},body:JSON.stringify({silenceVoice:e})}).catch(()=>{})},[])]}function gn(){let[e,t]=dn(),[n,r]=hn(),i=fn(),a=mn(),o=q()(`operator`),s=n,c=!s&&e===`active`,l=i>0?i-Date.now():0,u=c&&l>0,d=c&&!u&&a===`quiet_wait`,f=(0,X.useCallback)(()=>{if(s){r(!1),t(`active`);return}if(u){E(0);try{window.dispatchEvent(new Event(un))}catch{}return}if(!d){if(c){t(`passive`);return}r(!0)}},[s,c,u,d,t,r]),p=u?l<6e4?`${Math.max(1,Math.ceil(l/1e3))}s`:`${Math.ceil(l/6e4)}m`:``,m=s?`off`:u?`sleeping`:d?`quiet`:c?`active`:`passive`,h=s?`Off`:u?`Sleeping ${p}`:d?`Quiet`:c?`Active`:`Passive`,g=s?`${o} is off — voice muted. Click to turn on (active).`:u?`${o} sleeping for ${p}. Click to wake.`:d?`${o} is quiet — type to pick up where you left off.`:c?`${o} interaction mode: active. Click to set passive.`:`${o} interaction mode: passive. Click to turn off.`,_=s?`${o} is off — ${o} voice is muted. Click to turn it back on.`:u?`${o} went quiet for ${p} (via <sleep> tag). Click to wake immediately.`:d?`${o} went silent after the silence ladder ran out. Type to wake it.`:c?`${o} is active — speaks proactively. Click to make passive.`:`${o} is passive — only responds when spoken to. Click to turn it off (mute).`,v=s||u||d?`static`:c?`pulsing`:`static`;return(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(`style`,{children:_n}),(0,Z.jsx)(G,{label:_,children:(0,Z.jsxs)(`button`,{type:`button`,onClick:f,className:`op-active-toggle op-active-toggle--${m}`,"aria-label":g,children:[(0,Z.jsx)(`span`,{className:`op-active-toggle-dot op-active-toggle-dot--${v}`,"aria-hidden":`true`}),(0,Z.jsx)(`span`,{className:`op-active-toggle-label`,children:h})]})})]})}var _n=`
.op-active-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 80%));
  color: var(--fg-mute, #94a3b8);
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.op-active-toggle:hover {
  background: color-mix(in srgb, var(--accent-strong), transparent 90%);
  color: var(--fg, #e7eef7);
}
.op-active-toggle--active {
  background: color-mix(in srgb, var(--accent), transparent 86%);
  border-color: color-mix(in srgb, var(--accent), transparent 50%);
  color: var(--accent-strong, #7dd3fc);
}
.op-active-toggle--passive {
  /* default look */
}
.op-active-toggle--sleeping {
  background: rgba(148, 163, 184, 0.10);
  border-color: rgba(148, 163, 184, 0.40);
  color: var(--fg-mute, #94a3b8);
  font-style: italic;
}
.op-active-toggle--quiet {
  background: rgba(148, 163, 184, 0.06);
  border-color: rgba(148, 163, 184, 0.30);
  color: var(--fg-mute, #94a3b8);
  cursor: default;
}
.op-active-toggle--off {
  background: rgba(148, 163, 184, 0.10);
  border-color: rgba(148, 163, 184, 0.40);
  color: var(--fg-mute, #94a3b8);
}

.op-active-toggle-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: currentColor;
}
.op-active-toggle-dot--pulsing {
  animation: op-active-pulse 1.25s ease-in-out infinite;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent), transparent 40%);
}
@keyframes op-active-pulse {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent), transparent 45%); transform: scale(1); }
  60%  { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent), transparent 100%);  transform: scale(1.06); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent), transparent 100%);    transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .op-active-toggle-dot--pulsing { animation: none; }
}
`,vn=.08,yn=.04;function bn(e,t,n){let r=(0,X.useRef)(null),i=(0,X.useRef)(null),a=(0,X.useRef)(null),o=(0,X.useRef)(null);return(0,X.useEffect)(()=>{if(r.current&&r.current.style.setProperty(`--mic-level`,`0`),!e||typeof window>`u`||!navigator.mediaDevices?.getUserMedia)return;let s=!1;return(async()=>{try{let e=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,channelCount:1}});if(s){e.getTracks().forEach(e=>e.stop());return}n?.(null),o.current=e;let c=window.AudioContext||window.webkitAudioContext;if(!c)return;let l=new c;if(a.current=l,l.state===`suspended`)try{await l.resume()}catch{}if(s){e.getTracks().forEach(e=>e.stop());try{await l.close()}catch{}return}let u=l.createMediaStreamSource(e),d=l.createAnalyser();d.fftSize=512,d.smoothingTimeConstant=.4,u.connect(d);let f=new Uint8Array(d.fftSize),p=0,m=-1,h=!1,g=e=>{if(e-p>=50){p=e,d.getByteTimeDomainData(f);let n=0;for(let e=0;e<f.length;e++){let t=(f[e]-128)/128;n+=t*t}let i=Math.sqrt(n/f.length),a=Math.min(1,Math.max(0,(i-.02)*6));Math.abs(a-m)>=.01&&(m=a,r.current&&r.current.style.setProperty(`--mic-level`,a.toFixed(2))),!h&&a>=vn?(h=!0,t?.(!0)):h&&a<=yn&&(h=!1,t?.(!1))}i.current=requestAnimationFrame(g)};i.current=requestAnimationFrame(g)}catch(e){s||n?.(e)}})(),()=>{s=!0,i.current&&cancelAnimationFrame(i.current),i.current=null;try{a.current?.close()}catch{}a.current=null,o.current?.getTracks().forEach(e=>e.stop()),o.current=null,r.current&&r.current.style.setProperty(`--mic-level`,`0`),t?.(!1)}},[e,t,n]),{ref:r}}var xn={off:`🚫`,connecting:`⏳`,idle:`🎤`,listening:`🔴`,speaking:`🔊`,paused:`⏸`},Sn={off:`push-to-talk`,"push-to-talk":`always-on`,"always-on":`off`},Cn={off:`Off`,"push-to-talk":`PTT`,"always-on":`On`},wn={off:`off`,"push-to-talk":`push-to-talk`,"always-on":`always-on`},Tn=`pc-voice-wake-hint-seen-v1`,En=`pc-voice-ptt-hint-seen-v1`,Dn=`Backquote`,On="`",kn=`/settings/setup-wizard?step=os-permissions`;function An(e){return e instanceof Element?!!e.closest(`.cm-editor, .monaco-editor, .xterm, .xterm-screen`):!1}function jn({label:e}){return(0,Z.jsx)(`span`,{className:`pc-voice-spinner`,role:`status`,"aria-label":e})}function Mn({hearing:e}){return(0,Z.jsxs)(`span`,{className:`pc-voice-listening${e?` is-hearing`:``}`,role:`status`,"aria-label":e?`Hearing you`:`Listening`,children:[(0,Z.jsx)(`i`,{}),(0,Z.jsx)(`i`,{}),(0,Z.jsx)(`i`,{})]})}function Nn(){return(0,Z.jsx)(`span`,{className:`pc-voice-speaking`,role:`status`,"aria-label":`Speaking`})}function Pn(){return(0,Z.jsxs)(`span`,{className:`pc-voice-thinking`,role:`status`,"aria-label":`Thinking`,children:[(0,Z.jsx)(`i`,{}),(0,Z.jsx)(`i`,{}),(0,Z.jsx)(`i`,{})]})}function Fn(){let[e,t]=(0,X.useState)(()=>ae()),[n,r]=(0,X.useState)(()=>U()),[i,a]=(0,X.useState)(()=>V().wakeWord),[o,s]=(0,X.useState)(()=>typeof window>`u`?!1:window.localStorage.getItem(v(Tn))===`1`),[c,l]=(0,X.useState)(()=>typeof window>`u`?!1:window.localStorage.getItem(v(En))===`1`),[u,d]=(0,X.useState)(!1);(0,X.useEffect)(()=>(se(),ie(t)),[]),(0,X.useEffect)(()=>{let e=()=>r(U());e();let t=()=>e();return window.addEventListener(`papercusp:operatorVoiceSessionStateChanged`,t),()=>{window.removeEventListener(`papercusp:operatorVoiceSessionStateChanged`,t)}},[]),(0,X.useEffect)(()=>{let e=e=>{let t=e.detail;if(t?.message){if(t.phase===`no-audio`){f.error(t.message,{action:{label:`Mic permissions`,onClick:()=>W(kn)}});return}f.warning(t.message)}};return window.addEventListener(`papercusp:voiceTimeout`,e),()=>window.removeEventListener(`papercusp:voiceTimeout`,e)},[]),(0,X.useEffect)(()=>{let e=()=>a(V().wakeWord);return e(),window.addEventListener(`pc-voice-config-changed`,e),window.addEventListener(`focus`,e),()=>{window.removeEventListener(`pc-voice-config-changed`,e),window.removeEventListener(`focus`,e)}},[]);let p=(0,X.useCallback)(()=>{if(!o&&(s(!0),typeof window<`u`))try{window.localStorage.setItem(v(Tn),`1`)}catch{}},[o]),m=(0,X.useCallback)(()=>{if(!c&&(l(!0),typeof window<`u`))try{window.localStorage.setItem(v(En),`1`)}catch{}},[c]),h=n.active&&n.mode===`push-to-talk`,g=(0,X.useCallback)(()=>{if(!e.supported){f.error(`Voice mode is not available in this environment.`);return}e.mode===`always-on`&&p(),te(Sn[e.mode])},[p,e.mode,e.supported]),_=(0,X.useRef)(null),y=(0,X.useCallback)(()=>{e.supported&&(_.current&&clearTimeout(_.current),_.current=setTimeout(()=>{_.current=null,d(!0),h?L(!0):z()},250))},[h,e.supported]),b=(0,X.useCallback)(()=>{if(_.current){clearTimeout(_.current),_.current=null;return}u&&(d(!1),h?L(!1):re())},[h,u]);(0,X.useEffect)(()=>{if(!e.supported)return;let t=e=>{e.code===Dn&&(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||An(e.target)||(e.preventDefault(),!e.repeat&&(m(),!u&&(d(!0),h?L(!0):z()))))},n=e=>{e.code===Dn&&u&&(e.preventDefault(),d(!1),h?L(!1):re())},r=()=>{u&&(d(!1),h?L(!1):re())};return window.addEventListener(`keydown`,t),window.addEventListener(`keyup`,n),window.addEventListener(`blur`,r),()=>{window.removeEventListener(`keydown`,t),window.removeEventListener(`keyup`,n),window.removeEventListener(`blur`,r)}},[h,m,u,e.supported]);let x=e.mode===`always-on`||e.status===`listening`||u,{ref:S}=bn((u||x&&!e.micOwnedByFullAgent)&&e.status!==`connecting`,I,le),C;C=e.supported?e.status===`speaking`?(0,Z.jsx)(Nn,{}):e.awaitingResponse?(0,Z.jsx)(Pn,{}):e.processingTranscript?(0,Z.jsx)(jn,{label:`Processing`}):u||e.audioReceiving?(0,Z.jsx)(Mn,{hearing:e.audioReceiving}):e.status===`connecting`?(0,Z.jsx)(jn,{label:`Connecting`}):(0,Z.jsx)(`span`,{className:`pc-voice-btn-label`,children:Cn[e.mode]}):(0,Z.jsx)(`span`,{className:`pc-voice-btn-label`,children:`No mic`});let w=e.wakeListening||e.micOwnedByFullAgent,T=e.status===`connecting`?`Voice mode: connecting to agent (waiting for WebRTC negotiation)…`:e.supported?n.active?`Voice mode: ${wn[e.mode]} (shared session live; hold button or ${On} for PTT, use mute/mode/host controls alongside)`:e.mode===`always-on`&&!w?`Voice mode: always-on, but wake listening is unavailable here — hold the button or ${On} to talk`:`Voice mode: ${wn[e.mode]} (click to cycle, hold button for PTT, hold ${On} for keyboard PTT)`:`Voice mode unsupported in this browser`,E=e.status===`connecting`&&e.supported,D=!E&&e.mode===`always-on`&&e.supported&&w,O=!E&&e.supported&&(e.mode===`push-to-talk`||e.mode===`always-on`&&!w);return(0,Z.jsxs)(`div`,{className:`pc-voice-control${D||O?` has-wake-hint`:``}${E?` is-connecting`:``}`,children:[(0,Z.jsx)(G,{label:T,children:(0,Z.jsxs)(`button`,{type:`button`,"aria-label":`Voice mode`,onClick:g,onMouseDown:y,onMouseUp:b,onMouseLeave:b,onTouchStart:y,onTouchEnd:b,ref:S,className:`pc-voice-btn pc-voice-btn--mode-${e.mode} pc-voice-btn--status-${e.status}${u?` is-held`:``}${e.supported?``:` is-unsupported`}${x?` is-mic-active`:``}${e.wakeDetected?` is-wake-detected`:``}${e.userSpoke?` is-user-spoke`:``}${e.audioReceiving?` is-receiving-audio`:``}${e.processingTranscript?` is-processing-transcript`:``}${e.awaitingResponse?` is-awaiting-response`:``}`,children:[(0,Z.jsxs)(`span`,{className:`pc-voice-btn-orb`,"aria-hidden":`true`,children:[(0,Z.jsx)(`span`,{className:`pc-voice-btn-level`,"aria-hidden":`true`}),(0,Z.jsx)(`span`,{className:`pc-voice-btn-icon`,children:xn[e.status]})]}),C]})}),(0,Z.jsx)(G,{label:`Open microphone settings`,children:(0,Z.jsx)(`a`,{href:`/settings/voice`,className:`pc-voice-settings-link`,"aria-label":`Microphone settings`,onClick:e=>{e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||(e.preventDefault(),W(`/settings/voice`))},children:(0,Z.jsx)(Ce,{size:14,"aria-hidden":`true`})})}),n.active&&(0,Z.jsxs)(`div`,{className:`pc-voice-session-controls`,"aria-label":`Shared voice session controls`,children:[(0,Z.jsx)(`button`,{type:`button`,className:`pc-voice-session-btn${n.muted?` is-active`:``}`,"aria-pressed":n.muted,"aria-label":n.muted?`Unmute shared voice session`:`Mute shared voice session`,onClick:()=>{R()},children:n.muted?`Muted`:`Mute`}),(0,Z.jsx)(`button`,{type:`button`,className:`pc-voice-session-btn${n.mode===`always-on`?` is-active`:``}`,"aria-pressed":n.mode===`always-on`,"aria-label":`Shared voice mode: ${n.mode===`push-to-talk`?`push-to-talk`:`always-on`}. Toggle mode.`,onClick:()=>{ne()},children:n.mode===`push-to-talk`?`PTT`:`Live`}),(0,Z.jsx)(`button`,{type:`button`,className:`pc-voice-session-btn`,"aria-label":n.elected?`This surface is already the shared voice host/player`:`Force this surface to become the shared voice host/player`,disabled:n.elected,onClick:()=>{n.elected||ce()},children:n.elected?`Host`:`Take host`})]}),(D||O)&&(0,Z.jsx)(`div`,{className:`pc-voice-wake-hint`,"aria-live":`polite`,children:D?(0,Z.jsxs)(Z.Fragment,{children:[`Say `,(0,Z.jsx)(`strong`,{children:i})]}):(0,Z.jsxs)(Z.Fragment,{children:[`Hold `,(0,Z.jsx)(`strong`,{children:On}),` to talk`]})})]})}var In=`pc:audienceMode`;async function Ln(e){try{localStorage.setItem(v(In),e)}catch{}try{let t=await fetch(`/api/agent-mcp/operator-voice-prefs`,{method:`PUT`,headers:{"content-type":`application/json`},body:JSON.stringify({audienceMode:e})});t.ok&&y(await t.json())}catch{}}function Rn(){let[e,t]=(0,X.useState)(`engineer`);(0,X.useEffect)(()=>{t(x().audienceMode??`engineer`);let e=b(e=>{t(e.audienceMode??`engineer`)}),n=e=>{e.key===v(In)&&(e.newValue===`engineer`||e.newValue===`novice`)&&t(e.newValue)};return window.addEventListener(`storage`,n),()=>{e(),window.removeEventListener(`storage`,n)}},[]);let n=(0,X.useCallback)(e=>{t(e),Ln(e)},[]);return(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(`style`,{children:zn}),(0,Z.jsxs)(`div`,{className:`audience-mode-selector`,role:`group`,"aria-label":`Audience mode`,children:[(0,Z.jsx)(G,{label:`Engineer mode — peer-level, terse, full technical vocabulary`,children:(0,Z.jsx)(`button`,{type:`button`,className:`audience-mode-btn${e===`engineer`?` audience-mode-btn--active`:``}`,onClick:()=>n(`engineer`),"aria-pressed":e===`engineer`,"aria-label":`Engineer`,children:(0,Z.jsx)(we,{size:14,"aria-hidden":`true`})})}),(0,Z.jsx)(G,{label:`Novice mode — plain language, outcome-first, no implementation questions`,children:(0,Z.jsx)(`button`,{type:`button`,className:`audience-mode-btn${e===`novice`?` audience-mode-btn--active`:``}`,onClick:()=>n(`novice`),"aria-pressed":e===`novice`,"aria-label":`Novice`,children:(0,Z.jsx)(xe,{size:14,"aria-hidden":`true`})})})]})]})}var zn=`
.audience-mode-selector {
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 80%));
  overflow: hidden;
  flex-shrink: 0;
}
.audience-mode-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 9px;
  background: transparent;
  border: none;
  color: var(--fg-mute, #94a3b8);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
  line-height: 0;
}
.audience-mode-btn + .audience-mode-btn {
  border-left: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 80%));
}
.audience-mode-btn:hover {
  background: color-mix(in srgb, var(--accent-strong), transparent 92%);
  color: var(--fg, #e7eef7);
}
.audience-mode-btn--active {
  background: color-mix(in srgb, var(--accent), transparent 86%);
  color: var(--accent-strong, #7dd3fc);
}
`,Bn=`chat`;function Vn(e){return Math.max(56,Math.floor(e*.75))}function Hn(e,t){return Number.isFinite(e)?Math.max(56,Math.min(Vn(t),e)):360}var Un=`papercusp.operatorChat.width`,Wn=[`chat`,`pot`];function Gn(){let[e,t]=(0,X.useState)(!1);return(0,X.useEffect)(()=>{t(H());let e=e=>{let n=e.detail;t(typeof n?.muted==`boolean`?n.muted:H())};return window.addEventListener(`papercusp:voiceOutputMutedChanged`,e),()=>window.removeEventListener(`papercusp:voiceOutputMutedChanged`,e)},[]),(0,Z.jsx)(G,{label:e?`Voice replies muted — click to hear Papercup answer your spoken turns aloud`:`Papercup speaks its replies when you talk by voice — click to mute (typed chat stays silent)`,children:(0,Z.jsx)(`button`,{type:`button`,className:`op-chat-tts${e?` is-muted`:``}`,onClick:()=>{let n=!e;t(n),B(n)},"aria-pressed":!e,"aria-label":e?`Unmute spoken voice replies`:`Mute spoken voice replies`,children:e?(0,Z.jsx)(It,{size:14,"aria-hidden":`true`}):(0,Z.jsx)(Ft,{size:14,"aria-hidden":`true`})})})}function Kn(){if(typeof window>`u`)return 360;try{let e=window.localStorage.getItem(v(Un));return e?Hn(Number(e),window.innerWidth):360}catch{return 360}}function qn(){let e=K()===`the-hive`?void 0:`Papercup`,[t,n]=p(Bn,h.withDefault(!0)),[r,i]=(0,X.useState)(360),[a,o]=(0,X.useState)(!1);(0,X.useEffect)(()=>{i(Kn()),o(!0)},[]),(0,X.useEffect)(()=>{me({field:`op_chat_width`,parse:e=>typeof e==`number`&&Number.isFinite(e)?e:null,current:Kn,adopt:e=>{let t=Hn(e,window.innerWidth);try{window.localStorage.setItem(v(Un),String(t))}catch{}i(t)}})},[]),(0,X.useEffect)(()=>{if(!a)return;let e=t?r:56;document.documentElement.style.setProperty(`--op-chat-w`,`${e}px`),document.body.classList.add(`has-op-chat`),document.body.classList.toggle(`op-chat-collapsed`,!t);try{window.localStorage.setItem(v(Un),String(r))}catch{}return()=>{}},[t,a,r]),(0,X.useEffect)(()=>{if(!a)return;let e=()=>{i(e=>Hn(e,window.innerWidth))};return window.addEventListener(`resize`,e),()=>window.removeEventListener(`resize`,e)},[a]),(0,X.useEffect)(()=>()=>{try{document.body.classList.remove(`has-op-chat`),document.body.classList.remove(`op-chat-collapsed`),document.documentElement.style.removeProperty(`--op-chat-w`)}catch{}},[]);let s=(0,X.useRef)(!1),c=(0,X.useCallback)(e=>{s.current=!0,e.target.setPointerCapture?.(e.pointerId),document.body.style.userSelect=`none`,document.body.style.cursor=`col-resize`},[]),l=(0,X.useCallback)(e=>{s.current&&i(Hn(e.clientX,window.innerWidth))},[]),u=(0,X.useCallback)(e=>{s.current=!1,e.target.releasePointerCapture?.(e.pointerId),document.body.style.userSelect=``,document.body.style.cursor=``;try{pe(`op_chat_width`,Hn(e.clientX,window.innerWidth))}catch{}},[]),d=(0,X.useCallback)(()=>{n(!1)},[n]),f=(0,X.useCallback)(()=>{n(!0)},[n]),g=Nt(),_=ue();he(`operator.generateIdeas`,()=>{g.generateIdeas()});let y=a?t?r:56:360,b=(0,X.useMemo)(()=>({width:y}),[y]),x;x=g.busy?`thinking`:g.mode===`passive`?`quiet until asked`:`ready`;let[S,C]=p(`opcv`,m([...Wn]).withDefault(`chat`)),w=S===`pot`;return(0,Z.jsxs)(`aside`,{className:`op-chat-sidebar`,style:b,"aria-label":`Papercup chat`,"data-collapsed":t?`false`:`true`,children:[(0,Z.jsx)(`style`,{children:Jn}),(0,Z.jsx)(G,{label:`Expand Papercup chat`,children:(0,Z.jsxs)(`button`,{type:`button`,className:`op-chat-expand-rail`,onClick:f,"aria-label":`Expand Papercup chat`,"aria-hidden":t,children:[(0,Z.jsx)(`span`,{className:`op-chat-expand-orb`,"aria-hidden":`true`,children:(0,Z.jsx)(Gt,{className:`op-chat-expand-logo`})}),(0,Z.jsx)(`span`,{className:`op-chat-expand-label`,children:`Chat`}),(0,Z.jsx)(ye,{className:`op-chat-expand-chevron`,strokeWidth:1.9,"aria-hidden":`true`})]})}),(0,Z.jsxs)(`div`,{className:`op-chat-expanded-shell`,"aria-hidden":!t,children:[(0,Z.jsx)(`div`,{className:`op-chat-header`,children:(0,Z.jsxs)(`div`,{className:`op-chat-header-main`,children:[(0,Z.jsx)(G,{label:w?`Back to Papercup chat`:`Papercup chat`,children:(0,Z.jsxs)(`button`,{type:`button`,className:`op-chat-papercup-toggle${w?``:` is-on`}`,onClick:()=>void C(`chat`),"aria-pressed":!w,"aria-label":`Papercup chat`,children:[(0,Z.jsx)(`span`,{className:`op-chat-papercup-mark`,"aria-hidden":`true`,children:(0,Z.jsx)(Gt,{className:`op-chat-papercup-logo`})}),(0,Z.jsx)(cn,{className:`op-chat-wordmark`,titleClassName:`op-chat-wordmark-title`,subtitleClassName:`op-chat-wordmark-subtitle`,title:e,subtitle:``})]})}),(0,Z.jsx)(G,{label:w?`Back to chat`:`Pot health — see what the Kettle and Mug look at`,children:(0,Z.jsxs)(`button`,{type:`button`,className:`op-chat-pot-toggle${w?` is-on`:``}`,onClick:()=>void C(w?`chat`:`pot`),"aria-pressed":w,"aria-label":w?`Back to chat`:`Show pot health`,children:[(0,Z.jsx)(`span`,{"aria-hidden":`true`,children:`🫖`}),(0,Z.jsx)(`span`,{className:`op-chat-pot-toggle-label`,children:`Pot Health`})]})}),(0,Z.jsxs)(`div`,{className:`op-chat-controls`,role:`group`,"aria-label":`Papercup voice controls — ${x}`,children:[(0,Z.jsx)(Rn,{}),(0,Z.jsx)(gn,{}),(0,Z.jsx)(Fn,{}),(0,Z.jsx)(Gn,{})]}),(0,Z.jsx)(G,{label:`Collapse Papercup chat`,children:(0,Z.jsx)(`button`,{type:`button`,className:`op-chat-toggle`,onClick:d,"aria-label":`Collapse Papercup chat`,children:(0,Z.jsx)(ve,{strokeWidth:1.9,"aria-hidden":`true`})})})]})}),w?(0,Z.jsx)(nn,{}):(0,Z.jsx)(qt,{messages:g.messages,busy:g.busy,peerBusy:g.peerBusy,passive:g.mode===`passive`,onSend:g.sendUserMessage,onGenerateIdeas:g.generateIdeas,banner:g.bannerText?(0,Z.jsx)(`div`,{className:`op-chat-banner`,children:g.bannerText}):null,error:g.error,onLoadEarlier:g.loadEarlier,hasMoreEarlier:g.hasMoreEarlier,loadingEarlier:g.loadingEarlier,onAnswerChoice:g.answerChoice,conversationId:g.conversationId??void 0,workspaceId:_}),(0,Z.jsx)(sn,{})]}),(0,Z.jsx)(`div`,{className:`op-chat-resize-handle`,role:`separator`,"aria-orientation":`vertical`,"aria-label":`Resize Papercup chat`,onPointerDown:c,onPointerMove:l,onPointerUp:u,onPointerCancel:u})]})}var Jn=`
.op-chat-sidebar {
  position: fixed;
  /* Sit BELOW the dev env-switcher bar (WI-4729: the header orb was clipped
     under it). The operator-vite EnvSwitcherBar publishes its measured height
     as --pc-env-bar-h on the root element while shown; the 0px fallback keeps
     the sidebar flush to the top everywhere else — same convention as
     .pclsb/.pcdar and .pc-header. */
  top: var(--pc-env-bar-h, 0px);
  left: 0;
  bottom: 0;
  /* Above .operator-panel (z-index 1200) so the Deck scrim + backdrop-filter
     don't dim/blur the chat when the Deck panel is open. */
  z-index: 1300;
  border-right: 1px solid color-mix(in srgb, var(--accent-strong), transparent 82%);
  background:
    radial-gradient(circle at 50% -12%, color-mix(in srgb, var(--accent), transparent 84%), transparent 34%),
    linear-gradient(180deg, var(--bg) 0%, var(--bg-deeper) 100%);
  color: var(--fg, #e7eef7);
  display: flex;
  flex-direction: column;
  box-shadow: inset -1px 0 0 rgba(255,255,255,0.03), 18px 0 44px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  /* Width set inline via style. */
}
.op-chat-expanded-shell {
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}

.op-chat-expand-rail {
  position: relative;
  z-index: 3;
  display: none;
  width: 100%;
  height: 100%;
  padding: 12px 8px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  align-items: center;
  justify-content: flex-start;
  flex-direction: column;
  gap: 12px;
  cursor: pointer;
}

.op-chat-expand-orb {
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 76%);
  background: radial-gradient(circle at 35% 25%, rgba(255,255,255,0.18), transparent 24%), color-mix(in srgb, var(--accent), transparent 88%);
  color: var(--accent-strong, var(--accent-soft));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 28px color-mix(in srgb, var(--bg-deeper), transparent 76%);
}

.op-chat-expand-logo {
  width: 30px;
  height: 30px;
}

.op-chat-expand-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0;
  color: color-mix(in srgb, var(--fg), transparent 14%);
}

.op-chat-expand-chevron {
  width: 18px;
  height: 18px;
  color: var(--accent-soft);
}

.op-chat-sidebar[data-collapsed="true"] .op-chat-expanded-shell {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.op-chat-sidebar[data-collapsed="true"] .op-chat-expand-rail {
  display: flex;
}

.op-chat-sidebar[data-collapsed="true"] .op-chat-resize-handle {
  display: none;
}

.op-chat-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 10px 12px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--accent-strong), transparent 86%);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-popover), transparent 16%), color-mix(in srgb, var(--bg), transparent 6%)),
    var(--bg);
}

.op-chat-header-main {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

/* WI-4738 one-line header: the wordmark yields (truncates) before the
   controls do, so the row never wraps at narrow sidebar widths. */
.op-chat-header-main .op-chat-wordmark {
  flex: 0 1 auto;
  min-width: 0;
}

.op-chat-header-main .op-chat-wordmark-title {
  font-size: 14px;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.op-chat-toggle {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 78%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-1), transparent 6%);
  color: #eef8ff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
  cursor: pointer;
}

.op-chat-toggle svg {
  width: 16px;
  height: 16px;
}

.op-chat-expand-rail:hover,
.op-chat-toggle:hover {
  background: color-mix(in srgb, var(--bg-popover), transparent 2%);
  border-color: color-mix(in srgb, var(--accent-strong), transparent 66%);
}

.op-chat-expand-rail:focus-visible,
.op-chat-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-strong), transparent 18%);
  outline-offset: 2px;
}

.op-chat-controls {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: visible;
  /* WI-4738: right-align the control cluster on the single header row. */
  margin-left: auto;
  flex: 0 0 auto;
  flex-wrap: nowrap;
}

.op-chat-controls .op-active-toggle {
  flex: 0 0 auto;
  min-height: 26px;
  padding: 3px 7px;
  font-size: 10px;
  letter-spacing: 0;
}

.op-chat-controls .pc-voice-control {
  position: relative;
  /* WI-4738: natural size — the old flex:1 stretched the voice button across
     the whole row, which is exactly the "gigantic mic" the owner flagged. */
  flex: 0 0 auto;
  min-width: 0;
  gap: 4px;
  margin-left: 0;
  overflow: visible;
}

.op-chat-controls .pc-voice-btn {
  flex: 0 0 auto;
  justify-content: center;
  min-width: 0;
  min-height: 26px;
  padding: 3px 7px 3px 6px;
  gap: 5px;
}

/* WI-4778/WI-4789: the 🫖 pot-health toggle — flat control (design docs §
   buttons: 1px border, tinted fill, no shadow/gradient/lift), lit accent
   while the pot view is on. Docked immediately AFTER the Papercup orb + name
   (owner ask 2026-07-14) and carrying its own "Pot Health" label so the
   pane's two faces read as peers: [🥤 Papercup] [🫖 Pot Health]. */
.op-chat-header-main .op-chat-papercup-toggle,
.op-chat-header-main .op-chat-pot-toggle {
  flex: 0 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 26px;
  padding: 0 8px 0 6px;
  border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 74%);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-1), transparent 4%);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

/* WI-4793: the Papercup toggle's leading glyph — the brand mark inline at the
   🫖 peer's scale, with NO orb box / gradient / glow (the 🫖 side is a plain
   text emoji), so the two pills read as a matched pair. */
.op-chat-header-main .op-chat-papercup-mark {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.op-chat-header-main .op-chat-papercup-logo {
  width: 18px;
  height: 18px;
}

/* The label besides the glyph — the wordmark-title treatment, one step
   smaller so the Papercup identity stays the header's lead. Truncates before
   the voice controls do at narrow widths. */
.op-chat-header-main .op-chat-pot-toggle-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 640;
  color: var(--fg-dim);
}

.op-chat-header-main .op-chat-pot-toggle:hover .op-chat-pot-toggle-label,
.op-chat-header-main .op-chat-pot-toggle.is-on .op-chat-pot-toggle-label {
  color: var(--fg);
}

.op-chat-header-main .op-chat-papercup-toggle.is-on,
.op-chat-header-main .op-chat-pot-toggle.is-on {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 30%);
  background: color-mix(in srgb, var(--accent), transparent 82%);
}

.op-chat-header-main .op-chat-papercup-toggle:hover,
.op-chat-header-main .op-chat-pot-toggle:hover {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 60%);
  background: color-mix(in srgb, var(--accent), transparent 88%);
}

.op-chat-header-main .op-chat-papercup-toggle:focus-visible,
.op-chat-header-main .op-chat-pot-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-strong), transparent 18%);
  outline-offset: 2px;
}

/* WI-4740: the speak-responses (TTS) mute — moved here from the retired
   middle-bar (PapercupVoiceBar) so voice controls live on the chat bar only. */
.op-chat-controls .op-chat-tts {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 6px;
  border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 74%);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-1), transparent 4%);
  color: #eef8ff;
  cursor: pointer;
}

.op-chat-controls .op-chat-tts.is-muted {
  color: var(--fg-mute, #7f9bb4);
  background: transparent;
}

.op-chat-controls .op-chat-tts:hover {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 60%);
  background: color-mix(in srgb, var(--accent), transparent 88%);
}

.op-chat-controls .pc-voice-btn-orb {
  width: 16px;
  height: 16px;
}

.op-chat-controls .pc-voice-btn-label {
  font-size: 10px;
  letter-spacing: 0;
}

.op-chat-controls .pc-voice-settings-link {
  flex: 0 0 auto;
  min-height: 26px;
  padding: 0 6px;
}
.op-chat-controls .pc-voice-settings-text {
  display: none;
}
.op-chat-controls .pc-voice-wake-hint {
  z-index: 5;
}

.op-chat-sidebar .op-chat-banner {
  margin: 10px 12px 0;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 82%);
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent-strong), transparent 93%);
  color: #cfeeff;
  font-size: 12px;
  line-height: 1.4;
}

.op-chat-sidebar .oracle-body {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-deep), transparent 4%), color-mix(in srgb, var(--bg-deeper), transparent 2%)) !important;
  padding: 14px 13px;
  gap: 12px;
  scrollbar-color: color-mix(in srgb, var(--accent-strong), transparent 78%) transparent;
}

.op-chat-sidebar .oracle-virtual-container {
  flex: 0 0 auto;
}

.op-chat-sidebar .oracle-msg {
  width: 100% !important;
  max-width: 100% !important;
  padding: 0 2px;
  box-sizing: border-box;
}

.op-chat-sidebar .oracle-msg-avatar {
  width: 30px;
  height: 30px;
  flex-basis: 30px;
}

.op-chat-sidebar .oracle-msg-stack {
  max-width: calc(100% - 40px);
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-stack {
  margin-left: auto;
}

.op-chat-sidebar .oracle-msg-content {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 87%);
  background: color-mix(in srgb, var(--bg), transparent 8%) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.035), 0 10px 22px rgba(0,0,0,0.16);
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-content {
  border-color: color-mix(in srgb, var(--accent), transparent 72%);
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg-raised-high), transparent 2%), color-mix(in srgb, var(--bg-popover), transparent 2%)) !important;
}

.op-chat-sidebar .oracle-msg-content:empty,
.op-chat-sidebar .oracle-msg-content:has(> :only-child:empty) {
  display: none;
}

.op-chat-sidebar .oracle-tool-chip {
  max-width: 100%;
  overflow: hidden;
}

.op-chat-sidebar .oracle-form {
  border-top-color: color-mix(in srgb, var(--accent-strong), transparent 86%);
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg), transparent 8%), color-mix(in srgb, var(--bg-deeper), transparent 2%)) !important;
  padding: 12px;
}

.op-chat-sidebar .oracle-form input {
  background: rgba(255,255,255,0.04);
  border-color: color-mix(in srgb, var(--accent-strong), transparent 82%);
}

.op-chat-sidebar .oracle-form input:focus {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 52%);
}

.op-chat-sidebar .oracle-send-button {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 78%);
  background: color-mix(in srgb, var(--accent-strong), transparent 90%);
}

.op-chat-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  z-index: 1;
  touch-action: none;
}
.op-chat-resize-handle:hover {
  background: color-mix(in srgb, var(--accent-strong), transparent 82%);
}

/* Body shift: every page absorbs the sidebar's width as left padding.
   Pages with margin: auto centered content stay centered within the
   remaining space (the centering algorithm absorbs the loss into
   what used to be margin). Edge-to-edge pages may need their own
   per-page padding tweaks.

   ⚠ COMMUTATION CONTRACT (WI-4725): the LeftSidebar rail (operator-vite
   left-sidebar.styles.ts) sets an equal-specificity body.has-left-sidebar
   rule: padding-left: calc(--op-chat-w + --left-sidebar-w). When BOTH are
   open, cascade order between the two independently-injected <style> tags
   decides which rule applies — so BOTH rules must compute the IDENTICAL
   full sum (each var defaults 0px when its surface is absent; the owning
   component sets its var before adding its body class and removes it on
   unmount). An op-chat-only padding-left: var(--op-chat-w) here silently
   clobbers the rail's additive rule and the rail lands ON TOP of the main
   pane (owner-reported overlap, 2026-07-13). Same for the .pc-header
   width leg below. Keep the formulas in the two files in lockstep. */
body.has-op-chat {
  padding-left: calc(var(--op-chat-w, 360px) + var(--left-sidebar-w, 0px));
}

/* Only the global sticky header needs an explicit width clamp.
   The harness strip (.h-header) already sits inside body content, so the
   body padding-left above shifts it naturally; offsetting it again doubles
   the shift and clips the right-side controls after chat mount / resize.
   Width must subtract EVERY docked rail (see the commutation contract
   above) — 100vw minus only --op-chat-w over-widens by the rail width and
   pushes the right-side nav off-viewport when the rail is open. */
body.has-op-chat .pc-header {
  left: var(--op-chat-w, 360px);
  width: calc(100vw - var(--op-chat-w, 360px) - var(--left-sidebar-w, 0px) - var(--dev-rail-w, 0px));
}

.op-chat-sidebar {
  isolation: isolate;
  background:
    radial-gradient(circle at 16% 0%, color-mix(in srgb, var(--accent-strong), transparent 84%), transparent 22%),
    radial-gradient(circle at 82% 12%, rgba(255,255,255,0.06), transparent 16%),
    linear-gradient(180deg, var(--bg) 0%, var(--bg-deeper) 58%, var(--bg-deepest) 100%);
  box-shadow:
    inset -1px 0 0 rgba(255,255,255,0.03),
    inset 0 1px 0 rgba(255,255,255,0.04),
    22px 0 54px rgba(0, 0, 0, 0.24);
}

.op-chat-sidebar::before,
.op-chat-sidebar::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.op-chat-sidebar::before {
  border-right: 1px solid color-mix(in srgb, var(--accent-soft), transparent 90%);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.04), transparent 12%, transparent 88%, rgba(255,255,255,0.03));
  opacity: 0.8;
}

.op-chat-sidebar::after {
  inset: 118px 0 58px;
  background:
    linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent-strong), transparent 95.5%) 16%, transparent 36%),
    repeating-linear-gradient(180deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 32px);
  opacity: 0.55;
}

.op-chat-header {
  position: relative;
  z-index: 3;
  overflow: visible;
  isolation: isolate;
  backdrop-filter: blur(12px);
  background:
    radial-gradient(circle at 12% 12%, color-mix(in srgb, var(--accent-strong), transparent 88%), transparent 18%),
    linear-gradient(180deg, color-mix(in srgb, var(--bg-popover), transparent 4%), color-mix(in srgb, var(--bg-deep), transparent 2%)),
    var(--bg);
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--accent-strong), transparent 92%);
}
.op-chat-header-main {
  position: relative;
  z-index: 1;
}

.op-chat-header::after {
  content: '';
  position: absolute;
  z-index: 0;
  left: -18%;
  top: 0;
  width: 44%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
  transform: skewX(-20deg);
  animation: op-chat-header-sheen 9s ease-in-out infinite;
  pointer-events: none;
}

.op-chat-sidebar .op-chat-banner {
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(8px);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--accent), transparent 90%), color-mix(in srgb, var(--accent), transparent 95%));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}

.op-chat-sidebar .op-chat-banner::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent);
  transform: translateX(-140%);
  animation: op-chat-banner-sheen 7s ease-in-out infinite;
  pointer-events: none;
}

.op-chat-sidebar .oracle-body {
  position: relative;
  z-index: 1;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-deep), transparent 4%), color-mix(in srgb, var(--bg-deeper), transparent 1.5%)) !important;
}

.op-chat-sidebar .oracle-msg-content {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-1), transparent 3%), color-mix(in srgb, var(--bg-deep), transparent 1%)) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.04),
    inset 0 -1px 0 rgba(0,0,0,0.18),
    0 12px 24px rgba(0,0,0,0.18);
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-content {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-raised-high), transparent 1%), color-mix(in srgb, var(--bg-popover), transparent 1%)) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    inset 0 -1px 0 rgba(0,0,0,0.18),
    0 14px 28px color-mix(in srgb, var(--bg-deeper), transparent 78%);
}

.op-chat-sidebar .oracle-form {
  position: relative;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
}

.op-chat-sidebar .oracle-form::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent-strong), transparent 76%), transparent);
}

.op-chat-sidebar .oracle-form input {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}

.op-chat-sidebar .oracle-send-button {
  position: relative;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--accent-strong), transparent 70%);
  background: linear-gradient(180deg, rgba(71, 198, 255, 0.22), color-mix(in srgb, var(--accent), transparent 88%));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.06),
    0 8px 18px color-mix(in srgb, var(--bg-deeper), transparent 82%);
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background 120ms ease;
}

.op-chat-sidebar .oracle-send-button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-strong), transparent 58%);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent), transparent 74%), color-mix(in srgb, var(--accent), transparent 84%));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    0 10px 20px color-mix(in srgb, var(--bg-deeper), transparent 78%);
}

.op-chat-sidebar .oracle-send-button::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent);
  transform: translateX(-150%);
}

.op-chat-sidebar .oracle-send-button:hover:not(:disabled)::after {
  animation: op-chat-button-sheen 800ms ease;
}

.op-chat-resize-handle {
  width: 7px;
}

.op-chat-resize-handle:hover {
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent-strong), transparent 96%), color-mix(in srgb, var(--accent-strong), transparent 78%), color-mix(in srgb, var(--accent-strong), transparent 96%));
}

@keyframes op-chat-header-sheen {
  0%, 12%, 100% { transform: translateX(-160%) skewX(-20deg); opacity: 0; }
  18%, 32% { transform: translateX(280%) skewX(-20deg); opacity: 1; }
  36% { opacity: 0; }
}

@keyframes op-chat-banner-sheen {
  0%, 72%, 100% { transform: translateX(-150%); opacity: 0; }
  78%, 92% { transform: translateX(140%); opacity: 1; }
}

@keyframes op-chat-button-sheen {
  from { transform: translateX(-150%); }
  to { transform: translateX(150%); }
}

/* Simplicity/readability pass: flatten decorative motion, tighten message
   rhythm, and give the composer more useful text space. */
.op-chat-sidebar {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-deep), transparent 1%), color-mix(in srgb, var(--bg-deepest), transparent 1%)) !important;
  box-shadow:
    inset -1px 0 0 rgba(255,255,255,0.035),
    14px 0 34px rgba(0, 0, 0, 0.18) !important;
}

.op-chat-sidebar::after,
.op-chat-header::after,
.op-chat-sidebar .op-chat-banner::after,
.op-chat-sidebar .oracle-form::before,
.op-chat-sidebar .oracle-send-button::after,
.op-chat-sidebar .oracle-msg-assistant .oracle-msg-content::before,
.op-chat-sidebar .oracle-msg-assistant .oracle-msg-content::after {
  display: none !important;
}

.op-chat-sidebar::before {
  opacity: 0.42 !important;
  background: none !important;
}

.op-chat-header {
  padding: 8px 10px 7px !important;
  background: color-mix(in srgb, var(--bg-deep), transparent 4%) !important;
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--accent-strong), transparent 90%) !important;
  backdrop-filter: none !important;
}

.op-chat-header-main {
  gap: 9px !important;
}

.op-chat-header-main .op-chat-wordmark-title {
  font-size: 13.5px !important;
}

.op-chat-controls .op-active-toggle,
.op-chat-controls .pc-voice-btn,
.op-chat-controls .pc-voice-settings-link,
.op-chat-header-main .op-chat-papercup-toggle,
.op-chat-header-main .op-chat-pot-toggle,
.op-chat-controls .op-chat-tts {
  min-height: 27px !important;
  box-shadow: none !important;
}

.op-chat-sidebar .oracle-body {
  padding: 8px 8px 9px !important;
  gap: 7px !important;
  background: color-mix(in srgb, var(--bg-deepest), transparent 2%) !important;
}

.op-chat-sidebar .oracle-msg {
  padding-inline: 0 !important;
  column-gap: 7px !important;
}

/* WI-4731: the owner flagged the agent mark as too small to read. This
   compact-density override was pinning it at 20px with !important, silently
   defeating the globals.css bump (24 -> 34px) -- the avatar the owner sees IS
   this rule. Keep the sidebar denser than the full-width chat, but large
   enough that the role mark reads: 30px avatar / 18px glyph. */
.op-chat-sidebar .oracle-msg-avatar {
  width: 30px !important;
  height: 30px !important;
  flex-basis: 30px !important;
  margin-top: 1px;
  opacity: 0.9;
  box-shadow: none !important;
}

.op-chat-sidebar .oracle-msg-icon {
  width: 18px !important;
  height: 18px !important;
}

.op-chat-sidebar .oracle-msg-stack {
  max-width: calc(100% - 38px) !important;
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-stack {
  max-width: min(84%, 286px) !important;
}

.op-chat-sidebar .oracle-msg-content {
  padding: 9px 10px !important;
  border-radius: 12px !important;
  background: color-mix(in srgb, var(--bg), transparent 6%) !important;
  box-shadow: none !important;
  font-size: 13px !important;
  line-height: 1.5 !important;
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-content {
  background: color-mix(in srgb, var(--bg-raised-high), transparent 4%) !important;
}

.op-chat-sidebar .oracle-tool-chip {
  min-height: 22px;
  padding: 3px 8px;
  border-radius: 999px;
  opacity: 0.74;
  font-size: 10.5px;
  box-shadow: none !important;
}

.op-chat-sidebar .op-chat-banner {
  margin: 8px 9px 0 !important;
  padding: 8px 9px !important;
  border-radius: 10px !important;
  background: color-mix(in srgb, var(--accent), transparent 92.5%) !important;
  box-shadow: none !important;
}

.op-chat-sidebar .oracle-form {
  padding: 8px !important;
  gap: 6px !important;
  background: color-mix(in srgb, var(--bg-deep), transparent 2%) !important;
}

.op-chat-sidebar .oracle-input-shell {
  min-height: 38px !important;
  border-radius: 12px !important;
  box-shadow: none !important;
}

.op-chat-sidebar .oracle-input-shell input {
  padding-right: 12px !important;
  font-size: 13px !important;
}

.op-chat-sidebar .oracle-input-meta {
  display: none !important;
}

.op-chat-sidebar .oracle-send-button {
  min-width: 58px !important;
  min-height: 38px !important;
  border-radius: 12px !important;
  box-shadow: none !important;
  transform: none !important;
}

/* Contrast follow-up: separate chat surfaces from the sidebar background so
   reading requires less effort at a glance. */
.op-chat-sidebar .oracle-body {
  background: color-mix(in srgb, var(--bg-deepest), transparent 1%) !important;
}

.op-chat-controls .op-active-toggle,
.op-chat-controls .pc-voice-btn,
.op-chat-controls .pc-voice-settings-link,
.op-chat-header-main .op-chat-papercup-toggle,
.op-chat-header-main .op-chat-pot-toggle,
.op-chat-controls .op-chat-tts {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 74%) !important;
  background: color-mix(in srgb, var(--bg-1), transparent 4%) !important;
  color: #eef8ff !important;
}

/* Keep the muted TTS state visually distinct despite the contrast group's
   !important ink above. */
.op-chat-controls .op-chat-tts.is-muted {
  color: var(--fg-mute, #7f9bb4) !important;
  background: transparent !important;
}

/* Same carve-out for the lit 🫖 / Papercup state (WI-4778 / WI-4793). */
.op-chat-header-main .op-chat-papercup-toggle.is-on,
.op-chat-header-main .op-chat-pot-toggle.is-on {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 30%) !important;
  background: color-mix(in srgb, var(--accent), transparent 82%) !important;
}

.op-chat-controls .pc-voice-btn-orb {
  background: color-mix(in srgb, var(--accent), transparent 86%) !important;
}

.op-chat-sidebar .op-chat-banner {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 78%) !important;
  background: color-mix(in srgb, var(--accent), transparent 89%) !important;
  color: #e6f6ff !important;
}

.op-chat-sidebar .oracle-tool-chip {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 78%) !important;
  background: color-mix(in srgb, var(--accent), transparent 88%) !important;
  color: #c5edff !important;
  opacity: 0.92;
}

.op-chat-sidebar .oracle-msg-content {
  border: 1px solid rgba(148, 163, 184, 0.22) !important;
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg-popover), transparent 2%), color-mix(in srgb, var(--bg), transparent 1%)) !important;
  color: #f3f9ff !important;
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-content {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 60%) !important;
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg-raised-high), transparent 1%), color-mix(in srgb, var(--bg-raised-high), transparent 1%)) !important;
  color: var(--fg) !important;
}

.op-chat-sidebar .oracle-input-shell {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 76%) !important;
  background: color-mix(in srgb, var(--bg-1), transparent 2%) !important;
}

.op-chat-sidebar .oracle-input-shell input {
  color: var(--fg) !important;
}

.op-chat-sidebar .oracle-input-shell input::placeholder {
  color: color-mix(in srgb, var(--accent-soft), transparent 44%) !important;
}

.op-chat-sidebar .oracle-send-button {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 66%) !important;
  background: color-mix(in srgb, var(--accent), transparent 83%) !important;
  color: var(--fg) !important;
}

.op-chat-sidebar .oracle-send-button:disabled {
  border-color: rgba(148, 163, 184, 0.18) !important;
  background: rgba(255, 255, 255, 0.05) !important;
  color: color-mix(in srgb, var(--fg), transparent 28%) !important;
}

.op-chat-sidebar .ask-choice-card {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 82%) !important;
  background: color-mix(in srgb, var(--bg-1), transparent 2%) !important;
}

.op-chat-sidebar .ask-choice-option {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 86%) !important;
  background: rgba(255, 255, 255, 0.028) !important;
}

/* Readability follow-up: clarify utility text and affordances without adding
   chrome. These are the surfaces users scan before typing or responding. */
.op-chat-sidebar .oracle-load-earlier {
  padding: 7px 0 8px !important;
  color: color-mix(in srgb, var(--fg), transparent 46%) !important;
  font-size: 10px !important;
  font-weight: 760 !important;
  letter-spacing: 0 !important;
}

.op-chat-sidebar .oracle-load-earlier-end {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: color-mix(in srgb, var(--fg), transparent 42%) !important;
}

.op-chat-sidebar .oracle-load-earlier-end::before,
.op-chat-sidebar .oracle-load-earlier-end::after {
  content: "";
  width: 42px;
  height: 1px;
  background: color-mix(in srgb, var(--accent-strong), transparent 86%);
}

.op-chat-sidebar .oracle-tool-chip {
  font-size: 11px;
  line-height: 1.25;
  letter-spacing: 0;
}

.op-chat-sidebar .oracle-msg-content {
  border-color: rgba(148, 163, 184, 0.30) !important;
  font-size: 13.25px !important;
  line-height: 1.54 !important;
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-content {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 50%) !important;
}

.op-chat-sidebar .oracle-empty-state-title {
  color: var(--fg) !important;
}

.op-chat-sidebar .oracle-empty-state-text {
  color: color-mix(in srgb, var(--fg), transparent 22%) !important;
}

.op-chat-sidebar .op-chat-empty-panel {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 78%) !important;
  background: color-mix(in srgb, var(--bg-1), transparent 2%) !important;
}

.op-chat-sidebar .op-chat-empty-panel-label {
  color: color-mix(in srgb, var(--fg), transparent 18%) !important;
}

.op-chat-sidebar .op-chat-empty-row {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 84%) !important;
  background: rgba(255, 255, 255, 0.035) !important;
}

.op-chat-sidebar .op-chat-empty-row-hint {
  color: color-mix(in srgb, var(--fg), transparent 22%) !important;
}

.op-chat-sidebar .oracle-input-icon {
  color: color-mix(in srgb, var(--accent-soft), transparent 24%) !important;
}

.op-chat-sidebar .oracle-input-shell input::placeholder {
  color: color-mix(in srgb, var(--fg), transparent 34%) !important;
}

.op-chat-sidebar .oracle-send-button:disabled {
  opacity: 0.86 !important;
}

.op-chat-sidebar .ask-choice-question {
  color: var(--fg) !important;
}

.op-chat-sidebar .ask-choice-picked {
  color: color-mix(in srgb, var(--fg), transparent 14%) !important;
}

.op-chat-sidebar .ask-choice-picked span {
  color: var(--fg) !important;
  font-weight: 720 !important;
}

.op-chat-sidebar .ask-choice-option[data-picked="true"] {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 62%) !important;
  background: color-mix(in srgb, var(--accent), transparent 86%) !important;
}

.op-chat-sidebar .ask-choice-submit-hint {
  color: color-mix(in srgb, var(--fg), transparent 20%) !important;
}

/* Usability follow-up: make the first-run panel, composer, and selectable
   choices read as practical controls rather than decorative HUD pieces. */
.op-chat-sidebar .oracle-body {
  overflow-x: hidden !important;
}

.op-chat-sidebar .oracle-empty-state {
  gap: 11px !important;
}

.op-chat-sidebar .oracle-empty-state-icon {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 66%) !important;
  background: color-mix(in srgb, var(--bg-raised-high), transparent 2%) !important;
}

.op-chat-sidebar .op-chat-empty-panel {
  width: min(100%, 284px) !important;
  padding: 13px !important;
}

.op-chat-sidebar .op-chat-empty-panel-head {
  margin-bottom: 10px !important;
}

.op-chat-sidebar .op-chat-empty-panel-label {
  letter-spacing: 0 !important;
}

.op-chat-sidebar .op-chat-empty-row {
  gap: 3px !important;
  padding: 9px 10px !important;
  border-color: color-mix(in srgb, var(--accent-strong), transparent 80%) !important;
  background: color-mix(in srgb, var(--bg-popover), transparent 2%) !important;
}

.op-chat-sidebar .op-chat-empty-row-title {
  color: var(--fg) !important;
  font-size: 12.5px !important;
  line-height: 1.28 !important;
}

.op-chat-sidebar .op-chat-empty-row-hint {
  line-height: 1.42 !important;
}

.op-chat-sidebar .oracle-msg-content,
.op-chat-sidebar .oracle-tool-chip,
.op-chat-sidebar .ask-choice-question,
.op-chat-sidebar .ask-choice-option-label,
.op-chat-sidebar .ask-choice-option-hint {
  overflow-wrap: anywhere;
}

.op-chat-sidebar .ask-choice-option {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 82%) !important;
  background: color-mix(in srgb, var(--bg-1), transparent 8%) !important;
}

.op-chat-sidebar .ask-choice-option:hover:not([data-disabled="true"]) {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 68%) !important;
  background: color-mix(in srgb, var(--bg-raised), transparent 4%) !important;
}

.op-chat-sidebar .ask-choice-option-label {
  color: var(--fg) !important;
  line-height: 1.28 !important;
  white-space: normal !important;
}

.op-chat-sidebar .ask-choice-option-hint {
  color: color-mix(in srgb, var(--fg), transparent 20%) !important;
  line-height: 1.34 !important;
  white-space: normal !important;
}

.op-chat-sidebar .ask-choice-option-icon {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 76%) !important;
  background: color-mix(in srgb, var(--accent), transparent 85%) !important;
}

.op-chat-sidebar .ask-choice-option-chevron {
  color: color-mix(in srgb, var(--fg), transparent 18%) !important;
}

.op-chat-sidebar .oracle-form {
  position: relative;
  z-index: 4;
  border-top-color: color-mix(in srgb, var(--accent-strong), transparent 76%) !important;
  background: color-mix(in srgb, var(--bg-deep), transparent 1%) !important;
  box-shadow: 0 -14px 26px rgba(0, 0, 0, 0.24) !important;
}

.op-chat-sidebar .oracle-input-shell {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 70%) !important;
  background: color-mix(in srgb, var(--bg-1), transparent 1%) !important;
}

.op-chat-sidebar .oracle-input-shell::before {
  content: none !important;
  display: none !important;
}

.op-chat-sidebar .oracle-input-shell:hover {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 58%) !important;
  background: color-mix(in srgb, var(--bg-popover), transparent 1%) !important;
}

.op-chat-sidebar .oracle-input-shell:focus-within {
  border-color: color-mix(in srgb, var(--accent), transparent 42%) !important;
  background: color-mix(in srgb, var(--bg-popover), transparent 1%) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 0 16px color-mix(in srgb, var(--accent), transparent 84%) !important;
}

.op-chat-sidebar .oracle-input-shell input {
  caret-color: var(--accent-strong);
}

.op-chat-sidebar .oracle-send-button:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent), transparent 52%) !important;
  background: color-mix(in srgb, var(--accent), transparent 76%) !important;
  color: var(--fg) !important;
}

.op-chat-sidebar .oracle-send-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent), transparent 34%) !important;
  background: color-mix(in srgb, var(--accent), transparent 70%) !important;
}

.op-chat-sidebar button.op-chat-empty-row {
  position: relative;
  width: 100%;
  padding-right: 58px !important;
  appearance: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.op-chat-sidebar button.op-chat-empty-row::after {
  content: "Draft";
  position: absolute;
  right: 10px;
  top: 50%;
  height: 19px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--accent-strong), transparent 76%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent), transparent 88%);
  color: rgba(224, 247, 255, 0.90);
  font-size: 9.5px;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1;
  text-transform: uppercase;
  transform: translateY(-50%);
}

.op-chat-sidebar button.op-chat-empty-row:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent), transparent 64%) !important;
  background: color-mix(in srgb, var(--bg-raised), transparent 1%) !important;
}

.op-chat-sidebar button.op-chat-empty-row:hover:not(:disabled)::after,
.op-chat-sidebar button.op-chat-empty-row:focus-visible::after {
  border-color: color-mix(in srgb, var(--accent), transparent 54%);
  background: color-mix(in srgb, var(--accent), transparent 82%);
  color: var(--fg);
}

.op-chat-sidebar button.op-chat-empty-row:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent), transparent 38%);
  outline-offset: 3px;
}

.op-chat-sidebar button.op-chat-empty-row:disabled {
  cursor: wait;
  opacity: 0.72;
}

.op-chat-sidebar .oracle-send-button:disabled {
  border-color: rgba(148, 163, 184, 0.24) !important;
  background: rgba(255, 255, 255, 0.06) !important;
  color: color-mix(in srgb, var(--fg), transparent 24%) !important;
}

.op-chat-sidebar .oracle-tool-chip {
  max-width: min(100%, 286px);
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.op-chat-sidebar .oracle-tool-chip svg {
  flex: 0 0 auto;
  opacity: 0.78;
}

.op-chat-sidebar .oracle-tool-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.op-chat-sidebar .oracle-tool-chip:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent), transparent 38%);
  outline-offset: 3px;
}

.op-chat-tool-tooltip {
  display: grid;
  gap: 4px;
  max-width: 280px;
  overflow-wrap: anywhere;
}

.op-chat-tool-tooltip strong {
  color: var(--fg);
  font-size: 11px;
  line-height: 1.35;
}

.op-chat-tool-tooltip span {
  color: color-mix(in srgb, var(--fg), transparent 22%);
  font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace);
  font-size: 10px;
  line-height: 1.35;
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-avatar {
  display: none !important;
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-stack {
  max-width: min(86%, 300px) !important;
}

/* Readability/usability follow-up: keep transcript bubbles distinct in the
   narrow rail without making the chat feel loose. Padding lives on the
   virtualized row itself so the measured item height includes the gap. */
.op-chat-sidebar .oracle-body {
  padding: 10px 9px 11px !important;
}

.op-chat-sidebar .oracle-msg {
  padding-block: 2px !important;
}

.op-chat-sidebar .oracle-msg-stack {
  gap: 3px !important;
}

.op-chat-sidebar .oracle-msg-content {
  padding: 9px 11px !important;
  border-radius: 13px !important;
  border-color: rgba(148, 163, 184, 0.36) !important;
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg-popover), transparent 1%), color-mix(in srgb, var(--bg), transparent 0.5%)) !important;
  color: var(--fg) !important;
  line-height: 1.56 !important;
}

.op-chat-sidebar .oracle-msg-assistant .oracle-msg-content {
  border-color: color-mix(in srgb, var(--accent-strong), transparent 72%) !important;
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg-popover), transparent 0.5%), color-mix(in srgb, var(--bg), transparent 0.5%)) !important;
}

.op-chat-sidebar .oracle-msg-user .oracle-msg-content {
  border-color: color-mix(in srgb, var(--accent), transparent 38%) !important;
  background: linear-gradient(180deg, rgba(24, 78, 113, 0.99), color-mix(in srgb, var(--bg-raised-high), transparent 0.5%)) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    0 8px 18px color-mix(in srgb, var(--bg-deeper), transparent 80%) !important;
}

.op-chat-sidebar .oracle-msg-system .oracle-msg-content {
  border-color: rgba(250, 204, 21, 0.30) !important;
  background: rgba(42, 31, 9, 0.86) !important;
  color: #fff7d6 !important;
}

.op-chat-sidebar .oracle-tool-chip {
  margin: 0 0 3px !important;
  border-color: color-mix(in srgb, var(--accent), transparent 66%) !important;
  background: color-mix(in srgb, var(--accent), transparent 84%) !important;
  color: #ddf6ff !important;
  opacity: 1 !important;
}

.op-chat-sidebar .oracle-input-shell input {
  height: 100% !important;
  border: 0 !important;
  border-radius: inherit !important;
  background: transparent !important;
  box-shadow: none !important;
}

.op-chat-sidebar .oracle-input-shell input:focus {
  border: 0 !important;
  box-shadow: none !important;
}

.op-chat-sidebar .oracle-thinking-row {
  flex-shrink: 0 !important;
  max-width: calc(100% - 38px) !important;
  margin: 4px 8px 12px 30px !important;
  border-color: color-mix(in srgb, var(--accent), transparent 66%) !important;
  border-radius: 13px !important;
  background: color-mix(in srgb, var(--bg-1), transparent 2%) !important;
  color: #dff6ff !important;
  overflow: visible !important;
}

/* Deck panel open → chat must stay fully visible and unblurred.
   The Deck (.operator-panel) sits behind chat at z-index 1200 and has
   a backdrop-filter blur + box-shadow scrim that bleeds through any
   translucent chat surface. Neutralize every backdrop-filter inside
   the chat and force its background to opaque so the chat reads as
   sharp, unblurred, fully interactive on top of the Deck. */
body:has(.operator-panel) .op-chat-sidebar,
body:has(.operator-panel) .op-chat-sidebar * {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
body:has(.operator-panel) .op-chat-sidebar {
  background:
    radial-gradient(circle at 50% -12%, color-mix(in srgb, var(--accent), transparent 84%), transparent 34%),
    linear-gradient(180deg, var(--bg) 0%, var(--bg-deeper) 100%),
    var(--bg-deeper) !important;
}
`;export{ut as i,Pt as n,st as r,qn as t};