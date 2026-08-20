import{o as Ye}from"./chunk-ChpBd9eV.js";import{t as Qe}from"./react-DqHYuLt-.js";import{t as Xe}from"./jsx-runtime-BmDUFisN.js";import{t as Ze}from"./VirtualGrid-BjQ1W_hB.js";import{r as O}from"./SyncContext-UViyCkeI.js";import{t as et}from"./flag-hooks-CFqh6-DS.js";import{n as P}from"./dist-C7mPGmVK.js";import{a as ee,c as K,r as tt,t as at}from"./dist-_S1YDkZy.js";import{s as rt}from"./client-Dg3eibAg.js";import{t as ae}from"./use-workspace-id-CWJdEj3C.js";import{n as nt,r as st,t as it}from"./dist-Okg3868K.js";import{t as Ee}from"./Modal-N5AtQfeY.js";import{t as Ie}from"./useConfirmDialog-C5r8Ks87.js";import{n as lt,t as ot}from"./presence-ui-L7NNh3MC.js";import{t as L}from"./Tooltip-BRMSMTLQ.js";import{t as U}from"./createLucideIcon-H39hj3ia.js";import{n as le,t as dt}from"./ChatPanel-C23LdIYx.js";import{t as Te}from"./arrow-up-right-0anD4iWN.js";import{t as ct}from"./check-Cdd_-6Wk.js";import{t as be}from"./chevron-down-Cewb32jP.js";import{t as Re}from"./eye-Ir_yoFNS.js";import{t as ut}from"./flask-conical-CjB7y8cu.js";import{t as pt}from"./Checkbox-B2Xs7vTj.js";import{t as mt}from"./puzzle-Dl388NgU.js";import{t as ft}from"./refresh-cw-DU29wawW.js";import{t as ht}from"./sparkles-B3Y1Aaqk.js";import{t as ze}from"./triangle-alert-CeknQp5m.js";import{t as ye}from"./x-DBWzBmCv.js";import{t as gt}from"./Popover-V1LrQJ79.js";import{t as re}from"./useLexicon-DWO-_pBS.js";import{_ as Q,b as _e,h as Fe,t as je,u as vt,v as xt}from"./theme-DvDd692h.js";import{t as he}from"./Select-HnWBQ_7f.js";import{n as bt,r as yt,t as Me}from"./agent-display-CMypfJF9.js";import{r as De}from"./list-meta-Dg3pa9_R.js";var d=Ye(Qe());function _t(t,e){try{const n=t?.getItem(e);if(!n)return{};const r=JSON.parse(n);if(!r||typeof r!="object"||Array.isArray(r))return{};const s={};for(const[l,i]of Object.entries(r))typeof i=="number"&&Number.isFinite(i)&&i>0&&(s[l]=i);return s}catch{return{}}}function jt(t,e){const n=e??(typeof window<"u"?window.localStorage:void 0),[r,s]=(0,d.useState)(()=>_t(n,t));return[r,(0,d.useCallback)(l=>{s(l);try{n?.setItem(t,JSON.stringify(l))}catch{}},[t,n])]}function ne(t,e){switch(t.type){case"text":return typeof e!="string"||e.length===0;case"enum":return!Array.isArray(e)||e.length===0;case"number":{if(e==null||typeof e!="object"||Array.isArray(e))return!0;const{min:n,max:r}=e;return n==null&&r==null}case"boolean":return typeof e!="boolean";default:return!0}}function kt(t,e,n){if(ne(t,e))return!0;switch(t.type){case"text":{const r=t.accessor(n);return r==null?!1:String(r).toLowerCase().includes(e.toLowerCase())}case"enum":{const r=t.accessor(n);return r==null?!1:e.includes(r)}case"number":{const r=t.accessor(n);if(r==null||typeof r!="number"||Number.isNaN(r))return!1;const{min:s,max:l}=e;return!(s!=null&&r<s||l!=null&&r>l)}case"boolean":{const r=t.accessor(n);return r==null?!1:r===e}default:return!0}}function wt(t,e,n){if(!e)return t;const r=[];for(const s of Object.keys(e)){const l=n.find(m=>m.key===s);if(!l?.filter)continue;const i=e[s];ne(l.filter,i)||r.push({spec:l.filter,value:i})}return r.length===0?t:t.filter(s=>r.every(({spec:l,value:i})=>kt(l,i,s)))}function St(t,e){const n=e.filter;if(!n||n.type!=="enum")return[];const r=new Map;for(const s of t){const l=n.accessor(s);l!=null&&r.set(l,(r.get(l)??0)+1)}return n.options&&n.options.length>0?n.options.map(s=>({value:s.value,...s.label!==void 0?{label:s.label}:{},count:r.get(s.value)??0})):[...r.keys()].sort((s,l)=>s.localeCompare(l)).map(s=>({value:s,count:r.get(s)}))}var Pe="~",Oe=":",Le=",",Ue="..";function pe(t){return t.replace(/[%~,:]/g,e=>"%"+e.charCodeAt(0).toString(16).toUpperCase().padStart(2,"0"))}function oe(t){return t.replace(/%([0-9A-Fa-f]{2})/g,(e,n)=>String.fromCharCode(parseInt(n,16)))}function Nt(t,e){if(ne(t,e))return null;switch(t.type){case"text":return pe(e);case"enum":return e.map(pe).join(Le);case"number":{const{min:n,max:r}=e;return`${n!=null?String(n):""}${Ue}${r!=null?String(r):""}`}case"boolean":return e?"true":"false";default:return null}}function de(t){if(!t)return"";const e=[];for(const n of Object.keys(t)){const r=t[n],s=$t(r);if(!s)continue;const l=Nt(s,r);l!=null&&e.push(`${Ct(n)}${Oe}${l}`)}return e.join(Pe)}function Ct(t){return pe(t)}function $t(t){return typeof t=="string"?{type:"text",accessor:()=>null}:Array.isArray(t)?{type:"enum",accessor:()=>null}:typeof t=="boolean"?{type:"boolean",accessor:()=>null}:t!=null&&typeof t=="object"?{type:"number",accessor:()=>null}:null}function At(t){const e=t.indexOf(Ue);if(e===-1)return null;const n=t.slice(0,e),r=t.slice(e+2),s={};if(n!==""){const l=Number(n);if(Number.isNaN(l))return null;s.min=l}if(r!==""){const l=Number(r);if(Number.isNaN(l))return null;s.max=l}return s.min==null&&s.max==null?null:s}function Et(t,e){const n={};if(!t)return n;const r=new Map;for(const s of e)s.filter&&r.set(s.key,s.filter);for(const s of t.split(Pe)){if(s==="")continue;const l=s.indexOf(Oe);if(l===-1)continue;const i=oe(s.slice(0,l)),m=s.slice(l+1),f=r.get(i);if(f)switch(f.type){case"text":{const o=oe(m);if(o.length===0)continue;n[i]=o;break}case"enum":{const o=m.split(Le).filter(u=>u!=="").map(oe);if(o.length===0)continue;n[i]=o;break}case"number":{const o=At(m);if(!o)continue;n[i]=o;break}case"boolean":m==="true"?n[i]=!0:m==="false"&&(n[i]=!1);break}}return n}function It(t,e){return t.options?.find(n=>n.value===e)?.label??e}function Tt(t){return typeof t.header=="string"&&t.header.length>0?t.header:typeof t.header=="number"?String(t.header):typeof t.headerText=="string"&&t.headerText.length>0?t.headerText:t.key}function Rt(t,e){const n=t.filter,r=Tt(t);if(!n||ne(n,e))return"";switch(n.type){case"text":return`${r}: ${e}`;case"enum":return`${r}: ${e.map(s=>It(n,s)).join(", ")}`;case"number":{const{min:s,max:l}=e;return s!=null&&l!=null?`${r}: ${s}–${l}`:s!=null?`${r}: ≥${s}`:`${r}: ≤${l}`}case"boolean":return`${r}: ${e?"true":"false"}`;default:return""}}var zt=[["path",{d:"M12 20v-9",key:"1qisl0"}],["path",{d:"M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z",key:"uouzyp"}],["path",{d:"M14.12 3.88 16 2",key:"qol33r"}],["path",{d:"M21 21a4 4 0 0 0-3.81-4",key:"1b0z45"}],["path",{d:"M21 5a4 4 0 0 1-3.55 3.97",key:"5cxbf6"}],["path",{d:"M22 13h-4",key:"1jl80f"}],["path",{d:"M3 21a4 4 0 0 1 3.81-4",key:"1fjd4g"}],["path",{d:"M3 5a4 4 0 0 0 3.55 3.97",key:"1d7oge"}],["path",{d:"M6 13H2",key:"82j7cp"}],["path",{d:"m8 2 1.88 1.88",key:"fmnt4t"}],["path",{d:"M9 7.13V6a3 3 0 1 1 6 0v1.13",key:"1vgav8"}]],Ft=U("bug",zt),Mt=[["path",{d:"M21.801 10A10 10 0 1 1 17 3.335",key:"yps3ct"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],Z=U("circle-check-big",Mt),Dt=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],Be=U("circle-x",Dt),Pt=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]],W=U("circle",Pt),Ot=[["rect",{width:"12",height:"12",x:"2",y:"10",rx:"2",ry:"2",key:"6agr2n"}],["path",{d:"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6",key:"1o487t"}],["path",{d:"M6 18h.01",key:"uhywen"}],["path",{d:"M10 14h.01",key:"ssrbsk"}],["path",{d:"M15 6h.01",key:"cblpky"}],["path",{d:"M18 9h.01",key:"2061c0"}]],Lt=U("dices",Ot),Ut=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M9 10h6",key:"9gxzsh"}],["path",{d:"M12 13V7",key:"h0r20n"}],["path",{d:"M9 17h6",key:"r8uit2"}]],Bt=U("file-diff",Ut),Wt=[["path",{d:"m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9",key:"1hayfq"}],["path",{d:"m18 15 4-4",key:"16gjal"}],["path",{d:"m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5",key:"15ts47"}]],me=U("hammer",Wt),Ht=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]],qt=U("info",Ht),Vt=[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}]],Kt=U("list-checks",Vt),Gt=[["path",{d:"M2 5h20",key:"1fs1ex"}],["path",{d:"M6 12h12",key:"8npq4p"}],["path",{d:"M9 19h6",key:"456am0"}]],Jt=U("list-filter",Gt),Yt=[["path",{d:"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719",key:"1sd12s"}]],We=U("message-circle",Yt),Qt=[["path",{d:"M12 16h.01",key:"1drbdi"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z",key:"1fd625"}]],He=U("octagon-alert",Qt),ke="papercusp:open-chat";async function qe(t){const e=t.dispatch!==!1;try{try{const l=await fetch(`/api/harness/${encodeURIComponent(t.slug)}/agent-chats`);if(l.ok){const i=((await l.json()).chats??[]).find(m=>m.role===t.role&&m.feature_id===t.featureId);if(i){const m={slug:t.slug,chatId:i.id,title:i.title??t.title,role:i.role,featureId:t.featureId,...t.mode?{mode:t.mode}:{}};if(e&&typeof window<"u"){const f=window,o=f.__PAPERCUSP_PENDING_CHAT_OPENS__??[];o.push(m),f.__PAPERCUSP_PENDING_CHAT_OPENS__=o,window.dispatchEvent(new CustomEvent(ke,{detail:m}))}return{chatId:i.id}}}}catch{}const n=await fetch(`/api/harness/${encodeURIComponent(t.slug)}/agent-chats`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({role:t.role,feature_id:t.featureId,title:t.title})});if(!n.ok)return{error:(await n.json().catch(()=>({}))).error??`HTTP ${n.status}`};const r=await n.json(),s={slug:t.slug,chatId:r.id,title:r.title,role:r.role,featureId:r.feature_id??void 0,...t.mode?{mode:t.mode}:{}};if(e&&typeof window<"u"){const l=window,i=l.__PAPERCUSP_PENDING_CHAT_OPENS__??[];i.push(s),l.__PAPERCUSP_PENDING_CHAT_OPENS__=i,window.dispatchEvent(new CustomEvent(ke,{detail:s}))}return{chatId:r.id}}catch(n){return{error:n.message}}}var a=Xe();function X({meta:t,Icon:e,glyph:n,size:r,showLabel:s,labelOverride:l}){const i=r==="xs"?10:11;return(0,a.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:4,padding:"1px 8px",borderRadius:999,fontSize:r==="xs"?10:Q.xs,fontWeight:700,textTransform:"uppercase",color:t.text,background:t.bg,whiteSpace:"nowrap"},children:[e?(0,a.jsx)(e,{size:i,"aria-hidden":!0}):(0,a.jsx)("span",{"aria-hidden":!0,style:{fontSize:i+1,lineHeight:1},children:n}),s&&(0,a.jsx)("span",{children:l??t.label})]})}var Xt={open:W,wip:me,blocked:ze,"needs-human":He,done:Z,dropped:le,todo:W,in_progress:me,validating:Re,failing:Be,passed:Z,deprecated:le,resolved:Z,closed:le};function te({status:t,size:e="sm",showLabel:n=!0,variant:r="dot"}){const s=xt[t];if(r==="chip")return(0,a.jsx)(X,{meta:s,Icon:Xt[t]??W,size:e,showLabel:n});const l=e==="xs"?6:8;return(0,a.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:6,fontSize:e==="xs"?Q.xs:Q.sm,color:s.text,fontWeight:500,whiteSpace:"nowrap"},children:[(0,a.jsx)("span",{"aria-hidden":!0,style:{width:l,height:l,borderRadius:"50%",background:s.solid,flexShrink:0}}),n&&(0,a.jsx)("span",{children:s.label})]})}var Zt={critical:He,major:ze,minor:qt,nit:W},ea={open:W,acknowledged:Re,fixing:me,resolved:ct,closed:Z,wontfix:Be};function ge({severity:t,size:e="sm",showLabel:n=!0}){const r=Fe[t];return(0,a.jsx)(X,{meta:r,Icon:Zt[t]??W,size:e,showLabel:n})}function ve({status:t,size:e="sm",showLabel:n=!0,variant:r="dot"}){const s=vt[t];if(r==="chip")return(0,a.jsx)(X,{meta:s,Icon:ea[t]??W,size:e,showLabel:n});const l=e==="xs"?6:8;return(0,a.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:6,fontSize:e==="xs"?Q.xs:Q.sm,color:s.text,fontWeight:500,whiteSpace:"nowrap"},children:[(0,a.jsx)("span",{"aria-hidden":!0,style:{width:l,height:l,borderRadius:"50%",background:s.solid,flexShrink:0}}),n&&(0,a.jsx)("span",{children:s.label})]})}var ta={feature:ht,chunk:mt,bug:Ft,change:Bt,task:Kt,bet:Lt,"research-task":ut};function aa({kind:t,size:e="sm",showLabel:n=!0}){const r=_e[t];return(0,a.jsx)(X,{meta:r,Icon:ta[t]??W,size:e,showLabel:n,labelOverride:t in _e?void 0:t})}var ra={queen:"☕",overwatch:"🫖",bee:"🍵",sentinel:"🥤",planner:"📋",su:"🛠",mug:"☕",kettle:"🫖",cup:"🍵",papercup:"🥤"};function na({kind:t,size:e="sm",showLabel:n=!0}){const r=re(),s=je[t],l=yt(t),i=l?r(l):t in je?void 0:t;return(0,a.jsx)(X,{meta:s,glyph:ra[t]??"·",size:e,showLabel:n,labelOverride:i})}var we=["open","wip","blocked","needs-human","done","dropped"];function Se(t){try{return JSON.parse(t)}catch{return t}}function sa(t,e,n){return n||!e||!Array.isArray(t)?null:t.filter(r=>r.featureId===e).map(r=>({ts:r.ts,field:r.field,old:r.oldValue?Se(r.oldValue):null,new:r.newValue?Se(r.newValue):null,actor:r.actor??""}))}function ia({slug:t,feature:e,onClose:n,onSaved:r,embedded:s=!1}){const l=ae(),i=e===null,[m,f]=(0,d.useState)(e?.id??""),[o,u]=(0,d.useState)(e?.title??""),[j,g]=(0,d.useState)((e?.claims??[]).join(`
`)),[x,v]=(0,d.useState)(e?.status??"open"),[h,_]=(0,d.useState)(e?.attempts??0),[b,C]=(0,d.useState)(e?.deprecation_reason??""),[w,z]=(0,d.useState)(!1),[p,k]=(0,d.useState)(null),{confirm:$,element:T}=Ie();(0,d.useEffect)(()=>{e&&(f(e.id),u(e.title),g((e.claims??[]).join(`
`)),v(e.status),_(e.attempts),C(e.deprecation_reason??""))},[e]);const I=(0,d.useCallback)(async()=>{z(!0);try{const y=j.split(`
`).map(D=>D.trim()).filter(Boolean);if(x==="dropped"&&b.trim()===""){k('Deprecation reason is required when status is "dropped".'),z(!1);return}if(i){const D=await fetch(`/api/harness/${t}/features`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:m,title:o,claims:y,status:x})});if(!D.ok)throw new Error(`${D.status}: ${await D.text()}`)}else{const D={title:o,claims:y,status:x,attempts:h};x==="dropped"&&(D.deprecation_reason=b.trim());const q=await fetch(`/api/harness/${t}/features/${m}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(D)});if(!q.ok)throw new Error(`${q.status}: ${await q.text()}`)}k("saved"),r(),setTimeout(()=>{n()},400)}catch(y){k(`save failed: ${y}`)}finally{z(!1)}},[t,m,o,j,x,h,i,n,r]),A=(0,d.useCallback)(async()=>{if(e&&await $({title:`Delete feature ${e.id}?`,body:"This cannot be undone.",confirmLabel:"Delete",destructive:!0})){z(!0);try{const y=await fetch(`/api/harness/${t}/features/${e.id}`,{method:"DELETE"});if(!y.ok)throw new Error(`${y.status}: ${await y.text()}`);k("deleted"),r(),setTimeout(()=>{n()},400)}catch(y){k(`delete failed: ${y}`)}finally{z(!1)}}},[t,e,n,r,$]),[N,F]=K("history",tt.withDefault(!1)),[c,S]=(0,d.useState)(null),{data:M}=O({queryName:"featureAudit.byHarness",args:{harnessSlug:t,workspaceId:l},enabled:!i&&!!t}),R=(0,d.useMemo)(()=>sa(M,e?.id,i),[M,i,e?.id]);(0,d.useEffect)(()=>{const y=D=>{(D.metaKey||D.ctrlKey)&&D.key.toLowerCase()==="s"&&(D.preventDefault(),I())};return window.addEventListener("keydown",y),()=>window.removeEventListener("keydown",y)},[I]);const E=(0,a.jsxs)(a.Fragment,{children:[T,(0,a.jsxs)("div",{style:{padding:"0.75rem 1rem",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:"0.75rem"},children:[(0,a.jsx)("strong",{style:{color:"var(--fg)"},children:i?"New feature":`Edit ${e.id}`}),(0,a.jsx)("span",{style:{color:"var(--fg-mute)",fontSize:"0.75rem",fontFamily:"monospace"},title:"Features live in Postgres (harness_features); edits dispatch via /api/harness/<slug>/features",children:"harness_features"}),(0,a.jsxs)("div",{style:{marginLeft:"auto",display:"flex",gap:"0.5rem",alignItems:"center"},children:[p&&(0,a.jsx)("span",{style:{color:/failed/i.test(p)?"var(--bad)":"var(--good)",fontSize:"0.8rem"},children:p}),!i&&(0,a.jsx)("button",{onClick:A,disabled:w,style:{background:"transparent",color:"var(--bad)",border:"1px solid #7f1d1d",borderRadius:3,padding:"0.35rem 0.75rem",cursor:w?"wait":"pointer",fontSize:"0.8rem"},children:"delete"}),(0,a.jsx)("button",{onClick:I,disabled:w||!o.trim()||i&&!m.trim(),style:{background:"#2563eb",color:"white",border:"none",borderRadius:3,padding:"0.35rem 0.9rem",cursor:w?"wait":"pointer",fontWeight:600},children:w?"saving…":"save"}),(0,a.jsx)("button",{onClick:n,style:{background:"transparent",color:"var(--fg-mute)",border:"1px solid var(--border)",borderRadius:3,padding:"0.35rem 0.75rem",cursor:"pointer"},children:"cancel"})]})]}),(0,a.jsxs)("div",{style:{flex:1,overflow:"auto",padding:"1rem",display:"flex",flexDirection:"column",gap:"0.9rem"},children:[(0,a.jsxs)("div",{children:[(0,a.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"ID"}),(0,a.jsx)("input",{value:m,onChange:y=>f(y.target.value.toUpperCase()),disabled:!i,placeholder:"F-NEW-001",style:{width:"100%",boxSizing:"border-box",background:i?"#111827":"#1f2937",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontFamily:"monospace",fontSize:"0.85rem",opacity:i?1:.6}}),i&&(0,a.jsxs)("div",{style:{fontSize:"0.7rem",color:"var(--fg-mute)",marginTop:"0.25rem"},children:["must match ",(0,a.jsx)("code",{children:"^F-[A-Z0-9-]+$"}),". Convention: ",(0,a.jsx)("code",{children:"F-FIX-001"})," for fix features."]})]}),(0,a.jsxs)("div",{children:[(0,a.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Title"}),(0,a.jsx)("textarea",{value:o,onChange:y=>u(y.target.value),rows:2,style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem",resize:"vertical",fontFamily:"system-ui, sans-serif"}})]}),(0,a.jsxs)("div",{children:[(0,a.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Claims — one per line (validation contract IDs)"}),(0,a.jsx)("textarea",{value:j,onChange:y=>g(y.target.value),rows:6,placeholder:`VAL-GRID-001
VAL-GRID-002`,style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.8rem",fontFamily:"ui-monospace, monospace",resize:"vertical"}})]}),(0,a.jsxs)("div",{style:{display:"flex",gap:"1rem"},children:[(0,a.jsxs)("div",{style:{flex:1},children:[(0,a.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Status"}),(0,a.jsx)(he,{value:x,onChange:y=>v(y),ariaLabel:"Status",options:[...we.map(y=>({value:y,label:y})),...we.includes(x)?[]:[{value:x,label:`${x} (legacy)`}]],triggerStyle:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem"}})]}),!i&&(0,a.jsxs)("div",{style:{flex:1},children:[(0,a.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Attempts"}),(0,a.jsx)("input",{type:"number",min:0,value:h,onChange:y=>_(Math.max(0,Math.floor(Number(y.target.value)||0))),style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem"}})]})]}),x==="dropped"&&(0,a.jsxs)("div",{children:[(0,a.jsxs)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:["Deprecation reason ",(0,a.jsx)("span",{style:{color:"var(--bad)"},children:"(required)"})]}),(0,a.jsx)("textarea",{value:b,onChange:y=>C(y.target.value),placeholder:"e.g. The plan no longer asks for JWT cookie rotation; replaced by F-AUTH-012 (session cookies).",rows:3,style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem",fontFamily:"inherit",resize:"vertical"}}),(0,a.jsx)("p",{style:{margin:"0.35rem 0 0",fontSize:"0.7rem",color:"var(--fg-mute)"},children:"Code is not auto-removed when a feature is deprecated; the row stays for audit and is hidden from default queue views."})]}),!i&&(0,a.jsxs)(nt,{open:N,onOpenChange:F,style:{marginTop:"0.5rem",borderTop:"1px solid var(--border)",paddingTop:"0.6rem"},children:[(0,a.jsx)(st,{asChild:!0,children:(0,a.jsxs)("button",{type:"button",style:{cursor:"pointer",fontSize:"0.8rem",color:"var(--fg-mute)",userSelect:"none",background:"none",border:"none",padding:0,textAlign:"left"},children:["History ",R?`(${R.length})`:""]})}),(0,a.jsxs)(it,{style:{marginTop:"0.5rem",fontSize:"0.75rem",maxHeight:240,overflowY:"auto"},children:[c&&(0,a.jsxs)("div",{style:{color:"var(--bad)"},children:["Failed to load: ",c]}),!c&&R===null&&N&&(0,a.jsx)("div",{style:{color:"var(--fg-mute)"},children:"Loading…"}),!c&&R!==null&&R.length===0&&(0,a.jsx)("div",{style:{color:"var(--fg-mute)"},children:"No edit history yet."}),R&&R.length>0&&(0,a.jsx)("div",{style:{display:"flex",flexDirection:"column",gap:"0.25rem"},children:R.map((y,D)=>{const q=H=>H==null?"∅":typeof H=="string"?H.length>40?H.slice(0,37)+"…":H:JSON.stringify(H).slice(0,40);return(0,a.jsxs)("div",{style:{display:"grid",gridTemplateColumns:"11ch 9ch 1fr",gap:"0.5rem",alignItems:"baseline",color:"var(--fg)"},children:[(0,a.jsx)("span",{style:{color:"var(--fg-mute)",fontVariantNumeric:"tabular-nums"},children:new Date(y.ts).toLocaleString(void 0,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}),(0,a.jsx)("span",{style:{color:"#a1a1aa"},children:y.actor}),(0,a.jsxs)("span",{children:[(0,a.jsx)("code",{style:{color:"var(--warn)"},children:y.field}),(0,a.jsx)("span",{style:{color:"var(--fg-mute)"},children:": "}),(0,a.jsx)("span",{style:{color:"var(--fg-mute)"},children:q(y.old)}),(0,a.jsx)("span",{style:{color:"var(--fg-mute)"},children:" → "}),(0,a.jsx)("span",{children:q(y.new)})]})]},D)})})]})]})]})]});return s?(0,a.jsx)("div",{style:{height:"100%",minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg-1, #0b1220)",fontFamily:"system-ui, sans-serif"},children:E}):(0,a.jsx)(Ee,{open:!0,onOpenChange:y=>{y||n()},title:"Edit feature",srOnlyTitle:!0,contentStyle:{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:6,width:"70vw",maxWidth:720,height:"65vh",display:"flex",flexDirection:"column",overflow:"hidden",fontFamily:"system-ui, sans-serif"},children:E})}function Ne(t){if(t){if(Array.isArray(t))return t.map(e=>String(e));if(typeof t=="string")try{const e=JSON.parse(t);if(Array.isArray(e))return e.map(n=>String(n))}catch{}}}function la(t){if(t==null)return;let e;if(Array.isArray(t))e=t;else if(typeof t=="string"){const r=t.trim();if(!r||r==="{}"||r==="[]")return;if(r.startsWith("{")&&r.endsWith("}"))e=r.slice(1,-1).split(",");else try{const s=JSON.parse(r);e=Array.isArray(s)?s:[]}catch{return}}else return;const n=e.map(r=>typeof r=="number"?r:Number.parseInt(String(r).trim(),10)).filter(r=>Number.isInteger(r)&&r>0);return n.length>0?n:void 0}function oa(t){const e=ae(),[n,r]=(0,d.useState)(null),[s,l]=(0,d.useState)(null),{data:i,loading:m,error:f}=O({queryName:"featuresConsolidated.bySlug",args:t?{harnessSlug:t,workspaceId:e}:void 0,enabled:!!t});(0,d.useEffect)(()=>{if(!t){r(null),l(null);return}m||!Array.isArray(i)||r(i.map(u=>({id:u.featureId,title:u.title,summary:u.summary??void 0,status:u.status,attempts:Number(u.attempts)||0,claims:Ne(u.claims),sourcePlanSlug:u.sourcePlanSlug??void 0,needsReview:u.needsHumanReview??u.needs_human_review??void 0,tags:Ne(u.tags),workingUsers:la(u.workingUsers??u.working_users)})))},[t,i,m]),(0,d.useEffect)(()=>{l(f?f instanceof Error?f.message:String(f):null)},[f]);const o=(0,d.useCallback)((u,j)=>{r(g=>g&&g.map(x=>x.id===u?{...x,...j}:x))},[]);return{features:n,loading:n===null&&!s,error:s,patchFeature:o}}function da(t){const e=typeof t.foundAt=="number"?t.foundAt:Date.parse(String(t.foundAt));return{id:t.issueId,title:t.title,severity:t.severity,source:t.source,status:t.status,foundAt:Number.isFinite(e)?new Date(e).toISOString():"",foundDuring:t.foundDuring??void 0,repro:t.repro??void 0,evidence:t.evidence??void 0,suggestedFix:t.suggestedFix??void 0,codePointer:t.codePointer??void 0,linkedFeatureId:t.linkedFeatureId??void 0,attempts:Number(t.attempts)||0,notes:Array.isArray(t.notes)?t.notes:[]}}function ca(t){const e=ae(),[n,r]=(0,d.useState)(null),[s,l]=(0,d.useState)(null),{data:i,loading:m,error:f}=O({queryName:"issuesConsolidated.bySlug",args:t?{harnessSlug:t,workspaceId:e}:void 0,enabled:!!t});(0,d.useEffect)(()=>{if(!t){r(null),l(null);return}m||!Array.isArray(i)||r(i.map(da))},[t,i,m]),(0,d.useEffect)(()=>{l(f?f instanceof Error?f.message:String(f):null)},[f]);const{data:o}=O({queryName:"harnessPendingIssues.byHarness",args:t?{harnessSlug:t,phase:"staging",workspaceId:e}:void 0,enabled:!!t}),u=Array.isArray(o)?o.length:0,j=(0,d.useCallback)((g,x)=>{r(v=>v&&v.map(h=>h.id===g?{...h,...x}:h))},[]);return{issues:n,pendingCount:u,loading:n===null&&!s,error:s,patchIssue:j}}function Ce(t){if(t==null)return;if(typeof t=="number")return t;const e=Date.parse(String(t));return Number.isFinite(e)?e:void 0}function yr(t){const[e,n]=(0,d.useState)(null),[r,s]=(0,d.useState)(null),{data:l,loading:i,error:m,invalidate:f}=O({queryName:"agentRunsConsolidated.bySlug",args:t?{harnessSlug:t}:void 0,enabled:!!t}),o=(0,d.useCallback)(()=>f(),[f]);return(0,d.useEffect)(()=>{if(!t){n(null),s(null);return}i||!Array.isArray(l)||n(l.map(u=>({runId:u.runId,role:u.role,ts:Ce(u.ts),sizeBytes:Number(u.sizeBytes)||0,running:!!u.running,lastEventTs:Ce(u.lastEventTs),costUsd:u.costUsd!=null?Number(u.costUsd):void 0,featureId:u.featureId??void 0})))},[t,l,i]),(0,d.useEffect)(()=>{s(m?m instanceof Error?m.message:String(m):null)},[m]),{agents:e,total:Array.isArray(l)?De(l):e?.length??0,loading:e===null&&!r,error:r,refresh:o}}function _r(t,e=300){const[n,r]=(0,d.useState)(null),[s,l]=(0,d.useState)(null),[i,m]=(0,d.useState)(0),f=(0,d.useCallback)(()=>m(o=>o+1),[]);return(0,d.useEffect)(()=>{if(!t){r(null);return}let o=!1;return l(null),fetch(`/api/harness/${encodeURIComponent(t)}/log/history?limit=${e}&phase=staging`).then(u=>u.ok?u.json():Promise.reject(new Error(`log/history ${u.status}`))).then(u=>{o||r(Array.isArray(u.events)?u.events:[])}).catch(u=>{o||l(u.message)}),()=>{o=!0}},[t,e,i]),{events:n,loading:n===null&&!s,error:s,refresh:f}}async function $e(t,e){const n=await fetch(t,{method:"POST",headers:e!==void 0?{"content-type":"application/json"}:void 0,body:e!==void 0?JSON.stringify(e):void 0});if(!n.ok)throw new Error(`${n.status}: ${await n.text()}`)}function Ve(t){switch(t){case"acknowledge":return"acknowledged";case"close":return"closed";case"wontfix":return"wontfix";default:return null}}async function ua(t,e,n){const r=`/api/harness/${encodeURIComponent(t)}/issues/${encodeURIComponent(e)}`;n==="promote"?await $e(`${r}/promote`,{}):await $e(`${r}/update`,{status:Ve(n)})}function pa(t){return at({parse:e=>Et(e,t),serialize:e=>de(e),eq:(e,n)=>de(e)===de(n)}).withDefault({})}function ma(t,e,n){const{ns:r}=n,s=(0,d.useMemo)(()=>pa(t),[t]),[l,i]=K(r+"f",s),m=(0,d.useMemo)(()=>t.filter(h=>!!h.filter),[t]),f=(0,d.useMemo)(()=>wt(e,l,t),[e,l,t]),o=(0,d.useCallback)((h,_)=>{i(b=>({...b??{},[h]:_}))},[i]),u=(0,d.useCallback)(h=>{i(_=>{if(!_||!(h in _))return _;const b={..._};return delete b[h],b})},[i]),j=(0,d.useCallback)(()=>{i(null)},[i]),g=(0,d.useMemo)(()=>{const h=new Map;for(const _ of m)_.filter?.type==="enum"&&h.set(_.key,St(e,_));return h},[m,e]),x=(0,d.useMemo)(()=>({filterableColumns:m,valueFor:h=>l?.[h],setValue:o,remove:u,optionsFor:h=>g.get(h)??[]}),[m,l,o,u,g]),v=(0,d.useMemo)(()=>{if(!l)return[];const h=[];for(const _ of m){const b=l[_.key];if(b===void 0)continue;const C=Rt(_,b);C&&h.push({colKey:_.key,label:C,clear:()=>u(_.key)})}return h},[l,m,u]);return{rows:f,controller:x,activeChips:v,clearAll:j,hasActive:v.length>0}}var ce="_add_filter_";function B(t){const e=t.header;return typeof e=="string"&&e.length>0?e:typeof e=="number"?String(e):typeof t.headerText=="string"&&t.headerText.length>0?t.headerText:t.key}var fa={display:"flex",flexDirection:"column",gap:8,minWidth:200,maxWidth:280,padding:10,background:"color-mix(in srgb, var(--bg-deeper, #0b1622), transparent 2%)",color:"var(--fg, #e7f7ff)",border:"1px solid color-mix(in oklab, var(--accent, #38bdf8), transparent 62%)",borderRadius:10,boxShadow:"0 18px 54px rgba(0,0,0,0.62)",fontSize:12},ha={fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--fg-mute, #7f9bb4)"},ga={display:"flex",alignItems:"center",gap:6},va=8,xa={display:"flex",flexDirection:"column",gap:4,maxHeight:220,overflowY:"auto"},ba={width:"100%",padding:"4px 7px",fontSize:12,fontFamily:"inherit",color:"var(--fg, #e7f7ff)",background:"var(--bg-2, rgba(255,255,255,0.045))",border:"1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%))",borderRadius:6},ya={display:"flex",alignItems:"center",gap:8,fontSize:10.5,color:"var(--fg-mute, #7f9bb4)"},_a={display:"flex",alignItems:"center",gap:8,cursor:"pointer"},ja={marginLeft:"auto",color:"var(--fg-mute, #7f9bb4)",fontVariantNumeric:"tabular-nums"},Ae={width:70,padding:"4px 7px",fontSize:12,fontFamily:"inherit",color:"var(--fg, #e7f7ff)",background:"var(--bg-2, rgba(255,255,255,0.045))",border:"1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%))",borderRadius:6};function ka(t){return typeof t=="string"?t:""}function fe(t){return Array.isArray(t)?t:[]}function wa(t){return t&&typeof t=="object"&&!Array.isArray(t)?t:{}}function Sa(t){return typeof t=="boolean"?t:void 0}function Na({col:t,controller:e,onClose:n}){const[r,s]=(0,d.useState)(""),l=t.filter;if(!l)return null;const i=e.valueFor(t.key),m=o=>{o.key==="Enter"&&(o.preventDefault(),n())};if(l.type==="text")return(0,a.jsx)("input",{type:"text",className:"pc-advpanel__input",autoFocus:!0,value:ka(i),onChange:o=>e.setValue(t.key,o.target.value),onKeyDown:m,placeholder:`Filter ${B(t)}…`,"aria-label":`Filter ${B(t)}`,style:{width:"100%"}});if(l.type==="enum"){const o=e.optionsFor(t.key),u=fe(i),j=l.multi!==!1,g=(b,C)=>{if(!j){e.setValue(t.key,C?[b]:[]);return}const w=C?[...u,b]:u.filter(z=>z!==b);e.setValue(t.key,w)},x=o.length>va,v=r.trim().toLowerCase(),h=v?o.filter(b=>(b.label??b.value).toLowerCase().includes(v)):o,_=B(t);return(0,a.jsxs)("div",{style:{display:"flex",flexDirection:"column",gap:6},children:[x?(0,a.jsx)("input",{type:"text",className:"pc-advpanel__input",autoFocus:!0,value:r,onChange:b=>s(b.target.value),placeholder:`Search ${_}…`,"aria-label":`Search ${_} options`,style:ba}):null,x&&u.length>0?(0,a.jsxs)("div",{style:ya,children:[(0,a.jsxs)("span",{children:[u.length," selected"]}),(0,a.jsx)("button",{type:"button",className:"pc-advpanel__chip",style:{marginLeft:"auto",fontSize:10.5},onClick:()=>e.setValue(t.key,[]),children:"Clear selection"})]}):null,(0,a.jsx)("div",{style:xa,children:o.length===0?(0,a.jsx)("span",{style:{color:"var(--fg-mute, #7f9bb4)"},children:"No values"}):h.length===0?(0,a.jsx)("span",{style:{color:"var(--fg-mute, #7f9bb4)"},children:"No matches"}):h.map(b=>(0,a.jsxs)("label",{style:_a,children:[(0,a.jsx)(pt,{checked:u.includes(b.value),onChange:C=>g(b.value,C),ariaLabel:b.label??b.value}),(0,a.jsx)("span",{children:b.label??b.value}),(0,a.jsx)("span",{style:ja,children:b.count})]},b.value))})]})}if(l.type==="number"){const o=wa(i),u=(j,g)=>{const x={...o};if(g==="")delete x[j];else{const v=Number(g);if(Number.isNaN(v))return;x[j]=v}e.setValue(t.key,x)};return(0,a.jsxs)("div",{style:ga,children:[(0,a.jsx)("input",{type:"number",style:Ae,value:o.min??"",onChange:j=>u("min",j.target.value),onKeyDown:m,placeholder:"min","aria-label":`${B(t)} minimum`}),(0,a.jsx)("span",{style:{color:"var(--fg-mute, #7f9bb4)"},children:"–"}),(0,a.jsx)("input",{type:"number",style:Ae,value:o.max??"",onChange:j=>u("max",j.target.value),onKeyDown:m,placeholder:"max","aria-label":`${B(t)} maximum`})]})}const f=Sa(i);return(0,a.jsx)("div",{style:{display:"flex",gap:6},children:[{label:"True",val:!0},{label:"False",val:!1}].map(o=>(0,a.jsx)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":f===o.val,onClick:()=>e.setValue(t.key,o.val),children:o.label},o.label))})}function Ca({controller:t,activeChips:e,hasActive:n,clearAll:r,layout:s="compact",inlineMax:l=8,promote:i}){const m=et(rt.GRID_COLUMN_FILTERS),[f,o]=(0,d.useState)(null);if(!m)return null;const u=new Set(e.map(p=>p.colKey)),j=t.filterableColumns.filter(p=>!u.has(p.key)),g=t.filterableColumns.find(p=>p.key===f)??null,x=new Map(e.map(p=>[p.colKey,p.label])),v=p=>{setTimeout(()=>o(p),0)},h=(p,k,$,T)=>{const I=fe(t.valueFor(p));if(!T){t.setValue(p,$?[k]:[]);return}t.setValue(p,$?[...I,k]:I.filter(A=>A!==k))},_=(0,a.jsx)(gt,{open:g!=null,onOpenChange:p=>{p||o(null)},trigger:(0,a.jsx)("span",{"aria-hidden":!0,style:{width:0,height:0}}),side:"bottom",align:"start",ariaLabel:g?`Edit ${B(g)} filter`:"Edit filter",autoFocusOnOpen:!0,contentStyle:fa,children:g?(0,a.jsxs)(a.Fragment,{children:[(0,a.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:8},children:[(0,a.jsx)("span",{style:ha,children:B(g)}),(0,a.jsx)("button",{type:"button",className:"pc-advpanel__iconbtn",style:{marginLeft:"auto",width:22,height:22},"aria-label":"Close filter editor",onClick:()=>o(null),children:(0,a.jsx)(ye,{size:12})})]}),(0,a.jsx)(Na,{col:g,controller:t,onClose:()=>o(null)},g.key)]}):null});if(s==="facets")return(0,a.jsxs)("div",{className:"pc-advpanel__filterbar pc-advpanel__filterbar--facets",children:[t.filterableColumns.map(p=>{const k=p.filter,$=k?.type==="enum",T=fe(t.valueFor(p.key)),I=$?t.optionsFor(p.key):[],A=B(p);if($&&I.length>0&&I.length<=l){const F=k?.type==="enum"?k.multi!==!1:!0;return(0,a.jsxs)("div",{className:"pc-advpanel__facetgroup",children:[(0,a.jsx)("span",{className:"pc-advpanel__facetlabel",children:A}),I.map(c=>{const S=T.includes(c.value);return(0,a.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":S,onClick:()=>h(p.key,c.value,!S,F),children:[(0,a.jsx)("span",{children:c.label??c.value}),(0,a.jsx)("span",{className:"pc-advpanel__chipcount",children:c.count})]},c.value)})]},p.key)}const N=u.has(p.key);return(0,a.jsx)(L,{label:N?"Edit filter":`Filter by ${A}`,children:(0,a.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":N,onClick:()=>v(p.key),children:[N?x.get(p.key)??A:A,(0,a.jsx)(be,{size:11,"aria-hidden":!0})]})},p.key)}),n?(0,a.jsx)("button",{type:"button",className:"pc-advpanel__chip",onClick:r,children:"Clear all"}):null,_]});const b=new Set(i??[]),C=t.filterableColumns.filter(p=>b.has(p.key)&&!u.has(p.key)),w=new Set(C.map(p=>p.key)),z=[{value:ce,label:"Add filter…",disabled:!0},...j.filter(p=>!w.has(p.key)).map(p=>({value:p.key,label:B(p)}))];return(0,a.jsxs)("div",{className:"pc-advpanel__filterbar",children:[(0,a.jsx)(Jt,{size:13,"aria-hidden":!0,style:{color:"var(--fg-mute, #7f9bb4)",flexShrink:0}}),C.map(p=>{const k=B(p);return(0,a.jsx)(L,{label:`Filter by ${k}`,children:(0,a.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":!1,onClick:()=>v(p.key),children:[k,(0,a.jsx)(be,{size:11,"aria-hidden":!0})]})},p.key)}),e.map(p=>(0,a.jsx)(L,{label:"Edit filter",children:(0,a.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":!0,onClick:()=>v(p.colKey),children:[p.label,(0,a.jsx)(ye,{size:11,"aria-label":`Remove ${p.label} filter`,onClick:k=>{k.stopPropagation(),f===p.colKey&&o(null),p.clear()}})]})},p.colKey)),j.length>0?(0,a.jsx)(he,{value:ce,onChange:p=>{p!==ce&&v(p)},ariaLabel:"Add a column filter",triggerClassName:"pc-advpanel__chip",options:z}):null,n?(0,a.jsx)("button",{type:"button",className:"pc-advpanel__chip",onClick:r,children:"Clear all"}):null,_]})}var $a=(0,d.memo)(Ca);function V(t){return t.toLocaleString("en-US")}function Aa(t,e,n,r="item"){return n?{title:`${V(t)} of ${V(e)}`,summary:`${V(t)} of ${V(e)} match`}:{title:V(e),summary:`${V(e)} ${r}${e===1?"":"s"}`}}function Ke(t){if(t.origin!=="remote")return null;const e=t.verifiedAuthorGithubUserId!=null?`GitHub user ${t.verifiedAuthorGithubUserId}`:"an unverified author";return t.trusted?{label:"trusted",color:"#34d399",title:`Remote work by ${e}, on your trust list — verified remote work auto-runs.`}:t.auditVerdict==="reject"?{label:"rejected",color:"#fb7185",title:`Remote work by ${e} — the admission auditor rejected it.`}:t.auditVerdict==="admit"?{label:"admitted",color:"var(--accent-strong, var(--accent))",title:`Remote work by ${e} — admitted by the auditor${t.verifiedAuthorGithubUserId!=null?" (author not on your trust list)":""}.`}:{label:"pending audit",color:"#fcd34d",title:`Remote work by ${e} — awaiting the admission verdict; not auto-running yet.`}}function Ea(t){const e=Ke(t);return e?(0,a.jsx)("span",{style:{display:"inline-block",padding:"1px 8px",borderRadius:999,fontSize:10,fontWeight:700,textTransform:"uppercase",whiteSpace:"nowrap",color:e.color,background:`color-mix(in srgb, ${e.color}, transparent 85%)`},title:e.title,children:e.label}):null}var G={display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"};function Ge({isTrusted:t}){return[{key:"id",header:"ID",width:1.4,toCopyText:e=>e.id,filter:{type:"text",accessor:e=>e.id},render:({row:e})=>(0,a.jsx)("code",{style:G,title:e.id,children:e.id})},{key:"kind",header:"Kind",width:1.2,toCopyText:e=>e.kind,filter:{type:"enum",accessor:e=>e.kind},render:({row:e})=>(0,a.jsx)(aa,{kind:e.kind,size:"xs"})},{key:"title",header:"Title",width:4,toCopyText:e=>e.title,filter:{type:"text",accessor:e=>e.title},render:({row:e})=>(0,a.jsx)("span",{style:G,title:e.title,children:e.title})},{key:"state",header:"State",width:1.2,toCopyText:e=>e.state,filter:{type:"enum",accessor:e=>e.state},render:({row:e})=>e.family==="issue"?(0,a.jsx)(ve,{status:e.state,size:"xs",variant:"chip"}):(0,a.jsx)(te,{status:e.state,size:"xs",variant:"chip"})},{key:"trust",header:"Trust",width:1.3,toCopyText:e=>Ke({origin:e.origin,auditVerdict:e.auditVerdict,verifiedAuthorGithubUserId:e.verifiedAuthorGithubUserId,trusted:t(e)})?.label??"",render:({row:e})=>(0,a.jsx)(Ea,{origin:e.origin,auditVerdict:e.auditVerdict,verifiedAuthorGithubUserId:e.verifiedAuthorGithubUserId,trusted:t(e)})},{key:"stage",header:"Stage",width:1.7,toCopyText:e=>e.spineRole?`${e.spineRole}${e.spineStatus?` (${e.spineStatus})`:""}`:"",filter:{type:"enum",accessor:e=>e.spineRole},render:({row:e})=>e.spineRole?(0,a.jsxs)("span",{style:G,title:`latest spine role · status (spawned_agents): ${e.spineRole}${e.spineStatus?` (${e.spineStatus})`:""}`,children:[e.spineRole,e.spineStatus?(0,a.jsxs)("span",{style:{color:"var(--fg-mute)"},children:[" (",e.spineStatus,")"]}):null]}):(0,a.jsx)(a.Fragment,{children:"—"})},{key:"assignee",header:"Assignee",width:1.8,toCopyText:e=>e.assignee??"",filter:{type:"enum",accessor:e=>e.assignee},render:({row:e})=>(0,a.jsxs)("span",{style:G,title:e.assignee?`${e.assignee}${e.assignedBy?` — delegated by ${e.assignedBy}`:""}`:void 0,children:[e.assignee??"—",e.assignedBy?(0,a.jsxs)("span",{style:{color:"var(--fg-mute)"},children:[" ·by ",e.assignedBy]}):null]})},{key:"severity",header:"Sev",width:.9,toCopyText:e=>e.severity??"",filter:{type:"enum",accessor:e=>e.severity},render:({row:e})=>e.severity?(0,a.jsx)(ge,{severity:e.severity,size:"xs"}):(0,a.jsx)(a.Fragment,{children:"—"})},{key:"priority",header:"Prio",width:.8,toCopyText:e=>e.priority==null?"":String(e.priority),filter:{type:"number",accessor:e=>e.priority},render:({row:e})=>(0,a.jsx)(a.Fragment,{children:e.priority??"—"})},{key:"rank",header:"Rank",width:.8,toCopyText:e=>e.rank==null?"":String(e.rank),filter:{type:"number",accessor:e=>e.rank},render:({row:e})=>(0,a.jsx)(a.Fragment,{children:e.rank??"—"})},{key:"plan",header:"Plan",width:1.8,toCopyText:e=>e.planSlug??"",filter:{type:"enum",accessor:e=>e.planSlug},render:({row:e})=>e.planSlug?(0,a.jsx)("code",{style:{...G,fontSize:11},title:e.planSlug,children:e.planSlug}):(0,a.jsx)(a.Fragment,{children:"—"})}]}function jr(){return Ge({isTrusted:()=>!1}).map(t=>({key:t.key,header:t.header,width:t.width,filter:t.filter,render:t.render}))}var Ia=[];function kr({params:t,api:e}){const n=t.harnessSlug||"",[r,s]=K("wq",ee.withDefault("")),[l,i]=K("sel",ee.withDefault("")),[m,f]=jt("pc-colw:adv:work-items"),o=500,[u,j]=(0,d.useState)(o);(0,d.useEffect)(()=>{j(o)},[n]);const g=O({queryName:"workItems.byHarness",args:{harnessSlug:n,limit:u},enabled:!!n}),x=g.loading?null:g.data,v=g.fetching,h=g.error?g.error.message:null,_=O({queryName:"trust.list"}),b=(0,d.useMemo)(()=>new Set((_.data??[]).map(N=>N.githubUserId)),[_.data]),C=De(x),w=x!=null&&x.length<C,z=(0,d.useCallback)(()=>j(N=>N+o),[]),p=(0,d.useMemo)(()=>Ge({isTrusted:N=>N.verifiedAuthorGithubUserId!=null&&b.has(N.verifiedAuthorGithubUserId)}),[b]),k=ma(p,x??Ia,{ns:"wi"}),$=(0,d.useMemo)(()=>{const N=r.trim().toLowerCase();return N?k.rows.filter(F=>`${F.id} ${F.title} ${F.state} ${F.assignee??""}`.toLowerCase().includes(N)):k.rows},[k.rows,r]),T=k.hasActive||r.trim()!=="",I=x?Aa($.length,C,T):null,A=I?.title;return(0,d.useEffect)(()=>{A!=null&&e.setTitle(`Work items · ${n} (${A})`)},[A,n,e]),n?(0,a.jsxs)("div",{className:"pc-advpanel",children:[(0,a.jsxs)("div",{className:"pc-advpanel__bar",children:[(0,a.jsx)("input",{type:"text",className:"pc-advpanel__input",value:r,onChange:N=>{s(N.target.value)},placeholder:"Filter work items…","aria-label":"Filter work items"}),(0,a.jsx)($a,{controller:k.controller,activeChips:k.activeChips,hasActive:k.hasActive,clearAll:k.clearAll}),I?(0,a.jsx)(L,{label:T?"Rows matching the current filter / search, out of the store total.":"Total work items for this harness.",children:(0,a.jsx)("span",{className:"pc-advpanel__count","data-testid":"wi-count","aria-live":"polite",style:{marginLeft:"auto",fontSize:11,color:"var(--fg-mute)",whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"},children:I.summary})}):null,(0,a.jsx)(L,{label:"Refresh work items",children:(0,a.jsx)("button",{type:"button",className:"pc-advpanel__iconbtn",onClick:()=>g.invalidate(),disabled:v,"aria-label":"Refresh work items",children:(0,a.jsx)(ft,{size:13,"aria-hidden":!0,className:v?"pc-advpanel__spin":void 0})})})]}),h?(0,a.jsxs)("div",{className:"pc-advpanel__empty pc-advpanel__empty--err",children:["Could not load work items: ",h]}):x?$.length===0?(0,a.jsx)("div",{className:"pc-advpanel__empty",children:x.length===0?"No work items for this harness.":"No work items match the filter."}):(0,a.jsx)(Ze,{columns:p,rows:$,resizableColumns:!0,columnWidths:m,onColumnWidthsChange:f,getRowId:N=>N.id,onRowClick:N=>{i(N.id)},getRowBg:N=>N.id===l?"color-mix(in oklab, var(--accent), transparent 80%)":void 0,rowMinHeight:30,headerHeight:30,onEndReached:w?z:void 0}):(0,a.jsx)("div",{className:"pc-advpanel__empty",children:"Loading work items…"})]}):(0,a.jsx)("div",{className:"pc-advpanel__empty",children:"Pick a harness to view its work items."})}function Ta(t){const e=t.spawnStatus?.trim()||null,n=t.errorMessage?.trim()||void 0;switch(e){case"done":return{kind:"done",label:"done"};case"failed":return{kind:"failed",label:`failed${t.exitCode!=null&&t.exitCode!==0?` (exit ${t.exitCode})`:""}`,detail:n};case"cancelled":return{kind:"cancelled",label:"cancelled",detail:n};case"reaped":return{kind:"muted",label:"reaped",detail:n};case"running":case"restarting":return{kind:"running",label:e};default:return t.running?{kind:"running",label:"running"}:null}}var Ra=["open","wip","blocked","needs-human","done","dropped"],J=[],ue=!1;async function za(t,e){try{const n=await fetch("/api/adv/sessions/launch-su",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agent:"claude",harness_slug:t,resume_session_id:e})}),r=await n.json().catch(()=>({}));if(!n.ok||r.status==="error")throw new Error(r.error||`${n.status}`);P.success(`Session ${e.slice(0,12)}… opening in a terminal.`)}catch(n){P.error("Open session failed",{description:String(n)})}}function xe(t){const e=typeof t=="number"?t:Date.parse(String(t));if(!Number.isFinite(e))return"";const n=Math.max(0,Math.round((Date.now()-e)/1e3));if(n<60)return`${n}s ago`;const r=Math.round(n/60);if(r<60)return`${r}m ago`;const s=Math.round(r/60);return s<24?`${s}h ago`:`${Math.round(s/24)}d ago`}function Fa(t){return t.trim()?t.split(/^## \S+ \d{4}-\d{2}-\d{2}T[^\n]+\s*$/gm).map(e=>e.trim()).filter(Boolean):[]}function Ma(t){return t?t.startsWith("F-")?"feature":t.startsWith("I-")?"issue":t.startsWith("agent:")?"agent":"workItem":null}function wr({params:t,api:e}){const n=re(),r=t.harnessSlug||"",s=t.itemId||null,[l,i]=K("sel",ee.withDefault("")),[m,f]=K("edit",ee.withDefault("")),o=s??l,{features:u,patchFeature:j}=oa(r),{issues:g,patchIssue:x}=ca(r),{data:v}=O({queryName:"agentRunsConsolidated.bySlug",args:r?{harnessSlug:r}:void 0,enabled:!!r}),h=(0,d.useCallback)(E=>{i(E||null),f(null)},[i,f]),_=(0,d.useRef)("");(0,d.useEffect)(()=>{if(s)return;if(ue){ue=!1,_.current=l;return}const E=_.current;E&&E!==l&&(J.push(E),J.length>50&&J.shift()),_.current=l},[l,s]);const b=(0,d.useCallback)(()=>{const E=J.pop();E!==void 0&&(ue=!0,i(E||null))},[i]),C=!s&&J.length>0?b:void 0,w=(0,d.useMemo)(()=>Ma(o),[o]),z=ae(),p=O({queryName:"featuresConsolidated.detail",args:{harnessSlug:r,featureId:w==="feature"?o:"",workspaceId:z},enabled:!!r&&w==="feature"&&!!o}),k=!p.loading&&p.data?.[0]?.featureId===o?p.data[0].summary??void 0:void 0,$=(0,d.useMemo)(()=>{if(w!=="feature")return null;const E=(u??[]).find(y=>y.id===o)??null;return E?k!==void 0?{...E,summary:k}:E:null},[w,u,o,k]),T=(0,d.useMemo)(()=>w==="issue"?(g??[]).find(E=>E.id===o)??null:null,[w,g,o]),I=O({queryName:"workItems.byHarness",args:{harnessSlug:r,limit:500},enabled:!!r&&w==="workItem"}),A=I.loading?null:I.data,N=O({queryName:"workItems.detail",args:{harnessSlug:r,id:w==="workItem"?o:""},enabled:!!r&&w==="workItem"&&!!o}),F=N.loading?null:N.data?.[0]??null,c=(0,d.useMemo)(()=>{if(w!=="workItem")return null;const E=(A??[]).find(y=>y.id===o)??null;return F&&F.id===o?F:E},[w,A,F,o]),S=O({queryName:"fleetAssignments.byHarness",args:{harnessSlug:r},enabled:!!r&&w==="agent"}),M=S.loading?null:S.data,R=(0,d.useMemo)(()=>w==="agent"?(M??[]).find(E=>`agent:${E.agentId}`===o)??null:null,[w,M,o]);return(0,d.useEffect)(()=>{s?e.setTitle(s):$?e.setTitle(`Detail · ${$.id}`):T?e.setTitle(`Detail · ${T.id}`):c?e.setTitle(`Detail · ${c.id}`):R?e.setTitle(`Detail · ${Me(R.name??R.label??R.agentId,n)}`):e.setTitle("Detail")},[e,s,$,T,c,R,n]),r?o?o&&!$&&!T&&!c&&!R?u===null||g===null||w==="workItem"&&A===null||w==="agent"&&M===null?(0,a.jsxs)(Y,{children:["Loading ",o,"…"]}):w==="agent"?(0,a.jsxs)(Y,{children:["Agent ",o.slice(6)," is no longer working here."]}):(0,a.jsxs)(Y,{tone:"error",children:["No item found for ",o,"."]}):$?(0,a.jsx)(Pa,{slug:r,feature:$,issues:g??[],runs:Array.isArray(v)?v:[],onSelect:h,onBack:C,patchFeature:j,isEditing:!s&&m===$.id,onStartEdit:()=>{f($.id)},onCloseEdit:()=>{f(null)}}):T?(0,a.jsx)(Oa,{slug:r,issue:T,onSelect:h,onBack:C,patchIssue:x}):c?(0,a.jsx)(Je,{slug:r,workItem:c,onSelect:h,onBack:C}):R?(0,a.jsx)(Da,{agent:R,onSelect:h,onBack:C}):null:(0,a.jsx)(Y,{children:"Pick a work item from the list to inspect."}):(0,a.jsxs)(Y,{children:["Pick a ",n("pot",{lower:!0})," to inspect its work items."]})}function Da({agent:t,onSelect:e,onBack:n}){const r=re(),s=lt(t.heartbeatAt??""),l=i=>!!i&&(i.startsWith("F-")||i.startsWith("I-")||i.startsWith("WI-"));return(0,a.jsxs)("div",{className:"pc-adv-detail pc-adv-detail--compact",children:[(0,a.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,a.jsx)(se,{onBack:n}),(0,a.jsx)("div",{className:"pc-adv-detail__id",children:t.agentId}),(0,a.jsx)("div",{className:"pc-adv-detail__title",children:Me(t.name??t.label??t.agentId,r)}),(0,a.jsxs)("div",{className:"pc-adv-detail__meta",children:[(0,a.jsx)(na,{kind:t.agentPaneKind,size:"xs"}),(0,a.jsxs)("span",{className:"pc-adv-detail__liveness",children:[(0,a.jsx)(ot,{liveness:s,title:""}),s,t.heartbeatAt?(0,a.jsxs)("span",{className:"pc-adv-detail__muted",children:[" · heartbeat ",xe(t.heartbeatAt)]}):null]}),t.driveMode?(0,a.jsxs)("span",{className:"pc-adv-detail__stat",children:["drive: ",t.driveMode]}):null,t.load>0?(0,a.jsxs)("span",{className:"pc-adv-detail__stat",children:["load: ",t.load]}):null,t.orphaned&&(0,a.jsx)(L,{label:"This agent holds claims but is no longer present — its work may need re-placing.",children:(0,a.jsx)("span",{className:"pc-adv-detail__warn-chip",children:"orphaned claims"})}),t.declaredUnclaimed&&(0,a.jsx)(L,{label:"Declared an intent without claiming items — invisible to fleet placement.",children:(0,a.jsx)("span",{className:"pc-adv-detail__warn-chip",children:"declared, unclaimed"})})]})]}),(0,a.jsxs)("section",{className:"pc-adv-detail__body",children:[t.intent?(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Intent"}),(0,a.jsx)("p",{className:"pc-adv-detail__prose",children:t.intent})]}):null,(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Working on"}),t.doing?(0,a.jsxs)("div",{className:"pc-adv-detail__related",children:[(0,a.jsx)(L,{label:t.doing.title,children:(0,a.jsxs)("button",{type:"button","data-testid":"agent-detail-doing",className:"pc-adv-detail__related-row",disabled:!l(t.doing.id),onClick:()=>l(t.doing.id)&&e(t.doing.id),children:[(0,a.jsx)("span",{className:"pc-adv-detail__related-id",children:t.doing.id}),(0,a.jsx)("span",{className:"pc-adv-detail__related-title",children:t.doing.title})]})}),t.queued.length>0&&(0,a.jsx)("div",{className:"pc-adv-detail__queue",children:t.queued.map((i,m)=>(0,a.jsx)("button",{type:"button",className:"pc-adv-detail__queue-chip",disabled:!l(i.id),onClick:()=>l(i.id)&&e(i.id),children:i.id},`${i.id}-${m}`))})]}):(0,a.jsx)("p",{className:"pc-adv-detail__muted",children:"Nothing claimed right now."})]}),t.claims.length>0&&(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsxs)("h3",{children:["Claims (",t.claims.length,")"]}),(0,a.jsx)("div",{className:"pc-adv-detail__related",children:t.claims.map((i,m)=>(0,a.jsxs)("div",{className:"pc-adv-detail__claim-row",children:[(0,a.jsx)("span",{className:"pc-adv-detail__related-id",children:l(i.id)?(0,a.jsx)("button",{type:"button",className:"pc-adv-detail__link pc-adv-detail__link-btn",onClick:()=>e(i.id),children:i.id}):i.id??i.type}),(0,a.jsx)("span",{className:"pc-adv-detail__claim-type",children:i.type}),(0,a.jsx)("span",{className:"pc-adv-detail__related-title",title:i.detail,children:i.detail})]},`${i.id??i.detail}-${m}`))})]})]}),(0,a.jsx)(ie,{})]})}function Je({slug:t,workItem:e,onSelect:n,onBack:r,onOpenChat:s}){const[l,i]=(0,d.useState)(!1),m=async()=>{i(!0);try{const o=await qe({slug:t,role:"worker",featureId:e.id,title:e.title,mode:"discuss",...s?{dispatch:!1}:{}});if(o&&typeof o=="object"&&"error"in o)throw new Error(String(o.error));s&&o&&typeof o=="object"&&"chatId"in o&&s(String(o.chatId))}catch(o){P.error("Open chat failed",{description:String(o)})}finally{i(!1)}},f=[["Kind",(0,a.jsxs)(a.Fragment,{children:[(0,a.jsx)("span",{className:"pc-adv-detail__kind-chip",children:e.kind})," ",(0,a.jsxs)("span",{className:"pc-adv-detail__muted",children:["(",e.family," family)"]})]})],["State",e.family==="issue"?(0,a.jsx)(ve,{status:e.state,size:"xs"}):(0,a.jsx)(te,{status:e.state,size:"xs"})],["Severity",e.severity?(0,a.jsx)(ge,{severity:e.severity,size:"xs"}):"—"],["Assignee",e.assignee?`${e.assignee}${e.assignedBy?` · by ${e.assignedBy}`:""}`:"—"],["Priority",e.priority??"—"],["Rank",e.rank??"—"],["Stage",e.spineRole?`${e.spineRole}${e.spineStatus?` (${e.spineStatus})`:""}`:"—"],["Updated",e.updatedAt?(0,a.jsx)("span",{title:new Date(e.updatedAt).toLocaleString(),children:xe(e.updatedAt)}):"—"]];return(0,a.jsxs)("div",{className:"pc-adv-detail pc-adv-detail--compact",children:[(0,a.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,a.jsx)(se,{onBack:r}),(0,a.jsx)("div",{className:"pc-adv-detail__id",children:e.id}),(0,a.jsx)("div",{className:"pc-adv-detail__title",children:e.title})]}),(0,a.jsxs)("div",{className:"pc-adv-detail__body",children:[(0,a.jsxs)("div",{className:"pc-adv-detail__section pc-adv-detail__fields",children:[f.map(([o,u])=>(0,a.jsxs)("div",{className:"pc-adv-detail__field-row",children:[(0,a.jsx)("span",{className:"pc-adv-detail__field-label",children:o}),(0,a.jsx)("span",{children:u})]},o)),e.planSlug?(0,a.jsxs)("div",{className:"pc-adv-detail__field-row",children:[(0,a.jsx)("span",{className:"pc-adv-detail__field-label",children:"Plan"}),(0,a.jsx)("code",{className:"pc-adv-detail__pointer",children:e.planSlug})]}):null]}),e.summary?(0,a.jsx)("div",{className:"pc-adv-detail__section",children:(0,a.jsx)("div",{className:"pc-adv-detail__prose",children:e.summary})}):null,e.family==="feature"&&e.id.startsWith("F-")?(0,a.jsxs)("button",{type:"button",className:"pc-adv-detail__link pc-adv-detail__link-btn",onClick:()=>n(e.id),children:["Open feature detail ",(0,a.jsx)(Te,{size:12})]}):null,(0,a.jsx)("div",{className:"pc-adv-detail__section",children:(0,a.jsx)("div",{className:"pc-adv-detail__actions",children:(0,a.jsxs)("button",{type:"button","data-testid":"wi-detail-chat",disabled:l,onClick:()=>{m()},children:[(0,a.jsx)(We,{size:13,"aria-hidden":!0})," Chat"]})})})]}),(0,a.jsx)(ie,{})]})}function se({onBack:t}){return t?(0,a.jsx)(L,{label:"Back to previous selection",children:(0,a.jsx)("button",{type:"button",className:"pc-adv-detail__back",onClick:t,children:"← Back"})}):null}function Pa({slug:t,feature:e,issues:n,runs:r,onSelect:s,onBack:l,patchFeature:i,isEditing:m,onStartEdit:f,onCloseEdit:o}){const u=re(),[j,g]=(0,d.useState)(null),[x,v]=(0,d.useState)(null),[h,_]=(0,d.useState)(!1),[b,C]=(0,d.useState)(""),{confirm:w,element:z}=Ie(),p=O({queryName:"featureNotes.byHarness",args:{harnessSlug:t},enabled:!!t,staleTime:3e4}),k=p.data?.find(c=>c.featureId===e.id),$=(0,d.useCallback)(async()=>{const c=b.trim();if(c){g("steer");try{const S=await fetch(`/api/harness/${encodeURIComponent(t)}/features/${encodeURIComponent(e.id)}/notes`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:c})});if(!S.ok)throw new Error(`${S.status}: ${await S.text()}`);v(M=>[...M??[],c]),p.invalidate(),C(""),_(!0),P.success("Steer note added")}catch(S){P.error("Add steer note failed",{description:String(S)})}finally{g(null)}}},[e.id,p,t,b]),T=(0,d.useMemo)(()=>n.filter(c=>c.linkedFeatureId===e.id||c.foundDuring===e.id),[n,e.id]),I=(0,d.useMemo)(()=>r.filter(c=>c.featureId===e.id).sort((c,S)=>Date.parse(String(S.ts))-Date.parse(String(c.ts))).slice(0,3),[r,e.id]);(0,d.useEffect)(()=>{if(p.loading){v(null);return}v(Fa(k?.content??""))},[p.loading,k?.content]);const A=(0,d.useCallback)(async(c,S)=>{const M=await fetch(`/api/harness/${encodeURIComponent(t)}${c}`,S);if(!M.ok)throw new Error(`${M.status}: ${await M.text()}`);return M.json()},[t]),N=(0,d.useCallback)(async c=>{const S=e.status;i(e.id,{status:c}),g(`status:${c}`);try{await A(`/features/${e.id}?phase=staging`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:c})}),P.success(`${e.id} → ${c}`)}catch(M){i(e.id,{status:S}),P.error("Status change failed",{description:String(M)})}finally{g(null)}},[A,e.id,e.status,i]),F=(0,d.useCallback)(async()=>{if(!await w({title:`Reset ${e.id}?`,body:`Reset ${e.id} back to open and clear its attempts. The worker will pick it up fresh.`,destructive:!0,confirmLabel:"Reset"}))return;const c={status:e.status,attempts:e.attempts};i(e.id,{status:"open",attempts:0}),g("reset");try{await A(`/features/${e.id}/reset?phase=staging`,{method:"POST"}),P.success(`${e.id} reset`)}catch(S){i(e.id,c),P.error("Reset failed",{description:String(S)})}finally{g(null)}},[A,e.id,e.status,e.attempts,i,w]);return m?(0,a.jsx)(ia,{embedded:!0,slug:t,feature:{id:e.id,title:e.title,claims:e.claims,status:e.status,attempts:e.attempts??0},onClose:o,onSaved:()=>{}}):(0,a.jsxs)("div",{className:"pc-adv-detail",children:[(0,a.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,a.jsx)(se,{onBack:l}),(0,a.jsx)("div",{className:"pc-adv-detail__id",children:e.id}),(0,a.jsx)("div",{className:"pc-adv-detail__title",children:e.title}),(0,a.jsxs)("div",{className:"pc-adv-detail__meta",children:[(0,a.jsx)(te,{status:e.status}),typeof e.attempts=="number"&&e.attempts>0&&(0,a.jsxs)("span",{className:"pc-adv-detail__attempts",children:[e.attempts,"× attempts"]}),e.sourcePlanSlug&&(0,a.jsx)(L,{label:`From plan: ${e.sourcePlanSlug}`,children:(0,a.jsxs)("span",{className:"pc-adv-detail__plan",children:["↗ ",e.sourcePlanSlug]})})]})]}),(0,a.jsxs)("section",{className:"pc-adv-detail__body",children:[(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Description"}),e.summary?(0,a.jsx)("p",{className:"pc-adv-detail__prose",children:e.summary}):(0,a.jsx)("p",{className:"pc-adv-detail__muted",children:"No description."})]}),(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Status"}),(0,a.jsx)("div",{className:"pc-adv-detail__status-row",children:(0,a.jsx)(he,{value:e.status,onChange:c=>{N(c)},disabled:j!==null,ariaLabel:"Change status",triggerClassName:"pc-adv-detail__select",options:Ra.map(c=>({value:c,label:(0,a.jsx)(te,{status:c,size:"xs"})}))})})]}),T.length>0&&(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsxs)("h3",{children:["Issues (",T.length,")"]}),(0,a.jsx)("div",{className:"pc-adv-detail__related",children:T.map(c=>(0,a.jsx)(L,{label:c.title,children:(0,a.jsxs)("button",{type:"button",className:"pc-adv-detail__related-row",onClick:()=>s(c.id),children:[(0,a.jsx)("span",{className:"pc-adv-detail__related-id",children:c.id}),(0,a.jsx)("span",{className:"pc-adv-detail__related-dot",style:{background:Fe[c.severity].solid}}),(0,a.jsx)("span",{className:"pc-adv-detail__related-title",children:c.title})]})},c.id))})]}),(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Recent activity"}),I.length===0?(0,a.jsx)("p",{className:"pc-adv-detail__muted",children:"No agent runs for this feature yet."}):(0,a.jsx)("div",{className:"pc-adv-detail__runs",children:I.map(c=>{const S=Ta(c);return(0,a.jsxs)("div",{className:"pc-adv-detail__run-block",children:[(0,a.jsxs)("div",{className:"pc-adv-detail__run",children:[(0,a.jsx)("span",{className:"pc-adv-detail__run-role",children:bt(c.role,u)}),(0,a.jsx)("span",{className:"pc-adv-detail__run-time",children:xe(c.ts)}),(0,a.jsxs)("span",{className:"pc-adv-detail__run-right",children:[c.costUsd!=null&&Number(c.costUsd)>0&&(0,a.jsxs)("span",{className:"pc-adv-detail__run-cost",children:["$",Number(c.costUsd).toFixed(2)]}),S&&(0,a.jsx)("span",{className:`pc-adv-detail__run-outcome is-${S.kind}`,title:S.detail,children:S.label}),c.sessionId&&(0,a.jsx)(L,{label:"Open this run's agent session in a terminal (claude --resume)",children:(0,a.jsx)("button",{type:"button",className:"pc-adv-detail__run-open",onClick:()=>{za(t,c.sessionId)},children:"Open session"})})]})]}),S?.kind==="failed"&&S.detail&&(0,a.jsx)("div",{className:"pc-adv-detail__run-error",title:S.detail,children:S.detail})]},c.runId)})})]}),(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:(0,a.jsxs)("button",{type:"button",className:"pc-adv-detail__collapse",onClick:()=>_(c=>!c),children:[h?"▾":"▸"," Steer notes",x&&x.length>0?` (${x.length})`:""]})}),h&&(0,a.jsxs)(a.Fragment,{children:[x&&x.length>0&&(0,a.jsx)("div",{className:"pc-adv-detail__notes",children:x.map((c,S)=>(0,a.jsx)("p",{className:"pc-adv-detail__note",children:c},S))}),(0,a.jsxs)("div",{className:"pc-adv-detail__note-form",children:[(0,a.jsx)("textarea",{value:b,onChange:c=>C(c.target.value),placeholder:"Add a steer note for the worker…",rows:2,"aria-label":"Add a steer note"}),(0,a.jsx)("button",{type:"button",disabled:j!==null||!b.trim(),onClick:()=>{$()},children:"Add steer note"})]})]})]}),(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Actions"}),(0,a.jsxs)("div",{className:"pc-adv-detail__actions",children:[(0,a.jsxs)("button",{type:"button",disabled:j!==null,onClick:async()=>{g("chat");try{const c=await qe({slug:t,role:"worker",featureId:e.id,title:e.summary||e.title,mode:"discuss"});if(c&&typeof c=="object"&&"error"in c)throw new Error(String(c.error))}catch(c){P.error("Open chat failed",{description:String(c)})}finally{g(null)}},children:[(0,a.jsx)(We,{size:13,"aria-hidden":!0})," Chat"]}),(0,a.jsx)("button",{type:"button",disabled:j!==null,onClick:F,children:"Reset"}),(0,a.jsx)("button",{type:"button",disabled:j!==null,onClick:f,children:"Edit"})]})]})]}),z,(0,a.jsx)(ie,{})]})}function Oa({slug:t,issue:e,onSelect:n,onBack:r,patchIssue:s}){const[l,i]=(0,d.useState)(null),[m,f]=(0,d.useState)(""),[o,u]=(0,d.useState)([]);(0,d.useEffect)(()=>{u([])},[e.id]);const j=(0,d.useMemo)(()=>[...e.notes??[],...o],[e.notes,o]),g=(0,d.useCallback)(async v=>{const h=Ve(v),_=e.status;h&&s(e.id,{status:h}),i(v);try{await ua(t,e.id,v),P.success(`${e.id} → ${v}`)}catch(b){h&&s(e.id,{status:_}),P.error(`${v} failed`,{description:String(b)})}finally{i(null)}},[t,e.id,e.status,s]),x=(0,d.useCallback)(async()=>{const v=m.trim();if(v){i("note");try{const h=await fetch(`/api/harness/${encodeURIComponent(t)}/issues/${encodeURIComponent(e.id)}/update`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({note:v,by:"human"})});if(!h.ok)throw new Error(`${h.status}: ${await h.text()}`);u(_=>[..._,{ts:new Date().toISOString(),by:"human",text:v}]),f(""),P.success("Note added")}catch(h){P.error("Add note failed",{description:String(h)})}finally{i(null)}}},[t,e.id,m]);return(0,a.jsxs)("div",{className:"pc-adv-detail",children:[(0,a.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,a.jsx)(se,{onBack:r}),(0,a.jsx)("div",{className:"pc-adv-detail__id",children:e.id}),(0,a.jsx)("div",{className:"pc-adv-detail__title",children:e.title}),(0,a.jsxs)("div",{className:"pc-adv-detail__meta",children:[(0,a.jsx)(ge,{severity:e.severity}),(0,a.jsx)(ve,{status:e.status}),e.linkedFeatureId&&(0,a.jsx)(L,{label:`Go to linked feature ${e.linkedFeatureId}`,children:(0,a.jsxs)("button",{type:"button",className:"pc-adv-detail__link pc-adv-detail__link-btn",onClick:()=>n(e.linkedFeatureId),children:[(0,a.jsx)(Te,{size:11,"aria-hidden":!0})," ",e.linkedFeatureId]})})]})]}),(0,a.jsxs)("section",{className:"pc-adv-detail__body",children:[e.evidence&&(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Evidence"}),(0,a.jsx)("pre",{className:"pc-adv-detail__code",children:e.evidence})]}),e.repro&&(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Reproduction"}),(0,a.jsx)("pre",{className:"pc-adv-detail__code",children:e.repro})]}),e.suggestedFix&&(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Suggested fix"}),(0,a.jsx)("pre",{className:"pc-adv-detail__code",children:e.suggestedFix})]}),e.codePointer&&(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Code pointer"}),(0,a.jsx)("code",{className:"pc-adv-detail__pointer",children:e.codePointer})]}),(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsxs)("h3",{children:["Notes",j.length>0?` (${j.length})`:""]}),j.length>0&&(0,a.jsx)("div",{className:"pc-adv-detail__notes",children:j.map((v,h)=>(0,a.jsxs)("div",{className:"pc-adv-detail__note-row",children:[(0,a.jsxs)("div",{className:"pc-adv-detail__note-meta",children:[v.by," · ",v.ts?new Date(v.ts).toLocaleString():""]}),(0,a.jsx)("p",{className:"pc-adv-detail__note",children:v.text})]},h))}),(0,a.jsxs)("div",{className:"pc-adv-detail__note-form",children:[(0,a.jsx)("textarea",{value:m,onChange:v=>f(v.target.value),placeholder:"Add a note…",rows:2,"aria-label":"Add a note"}),(0,a.jsx)("button",{type:"button",disabled:l!==null||!m.trim(),onClick:()=>{x()},children:"Add note"})]})]}),(0,a.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,a.jsx)("h3",{children:"Actions"}),(0,a.jsxs)("div",{className:"pc-adv-detail__actions",children:[!e.linkedFeatureId&&e.status!=="closed"&&e.status!=="wontfix"&&(0,a.jsx)("button",{type:"button",disabled:l!==null,onClick:()=>{g("promote")},children:"Promote"}),e.status!=="acknowledged"&&e.status!=="closed"&&(0,a.jsx)("button",{type:"button",disabled:l!==null,onClick:()=>{g("acknowledge")},children:"Acknowledge"}),e.status!=="closed"&&(0,a.jsx)("button",{type:"button",disabled:l!==null,onClick:()=>{g("close")},children:"Close"}),e.status!=="wontfix"&&(0,a.jsx)("button",{type:"button",disabled:l!==null,onClick:()=>{g("wontfix")},children:"Won't fix"})]})]})]}),(0,a.jsx)(ie,{})]})}function Y({children:t,tone:e}){return(0,a.jsx)("div",{className:`pc-adv-detail__empty${e==="error"?" pc-adv-detail__empty--error":""}`,style:{height:"100%",display:"grid",placeItems:"center",padding:24,color:e==="error"?"var(--bad, #fb7185)":"var(--fg-mute, #7f9bb4)",fontSize:13,textAlign:"center"},children:t})}function ie(){return(0,a.jsx)("style",{children:`
      .pc-adv-detail {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--bg-1, #0b1220);
        color: var(--fg-dim, #b9d4e8);
      }
      .pc-adv-detail__header {
        flex-shrink: 0;
        padding: 14px 18px 12px;
        border-bottom: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
        background: color-mix(in srgb, var(--bg-2, rgba(255, 255, 255, 0.045)), transparent 40%);
      }
      .pc-adv-detail__back {
        display: inline-flex;
        align-items: center;
        margin-bottom: 8px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
        color: var(--accent-strong, #7dd3fc);
        background: var(--bg-2, rgba(255, 255, 255, 0.045));
        border: 1px solid var(--border-strong, color-mix(in srgb, var(--accent-strong), transparent 68%));
        border-radius: 999px;
        cursor: pointer;
      }
      .pc-adv-detail__back:hover {
        background: var(--bg-3, rgba(255, 255, 255, 0.075));
        border-color: var(--accent, #38bdf8);
      }
      .pc-adv-detail__id {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        font-weight: 700;
        color: var(--fg-mute, #7f9bb4);
        letter-spacing: 0;
      }
      .pc-adv-detail__title {
        font-size: 16px;
        font-weight: 700;
        line-height: 1.3;
        color: var(--fg, #e7f7ff);
        margin-top: 4px;
      }
      .pc-adv-detail__meta {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-top: 10px;
        flex-wrap: wrap;
      }
      .pc-adv-detail__attempts {
        font-size: 10.5px;
        font-weight: 600;
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--bg-3, rgba(255, 255, 255, 0.075));
        color: var(--fg-mute, #7f9bb4);
        white-space: nowrap;
      }
      .pc-adv-detail__plan,
      .pc-adv-detail__link {
        font-size: 11px;
        color: var(--accent-strong, #7dd3fc);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .pc-adv-detail__link-btn {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .pc-adv-detail__link-btn:hover {
        color: var(--fg, #e7f7ff);
      }
      .pc-adv-detail__body {
        flex: 1;
        overflow: auto;
        padding: 16px 18px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      /* The status Select's simple row container. */
      .pc-adv-detail__status-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      /* Label / value field rows (WorkItemDetail) — previously unstyled:
         the spans rendered run-together inline. */
      .pc-adv-detail__field-row {
        display: grid;
        grid-template-columns: 88px 1fr;
        gap: 12px;
        align-items: baseline;
        padding: 3px 0;
        font-size: 12.5px;
        color: var(--fg, #e7f7ff);
      }
      .pc-adv-detail__field-label {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
        color: var(--fg-mute, #7f9bb4);
      }
      .pc-adv-detail__kind-chip {
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
        padding: 1px 5px;
        border-radius: 4px;
        background: var(--bg-3, rgba(255, 255, 255, 0.075));
        color: var(--fg-mute, #7f9bb4);
        white-space: nowrap;
      }
      /* Hairline rhythm between stacked sections — scannability without cards. */
      .pc-adv-detail__section + .pc-adv-detail__section {
        border-top: 1px solid color-mix(in srgb, var(--border, rgba(125, 211, 252, 0.15)), transparent 45%);
        padding-top: 14px;
      }
      .pc-adv-detail__section h3 {
        margin: 0 0 6px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
        color: var(--fg-mute, #7f9bb4);
      }
      .pc-adv-detail__collapse {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        text-transform: uppercase;
        letter-spacing: 0;
        color: var(--fg-mute, #7f9bb4);
        cursor: pointer;
      }
      .pc-adv-detail__prose {
        margin: 0;
        font-size: 13px;
        line-height: 1.55;
        white-space: pre-wrap;
        color: var(--fg, #e7f7ff);
      }
      .pc-adv-detail__muted {
        margin: 0;
        font-size: 12px;
        font-style: italic;
        color: var(--fg-mute, #7f9bb4);
      }
      .pc-adv-detail__related {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      /* AgentDetail furniture — liveness line, warning chips, queue + claims. */
      .pc-adv-detail__liveness {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .pc-adv-detail__warn-chip {
        font-size: 10.5px;
        font-weight: 700;
        padding: 1px 8px;
        border-radius: 999px;
        background: color-mix(in oklab, var(--warn, #fbbf24), transparent 84%);
        color: color-mix(in oklab, var(--warn, #fbbf24), white 35%);
        white-space: nowrap;
        cursor: default;
      }
      .pc-adv-detail__queue {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }
      .pc-adv-detail__queue-chip {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10.5px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--bg-2, rgba(255, 255, 255, 0.045));
        border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
        color: var(--fg-dim, #b9d4e8);
        cursor: pointer;
      }
      .pc-adv-detail__queue-chip:hover:not(:disabled) {
        border-color: var(--accent, #38bdf8);
        color: var(--fg, #e7f7ff);
      }
      .pc-adv-detail__queue-chip:disabled {
        cursor: default;
        opacity: 0.7;
      }
      .pc-adv-detail__claim-row {
        display: grid;
        grid-template-columns: auto auto 1fr;
        gap: 8px;
        align-items: baseline;
        font-size: 12px;
        padding: 2px 0;
      }
      .pc-adv-detail__claim-type {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
        color: var(--fg-mute, #7f9bb4);
      }
      .pc-adv-detail__related-row {
        display: grid;
        grid-template-columns: auto auto 1fr;
        gap: 8px;
        align-items: center;
        padding: 5px 8px;
        font-size: 12px;
        text-align: left;
        color: var(--fg-dim, #b9d4e8);
        background: var(--bg-2, rgba(255, 255, 255, 0.045));
        border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
        border-radius: 6px;
        cursor: pointer;
      }
      .pc-adv-detail__related-row:hover:not(:disabled) {
        background: var(--bg-3, rgba(255, 255, 255, 0.075));
        border-color: var(--border-strong, color-mix(in srgb, var(--accent-strong), transparent 68%));
      }
      .pc-adv-detail__related-row:disabled {
        cursor: default;
      }
      .pc-adv-detail__related-id {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: var(--fg-mute, #7f9bb4);
      }
      .pc-adv-detail__related-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
      }
      .pc-adv-detail__related-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--fg, #e7f7ff);
      }
      .pc-adv-detail__runs {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .pc-adv-detail__run {
        display: flex;
        gap: 10px;
        align-items: baseline;
        font-size: 12px;
      }
      .pc-adv-detail__run-role {
        font-weight: 600;
        color: var(--accent-strong, #7dd3fc);
        min-width: 80px;
      }
      .pc-adv-detail__run-time {
        color: var(--fg-mute, #7f9bb4);
      }
      .pc-adv-detail__run-right {
        margin-left: auto;
        display: inline-flex;
        gap: 8px;
        align-items: baseline;
      }
      .pc-adv-detail__run-cost {
        color: var(--fg-mute, #7f9bb4);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      /* P-023 outcome chip — colour buckets from runOutcome(). */
      .pc-adv-detail__run-outcome {
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0;
        padding: 1px 7px;
        border-radius: 999px;
        white-space: nowrap;
      }
      .pc-adv-detail__run-outcome.is-done {
        background: color-mix(in oklab, var(--good, #34d399), transparent 84%);
        color: color-mix(in oklab, var(--good, #34d399), white 35%);
      }
      .pc-adv-detail__run-outcome.is-failed {
        background: color-mix(in oklab, var(--bad, #f87171), transparent 82%);
        color: color-mix(in oklab, var(--bad, #f87171), white 35%);
      }
      .pc-adv-detail__run-outcome.is-cancelled {
        background: color-mix(in oklab, var(--warn, #fbbf24), transparent 84%);
        color: color-mix(in oklab, var(--warn, #fbbf24), white 35%);
      }
      .pc-adv-detail__run-outcome.is-running {
        background: color-mix(in oklab, var(--accent, #38bdf8), transparent 84%);
        color: var(--accent-strong, #7dd3fc);
      }
      .pc-adv-detail__run-outcome.is-muted {
        background: var(--bg-3, rgba(255, 255, 255, 0.075));
        color: var(--fg-mute, #7f9bb4);
      }
      .pc-adv-detail__run-open {
        font-size: 10.5px;
        font-weight: 600;
        padding: 1px 8px;
        border-radius: 999px;
        background: transparent;
        border: 1px solid color-mix(in oklab, var(--accent-strong, #7dd3fc), transparent 60%);
        color: var(--accent-strong, #7dd3fc);
        cursor: pointer;
        white-space: nowrap;
      }
      .pc-adv-detail__run-open:hover {
        background: color-mix(in oklab, var(--accent-strong, #7dd3fc), transparent 86%);
      }
      .pc-adv-detail__run-error {
        margin: 1px 0 2px 90px;
        font-size: 11px;
        color: color-mix(in oklab, var(--bad, #f87171), white 35%);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pc-adv-detail__notes {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .pc-adv-detail__note-row {
        border-left: 2px solid var(--border-strong, color-mix(in srgb, var(--accent-strong), transparent 68%));
        padding-left: 10px;
      }
      .pc-adv-detail__note-meta {
        font-size: 10px;
        color: var(--fg-mute, #7f9bb4);
        margin-bottom: 2px;
      }
      .pc-adv-detail__note {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        color: var(--fg, #e7f7ff);
      }
      .pc-adv-detail__note-form {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
      }
      .pc-adv-detail__note-form textarea {
        width: 100%;
        resize: vertical;
        padding: 6px 8px;
        font: inherit;
        font-size: 12px;
        background: var(--bg-2, rgba(255, 255, 255, 0.045));
        color: var(--fg, #e7f7ff);
        border: 1px solid var(--border-strong, color-mix(in srgb, var(--accent-strong), transparent 68%));
        border-radius: 6px;
      }
      .pc-adv-detail__note-form textarea:focus {
        outline: none;
        border-color: var(--accent, #38bdf8);
        box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent, #38bdf8), transparent 78%);
      }
      .pc-adv-detail__note-form button {
        align-self: flex-start;
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 600;
        background: var(--bg-2, rgba(255, 255, 255, 0.045));
        color: var(--fg, #e7f7ff);
        border: 1px solid var(--border-strong, color-mix(in srgb, var(--accent-strong), transparent 68%));
        border-radius: 6px;
        cursor: pointer;
      }
      .pc-adv-detail__note-form button:hover:not(:disabled) {
        border-color: var(--accent, #38bdf8);
      }
      .pc-adv-detail__note-form button:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .pc-adv-detail__code {
        margin: 0;
        padding: 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        background: var(--bg-2, rgba(255, 255, 255, 0.045));
        border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
        border-radius: 6px;
        color: var(--fg, #e7f7ff);
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 240px;
        overflow: auto;
      }
      .pc-adv-detail__pointer {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        padding: 3px 8px;
        background: var(--bg-2, rgba(255, 255, 255, 0.045));
        border-radius: 4px;
        color: var(--fg, #e7f7ff);
      }
      .pc-adv-detail__select {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 160px;
        min-height: 32px;
        padding: 0 10px;
        font-size: 12px;
        background: var(--bg-2, rgba(255, 255, 255, 0.045));
        color: var(--fg, #e7f7ff);
        border: 1px solid var(--border-strong, color-mix(in srgb, var(--accent-strong), transparent 68%));
        border-radius: 6px;
        cursor: pointer;
      }
      .pc-adv-detail__actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .pc-adv-detail__actions button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        background: var(--bg-2, rgba(255, 255, 255, 0.045));
        color: var(--fg, #e7f7ff);
        border: 1px solid var(--border-strong, color-mix(in srgb, var(--accent-strong), transparent 68%));
        border-radius: 6px;
        cursor: pointer;
      }
      .pc-adv-detail__actions button:hover:not(:disabled) {
        background: var(--bg-3, rgba(255, 255, 255, 0.075));
        border-color: var(--accent, #38bdf8);
      }
      .pc-adv-detail__actions button:disabled {
        opacity: 0.45;
        cursor: default;
      }
      /* Inline header stats (AgentDetail meta line: drive / load). */
      .pc-adv-detail__stat {
        font-size: 11px;
        color: var(--fg-mute, #7f9bb4);
        white-space: nowrap;
      }
      /* Compact density variant — the working tab's agent:* / WI-* details.
         Same vocabulary, tighter rhythm: id+title share a line, the field
         rows flow 2-up when the pane is wide enough, smaller paddings. */
      .pc-adv-detail--compact .pc-adv-detail__header {
        padding: 8px 12px 7px;
      }
      .pc-adv-detail--compact .pc-adv-detail__back {
        margin-bottom: 4px;
      }
      .pc-adv-detail--compact .pc-adv-detail__id {
        display: inline;
      }
      .pc-adv-detail--compact .pc-adv-detail__title {
        display: inline;
        margin: 0 0 0 7px;
        font-size: 13px;
        line-height: 1.35;
      }
      .pc-adv-detail--compact .pc-adv-detail__meta {
        margin-top: 5px;
        gap: 6px;
      }
      .pc-adv-detail--compact .pc-adv-detail__body {
        padding: 10px 12px;
        gap: 10px;
      }
      .pc-adv-detail--compact .pc-adv-detail__section + .pc-adv-detail__section {
        padding-top: 9px;
      }
      .pc-adv-detail--compact .pc-adv-detail__section h3 {
        margin-bottom: 4px;
      }
      .pc-adv-detail--compact .pc-adv-detail__fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        column-gap: 18px;
      }
      .pc-adv-detail--compact .pc-adv-detail__field-row {
        grid-template-columns: 64px 1fr;
        gap: 8px;
        padding: 1.5px 0;
        font-size: 12px;
      }
      .pc-adv-detail--compact .pc-adv-detail__prose {
        font-size: 12px;
        line-height: 1.45;
      }
      .pc-adv-detail--compact .pc-adv-detail__related-row {
        padding: 3px 6px;
      }
      .pc-adv-detail--compact .pc-adv-detail__actions button {
        padding: 4px 10px;
      }
    `})}function Sr({id:t,harnessSlug:e,onSelect:n,onClose:r}){const s=t!==null,[l,i]=(0,d.useState)(null);(0,d.useEffect)(()=>{i(null)},[t]);const m=O({queryName:"workItems.detail",args:{harnessSlug:e??"",id:t??""},enabled:s&&!!e&&!!t}),f=(0,d.useMemo)(()=>m.data?.[0]??null,[m.data]);let o;return e?m.loading?o=(0,a.jsxs)("div",{className:"wi-popup__empty",children:["Loading ",t,"…"]}):!f||f.id!==t?o=(0,a.jsxs)("div",{className:"wi-popup__empty",children:["No item found for ",t,"."]}):l?o=(0,a.jsxs)("div",{className:"wi-popup__chat","data-testid":"wi-popup-chat",children:[(0,a.jsxs)("button",{type:"button",className:"wi-popup__chat-back",onClick:()=>i(null),"data-testid":"wi-popup-chat-back",children:["← Back to ",t]}),(0,a.jsx)(dt,{slug:e,chatId:l,mode:"discuss"})]}):o=(0,a.jsx)(Je,{slug:e,workItem:f,onSelect:n,onOpenChat:i}):o=(0,a.jsxs)("div",{className:"wi-popup__empty",children:["No harness context for ",t,"."]}),s?(0,a.jsxs)(Ee,{open:!0,onOpenChange:u=>{u||r()},title:f?.title?`${t} — ${f.title}`:t??"Work item",srOnlyTitle:!0,contentClassName:"wi-popup",contentStyle:{width:"min(760px, 94vw)",height:"min(720px, calc(100vh - 4rem))",display:"flex",flexDirection:"column",overflow:"hidden",padding:0},children:[(0,a.jsx)("div",{className:"wi-popup__header",children:(0,a.jsx)("button",{type:"button",className:"wi-popup__close",onClick:r,"aria-label":"Close work item popup","data-testid":"wi-popup-close",children:"✕"})}),(0,a.jsx)("div",{className:"wi-popup__body","data-testid":"wi-popup-body",children:o})]}):null}export{jt as C,Z as S,qe as _,Aa as a,qt as b,yr as c,_r as d,ra as f,ke as g,te as h,jr as i,oa as l,aa as m,wr as n,$a as o,na as p,kr as r,ma as s,Sr as t,ca as u,We as v,Be as x,Kt as y};
