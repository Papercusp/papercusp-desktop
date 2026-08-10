import{o as Je}from"./chunk-ChpBd9eV.js";import{t as Ye}from"./react-DqHYuLt-.js";import{t as Qe}from"./jsx-runtime-BmDUFisN.js";import{t as Xe}from"./VirtualGrid-BjQ1W_hB.js";import{r as P}from"./SyncContext-CvBNP3sq.js";import{n as D}from"./dist-CREypBH1.js";import{a as Z,c as q,r as Ze,t as et}from"./dist-_S1YDkZy.js";import{c as tt}from"./client-DojwvLiy.js";import{t as at}from"./flag-hooks-DIcJ9MK9.js";import{t as te}from"./use-workspace-id-CWJdEj3C.js";import{n as nt,r as rt,t as it}from"./dist-Okg3868K.js";import{t as Ae}from"./Modal-N5AtQfeY.js";import{t as Ee}from"./useConfirmDialog-C5r8Ks87.js";import{n as st,t as lt}from"./presence-ui-kFcCiUuS.js";import{t as O}from"./Tooltip-BRMSMTLQ.js";import{t as U}from"./createLucideIcon-H39hj3ia.js";import{n as se,t as ot}from"./ChatPanel-D4mP5nvJ.js";import{t as Ie}from"./arrow-up-right-0anD4iWN.js";import{t as dt}from"./check-Cdd_-6Wk.js";import{t as xe}from"./chevron-down-Cewb32jP.js";import{t as Te}from"./eye-Ir_yoFNS.js";import{t as ct}from"./flask-conical-CjB7y8cu.js";import{n as ut,t as Re}from"./message-circle-tkiFGShA.js";import{t as pt}from"./Checkbox-B2Xs7vTj.js";import{t as mt}from"./puzzle-Dl388NgU.js";import{t as ft}from"./refresh-cw-DU29wawW.js";import{t as ht}from"./sparkles-B3Y1Aaqk.js";import{t as ze}from"./triangle-alert-CeknQp5m.js";import{t as be}from"./x-DBWzBmCv.js";import{t as gt}from"./Popover-V1LrQJ79.js";import{t as ae}from"./useLexicon-CQ_5wgyT.js";import{_ as Y,b as ye,h as Fe,t as _e,u as vt,v as xt}from"./theme-wPkAqV6o.js";import{t as fe}from"./Select-DvWB91Vh.js";import{n as bt,r as yt,t as Me}from"./agent-display-CMypfJF9.js";import{r as De}from"./list-meta-CY1ZPYlN.js";var d=Je(Ye());function _t(a,e){try{const r=a?.getItem(e);if(!r)return{};const n=JSON.parse(r);if(!n||typeof n!="object"||Array.isArray(n))return{};const i={};for(const[l,s]of Object.entries(n))typeof s=="number"&&Number.isFinite(s)&&s>0&&(i[l]=s);return i}catch{return{}}}function jt(a,e){const r=e??(typeof window<"u"?window.localStorage:void 0),[n,i]=(0,d.useState)(()=>_t(r,a));return[n,(0,d.useCallback)(l=>{i(l);try{r?.setItem(a,JSON.stringify(l))}catch{}},[a,r])]}function ne(a,e){switch(a.type){case"text":return typeof e!="string"||e.length===0;case"enum":return!Array.isArray(e)||e.length===0;case"number":{if(e==null||typeof e!="object"||Array.isArray(e))return!0;const{min:r,max:n}=e;return r==null&&n==null}case"boolean":return typeof e!="boolean";default:return!0}}function kt(a,e,r){if(ne(a,e))return!0;switch(a.type){case"text":{const n=a.accessor(r);return n==null?!1:String(n).toLowerCase().includes(e.toLowerCase())}case"enum":{const n=a.accessor(r);return n==null?!1:e.includes(n)}case"number":{const n=a.accessor(r);if(n==null||typeof n!="number"||Number.isNaN(n))return!1;const{min:i,max:l}=e;return!(i!=null&&n<i||l!=null&&n>l)}case"boolean":{const n=a.accessor(r);return n==null?!1:n===e}default:return!0}}function wt(a,e,r){if(!e)return a;const n=[];for(const i of Object.keys(e)){const l=r.find(m=>m.key===i);if(!l?.filter)continue;const s=e[i];ne(l.filter,s)||n.push({spec:l.filter,value:s})}return n.length===0?a:a.filter(i=>n.every(({spec:l,value:s})=>kt(l,s,i)))}function St(a,e){const r=e.filter;if(!r||r.type!=="enum")return[];const n=new Map;for(const i of a){const l=r.accessor(i);l!=null&&n.set(l,(n.get(l)??0)+1)}return r.options&&r.options.length>0?r.options.map(i=>({value:i.value,...i.label!==void 0?{label:i.label}:{},count:n.get(i.value)??0})):[...n.keys()].sort((i,l)=>i.localeCompare(l)).map(i=>({value:i,count:n.get(i)}))}var Pe="~",Oe=":",Le=",",Ue="..";function ue(a){return a.replace(/[%~,:]/g,e=>"%"+e.charCodeAt(0).toString(16).toUpperCase().padStart(2,"0"))}function le(a){return a.replace(/%([0-9A-Fa-f]{2})/g,(e,r)=>String.fromCharCode(parseInt(r,16)))}function Nt(a,e){if(ne(a,e))return null;switch(a.type){case"text":return ue(e);case"enum":return e.map(ue).join(Le);case"number":{const{min:r,max:n}=e;return`${r!=null?String(r):""}${Ue}${n!=null?String(n):""}`}case"boolean":return e?"true":"false";default:return null}}function oe(a){if(!a)return"";const e=[];for(const r of Object.keys(a)){const n=a[r],i=$t(n);if(!i)continue;const l=Nt(i,n);l!=null&&e.push(`${Ct(r)}${Oe}${l}`)}return e.join(Pe)}function Ct(a){return ue(a)}function $t(a){return typeof a=="string"?{type:"text",accessor:()=>null}:Array.isArray(a)?{type:"enum",accessor:()=>null}:typeof a=="boolean"?{type:"boolean",accessor:()=>null}:a!=null&&typeof a=="object"?{type:"number",accessor:()=>null}:null}function At(a){const e=a.indexOf(Ue);if(e===-1)return null;const r=a.slice(0,e),n=a.slice(e+2),i={};if(r!==""){const l=Number(r);if(Number.isNaN(l))return null;i.min=l}if(n!==""){const l=Number(n);if(Number.isNaN(l))return null;i.max=l}return i.min==null&&i.max==null?null:i}function Et(a,e){const r={};if(!a)return r;const n=new Map;for(const i of e)i.filter&&n.set(i.key,i.filter);for(const i of a.split(Pe)){if(i==="")continue;const l=i.indexOf(Oe);if(l===-1)continue;const s=le(i.slice(0,l)),m=i.slice(l+1),f=n.get(s);if(f)switch(f.type){case"text":{const o=le(m);if(o.length===0)continue;r[s]=o;break}case"enum":{const o=m.split(Le).filter(c=>c!=="").map(le);if(o.length===0)continue;r[s]=o;break}case"number":{const o=At(m);if(!o)continue;r[s]=o;break}case"boolean":m==="true"?r[s]=!0:m==="false"&&(r[s]=!1);break}}return r}function It(a,e){return a.options?.find(r=>r.value===e)?.label??e}function Tt(a){return typeof a.header=="string"&&a.header.length>0?a.header:typeof a.header=="number"?String(a.header):typeof a.headerText=="string"&&a.headerText.length>0?a.headerText:a.key}function Rt(a,e){const r=a.filter,n=Tt(a);if(!r||ne(r,e))return"";switch(r.type){case"text":return`${n}: ${e}`;case"enum":return`${n}: ${e.map(i=>It(r,i)).join(", ")}`;case"number":{const{min:i,max:l}=e;return i!=null&&l!=null?`${n}: ${i}–${l}`:i!=null?`${n}: ≥${i}`:`${n}: ≤${l}`}case"boolean":return`${n}: ${e?"true":"false"}`;default:return""}}var zt=[["path",{d:"M12 20v-9",key:"1qisl0"}],["path",{d:"M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z",key:"uouzyp"}],["path",{d:"M14.12 3.88 16 2",key:"qol33r"}],["path",{d:"M21 21a4 4 0 0 0-3.81-4",key:"1b0z45"}],["path",{d:"M21 5a4 4 0 0 1-3.55 3.97",key:"5cxbf6"}],["path",{d:"M22 13h-4",key:"1jl80f"}],["path",{d:"M3 21a4 4 0 0 1 3.81-4",key:"1fjd4g"}],["path",{d:"M3 5a4 4 0 0 0 3.55 3.97",key:"1d7oge"}],["path",{d:"M6 13H2",key:"82j7cp"}],["path",{d:"m8 2 1.88 1.88",key:"fmnt4t"}],["path",{d:"M9 7.13V6a3 3 0 1 1 6 0v1.13",key:"1vgav8"}]],Ft=U("bug",zt),Mt=[["path",{d:"M21.801 10A10 10 0 1 1 17 3.335",key:"yps3ct"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],X=U("circle-check-big",Mt),Dt=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],Be=U("circle-x",Dt),Pt=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]],B=U("circle",Pt),Ot=[["rect",{width:"12",height:"12",x:"2",y:"10",rx:"2",ry:"2",key:"6agr2n"}],["path",{d:"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6",key:"1o487t"}],["path",{d:"M6 18h.01",key:"uhywen"}],["path",{d:"M10 14h.01",key:"ssrbsk"}],["path",{d:"M15 6h.01",key:"cblpky"}],["path",{d:"M18 9h.01",key:"2061c0"}]],Lt=U("dices",Ot),Ut=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M9 10h6",key:"9gxzsh"}],["path",{d:"M12 13V7",key:"h0r20n"}],["path",{d:"M9 17h6",key:"r8uit2"}]],Bt=U("file-diff",Ut),Ht=[["path",{d:"m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9",key:"1hayfq"}],["path",{d:"m18 15 4-4",key:"16gjal"}],["path",{d:"m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5",key:"15ts47"}]],pe=U("hammer",Ht),Wt=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]],Vt=U("info",Wt),qt=[["path",{d:"M2 5h20",key:"1fs1ex"}],["path",{d:"M6 12h12",key:"8npq4p"}],["path",{d:"M9 19h6",key:"456am0"}]],Kt=U("list-filter",qt),Gt=[["path",{d:"M12 16h.01",key:"1drbdi"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z",key:"1fd625"}]],He=U("octagon-alert",Gt),je="papercusp:open-chat";async function We(a){const e=a.dispatch!==!1;try{try{const l=await fetch(`/api/harness/${encodeURIComponent(a.slug)}/agent-chats`);if(l.ok){const s=((await l.json()).chats??[]).find(m=>m.role===a.role&&m.feature_id===a.featureId);if(s){const m={slug:a.slug,chatId:s.id,title:s.title??a.title,role:s.role,featureId:a.featureId,...a.mode?{mode:a.mode}:{}};if(e&&typeof window<"u"){const f=window,o=f.__PAPERCUSP_PENDING_CHAT_OPENS__??[];o.push(m),f.__PAPERCUSP_PENDING_CHAT_OPENS__=o,window.dispatchEvent(new CustomEvent(je,{detail:m}))}return{chatId:s.id}}}}catch{}const r=await fetch(`/api/harness/${encodeURIComponent(a.slug)}/agent-chats`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({role:a.role,feature_id:a.featureId,title:a.title})});if(!r.ok)return{error:(await r.json().catch(()=>({}))).error??`HTTP ${r.status}`};const n=await r.json(),i={slug:a.slug,chatId:n.id,title:n.title,role:n.role,featureId:n.feature_id??void 0,...a.mode?{mode:a.mode}:{}};if(e&&typeof window<"u"){const l=window,s=l.__PAPERCUSP_PENDING_CHAT_OPENS__??[];s.push(i),l.__PAPERCUSP_PENDING_CHAT_OPENS__=s,window.dispatchEvent(new CustomEvent(je,{detail:i}))}return{chatId:n.id}}catch(r){return{error:r.message}}}var t=Qe();function Q({meta:a,Icon:e,glyph:r,size:n,showLabel:i,labelOverride:l}){const s=n==="xs"?10:11;return(0,t.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:4,padding:"1px 8px",borderRadius:999,fontSize:n==="xs"?10:Y.xs,fontWeight:700,textTransform:"uppercase",color:a.text,background:a.bg,whiteSpace:"nowrap"},children:[e?(0,t.jsx)(e,{size:s,"aria-hidden":!0}):(0,t.jsx)("span",{"aria-hidden":!0,style:{fontSize:s+1,lineHeight:1},children:r}),i&&(0,t.jsx)("span",{children:l??a.label})]})}var Jt={open:B,wip:pe,blocked:ze,"needs-human":He,done:X,dropped:se,todo:B,in_progress:pe,validating:Te,failing:Be,passed:X,deprecated:se,resolved:X,closed:se};function ee({status:a,size:e="sm",showLabel:r=!0,variant:n="dot"}){const i=xt[a];if(n==="chip")return(0,t.jsx)(Q,{meta:i,Icon:Jt[a]??B,size:e,showLabel:r});const l=e==="xs"?6:8;return(0,t.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:6,fontSize:e==="xs"?Y.xs:Y.sm,color:i.text,fontWeight:500,whiteSpace:"nowrap"},children:[(0,t.jsx)("span",{"aria-hidden":!0,style:{width:l,height:l,borderRadius:"50%",background:i.solid,flexShrink:0}}),r&&(0,t.jsx)("span",{children:i.label})]})}var Yt={critical:He,major:ze,minor:Vt,nit:B},Qt={open:B,acknowledged:Te,fixing:pe,resolved:dt,closed:X,wontfix:Be};function he({severity:a,size:e="sm",showLabel:r=!0}){const n=Fe[a];return(0,t.jsx)(Q,{meta:n,Icon:Yt[a]??B,size:e,showLabel:r})}function ge({status:a,size:e="sm",showLabel:r=!0,variant:n="dot"}){const i=vt[a];if(n==="chip")return(0,t.jsx)(Q,{meta:i,Icon:Qt[a]??B,size:e,showLabel:r});const l=e==="xs"?6:8;return(0,t.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:6,fontSize:e==="xs"?Y.xs:Y.sm,color:i.text,fontWeight:500,whiteSpace:"nowrap"},children:[(0,t.jsx)("span",{"aria-hidden":!0,style:{width:l,height:l,borderRadius:"50%",background:i.solid,flexShrink:0}}),r&&(0,t.jsx)("span",{children:i.label})]})}var Xt={feature:ht,chunk:mt,bug:Ft,change:Bt,task:ut,bet:Lt,"research-task":ct};function Zt({kind:a,size:e="sm",showLabel:r=!0}){const n=ye[a];return(0,t.jsx)(Q,{meta:n,Icon:Xt[a]??B,size:e,showLabel:r,labelOverride:a in ye?void 0:a})}var ea={queen:"☕",overwatch:"🫖",bee:"🍵",sentinel:"🥤",planner:"📋",su:"🛠",mug:"☕",kettle:"🫖",cup:"🍵",papercup:"🥤"};function ta({kind:a,size:e="sm",showLabel:r=!0}){const n=ae(),i=_e[a],l=yt(a),s=l?n(l):a in _e?void 0:a;return(0,t.jsx)(Q,{meta:i,glyph:ea[a]??"·",size:e,showLabel:r,labelOverride:s})}var ke=["open","wip","blocked","needs-human","done","dropped"];function we(a){try{return JSON.parse(a)}catch{return a}}function aa(a,e,r){return r||!e||!Array.isArray(a)?null:a.filter(n=>n.featureId===e).map(n=>({ts:n.ts,field:n.field,old:n.oldValue?we(n.oldValue):null,new:n.newValue?we(n.newValue):null,actor:n.actor??""}))}function na({slug:a,feature:e,onClose:r,onSaved:n,embedded:i=!1}){const l=te(),s=e===null,[m,f]=(0,d.useState)(e?.id??""),[o,c]=(0,d.useState)(e?.title??""),[j,g]=(0,d.useState)((e?.claims??[]).join(`
`)),[x,v]=(0,d.useState)(e?.status??"open"),[h,_]=(0,d.useState)(e?.attempts??0),[b,$]=(0,d.useState)(e?.deprecation_reason??""),[N,R]=(0,d.useState)(!1),[p,y]=(0,d.useState)(null),{confirm:A,element:F}=Ee();(0,d.useEffect)(()=>{e&&(f(e.id),c(e.title),g((e.claims??[]).join(`
`)),v(e.status),_(e.attempts),$(e.deprecation_reason??""))},[e]);const E=(0,d.useCallback)(async()=>{R(!0);try{const k=j.split(`
`).map(M=>M.trim()).filter(Boolean);if(x==="dropped"&&b.trim()===""){y('Deprecation reason is required when status is "dropped".'),R(!1);return}if(s){const M=await fetch(`/api/harness/${a}/features`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:m,title:o,claims:k,status:x})});if(!M.ok)throw new Error(`${M.status}: ${await M.text()}`)}else{const M={title:o,claims:k,status:x,attempts:h};x==="dropped"&&(M.deprecation_reason=b.trim());const V=await fetch(`/api/harness/${a}/features/${m}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(M)});if(!V.ok)throw new Error(`${V.status}: ${await V.text()}`)}y("saved"),n(),setTimeout(()=>{r()},400)}catch(k){y(`save failed: ${k}`)}finally{R(!1)}},[a,m,o,j,x,h,s,r,n]),I=(0,d.useCallback)(async()=>{if(e&&await A({title:`Delete feature ${e.id}?`,body:"This cannot be undone.",confirmLabel:"Delete",destructive:!0})){R(!0);try{const k=await fetch(`/api/harness/${a}/features/${e.id}`,{method:"DELETE"});if(!k.ok)throw new Error(`${k.status}: ${await k.text()}`);y("deleted"),n(),setTimeout(()=>{r()},400)}catch(k){y(`delete failed: ${k}`)}finally{R(!1)}}},[a,e,r,n,A]),[S,z]=q("history",Ze.withDefault(!1)),[u,w]=(0,d.useState)(null),{data:T}=P({queryName:"featureAudit.byHarness",args:{harnessSlug:a,workspaceId:l},enabled:!s&&!!a}),C=(0,d.useMemo)(()=>aa(T,e?.id,s),[T,s,e?.id]);(0,d.useEffect)(()=>{const k=M=>{(M.metaKey||M.ctrlKey)&&M.key.toLowerCase()==="s"&&(M.preventDefault(),E())};return window.addEventListener("keydown",k),()=>window.removeEventListener("keydown",k)},[E]);const W=(0,t.jsxs)(t.Fragment,{children:[F,(0,t.jsxs)("div",{style:{padding:"0.75rem 1rem",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:"0.75rem"},children:[(0,t.jsx)("strong",{style:{color:"var(--fg)"},children:s?"New feature":`Edit ${e.id}`}),(0,t.jsx)("span",{style:{color:"var(--fg-mute)",fontSize:"0.75rem",fontFamily:"monospace"},title:"Features live in Postgres (harness_features); edits dispatch via /api/harness/<slug>/features",children:"harness_features"}),(0,t.jsxs)("div",{style:{marginLeft:"auto",display:"flex",gap:"0.5rem",alignItems:"center"},children:[p&&(0,t.jsx)("span",{style:{color:/failed/i.test(p)?"var(--bad)":"var(--good)",fontSize:"0.8rem"},children:p}),!s&&(0,t.jsx)("button",{onClick:I,disabled:N,style:{background:"transparent",color:"var(--bad)",border:"1px solid #7f1d1d",borderRadius:3,padding:"0.35rem 0.75rem",cursor:N?"wait":"pointer",fontSize:"0.8rem"},children:"delete"}),(0,t.jsx)("button",{onClick:E,disabled:N||!o.trim()||s&&!m.trim(),style:{background:"#2563eb",color:"white",border:"none",borderRadius:3,padding:"0.35rem 0.9rem",cursor:N?"wait":"pointer",fontWeight:600},children:N?"saving…":"save"}),(0,t.jsx)("button",{onClick:r,style:{background:"transparent",color:"var(--fg-mute)",border:"1px solid var(--border)",borderRadius:3,padding:"0.35rem 0.75rem",cursor:"pointer"},children:"cancel"})]})]}),(0,t.jsxs)("div",{style:{flex:1,overflow:"auto",padding:"1rem",display:"flex",flexDirection:"column",gap:"0.9rem"},children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"ID"}),(0,t.jsx)("input",{value:m,onChange:k=>f(k.target.value.toUpperCase()),disabled:!s,placeholder:"F-NEW-001",style:{width:"100%",boxSizing:"border-box",background:s?"#111827":"#1f2937",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontFamily:"monospace",fontSize:"0.85rem",opacity:s?1:.6}}),s&&(0,t.jsxs)("div",{style:{fontSize:"0.7rem",color:"var(--fg-mute)",marginTop:"0.25rem"},children:["must match ",(0,t.jsx)("code",{children:"^F-[A-Z0-9-]+$"}),". Convention: ",(0,t.jsx)("code",{children:"F-FIX-001"})," for fix features."]})]}),(0,t.jsxs)("div",{children:[(0,t.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Title"}),(0,t.jsx)("textarea",{value:o,onChange:k=>c(k.target.value),rows:2,style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem",resize:"vertical",fontFamily:"system-ui, sans-serif"}})]}),(0,t.jsxs)("div",{children:[(0,t.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Claims — one per line (validation contract IDs)"}),(0,t.jsx)("textarea",{value:j,onChange:k=>g(k.target.value),rows:6,placeholder:`VAL-GRID-001
VAL-GRID-002`,style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.8rem",fontFamily:"ui-monospace, monospace",resize:"vertical"}})]}),(0,t.jsxs)("div",{style:{display:"flex",gap:"1rem"},children:[(0,t.jsxs)("div",{style:{flex:1},children:[(0,t.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Status"}),(0,t.jsx)(fe,{value:x,onChange:k=>v(k),ariaLabel:"Status",options:[...ke.map(k=>({value:k,label:k})),...ke.includes(x)?[]:[{value:x,label:`${x} (legacy)`}]],triggerStyle:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem"}})]}),!s&&(0,t.jsxs)("div",{style:{flex:1},children:[(0,t.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Attempts"}),(0,t.jsx)("input",{type:"number",min:0,value:h,onChange:k=>_(Math.max(0,Math.floor(Number(k.target.value)||0))),style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem"}})]})]}),x==="dropped"&&(0,t.jsxs)("div",{children:[(0,t.jsxs)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:["Deprecation reason ",(0,t.jsx)("span",{style:{color:"var(--bad)"},children:"(required)"})]}),(0,t.jsx)("textarea",{value:b,onChange:k=>$(k.target.value),placeholder:"e.g. The plan no longer asks for JWT cookie rotation; replaced by F-AUTH-012 (session cookies).",rows:3,style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem",fontFamily:"inherit",resize:"vertical"}}),(0,t.jsx)("p",{style:{margin:"0.35rem 0 0",fontSize:"0.7rem",color:"var(--fg-mute)"},children:"Code is not auto-removed when a feature is deprecated; the row stays for audit and is hidden from default queue views."})]}),!s&&(0,t.jsxs)(nt,{open:S,onOpenChange:z,style:{marginTop:"0.5rem",borderTop:"1px solid var(--border)",paddingTop:"0.6rem"},children:[(0,t.jsx)(rt,{asChild:!0,children:(0,t.jsxs)("button",{type:"button",style:{cursor:"pointer",fontSize:"0.8rem",color:"var(--fg-mute)",userSelect:"none",background:"none",border:"none",padding:0,textAlign:"left"},children:["History ",C?`(${C.length})`:""]})}),(0,t.jsxs)(it,{style:{marginTop:"0.5rem",fontSize:"0.75rem",maxHeight:240,overflowY:"auto"},children:[u&&(0,t.jsxs)("div",{style:{color:"var(--bad)"},children:["Failed to load: ",u]}),!u&&C===null&&S&&(0,t.jsx)("div",{style:{color:"var(--fg-mute)"},children:"Loading…"}),!u&&C!==null&&C.length===0&&(0,t.jsx)("div",{style:{color:"var(--fg-mute)"},children:"No edit history yet."}),C&&C.length>0&&(0,t.jsx)("div",{style:{display:"flex",flexDirection:"column",gap:"0.25rem"},children:C.map((k,M)=>{const V=H=>H==null?"∅":typeof H=="string"?H.length>40?H.slice(0,37)+"…":H:JSON.stringify(H).slice(0,40);return(0,t.jsxs)("div",{style:{display:"grid",gridTemplateColumns:"11ch 9ch 1fr",gap:"0.5rem",alignItems:"baseline",color:"var(--fg)"},children:[(0,t.jsx)("span",{style:{color:"var(--fg-mute)",fontVariantNumeric:"tabular-nums"},children:new Date(k.ts).toLocaleString(void 0,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}),(0,t.jsx)("span",{style:{color:"#a1a1aa"},children:k.actor}),(0,t.jsxs)("span",{children:[(0,t.jsx)("code",{style:{color:"var(--warn)"},children:k.field}),(0,t.jsx)("span",{style:{color:"var(--fg-mute)"},children:": "}),(0,t.jsx)("span",{style:{color:"var(--fg-mute)"},children:V(k.old)}),(0,t.jsx)("span",{style:{color:"var(--fg-mute)"},children:" → "}),(0,t.jsx)("span",{children:V(k.new)})]})]},M)})})]})]})]})]});return i?(0,t.jsx)("div",{style:{height:"100%",minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg-1, #0b1220)",fontFamily:"system-ui, sans-serif"},children:W}):(0,t.jsx)(Ae,{open:!0,onOpenChange:k=>{k||r()},title:"Edit feature",srOnlyTitle:!0,contentStyle:{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:6,width:"70vw",maxWidth:720,height:"65vh",display:"flex",flexDirection:"column",overflow:"hidden",fontFamily:"system-ui, sans-serif"},children:W})}function Se(a){if(a){if(Array.isArray(a))return a.map(e=>String(e));if(typeof a=="string")try{const e=JSON.parse(a);if(Array.isArray(e))return e.map(r=>String(r))}catch{}}}function ra(a){if(a==null)return;let e;if(Array.isArray(a))e=a;else if(typeof a=="string"){const n=a.trim();if(!n||n==="{}"||n==="[]")return;if(n.startsWith("{")&&n.endsWith("}"))e=n.slice(1,-1).split(",");else try{const i=JSON.parse(n);e=Array.isArray(i)?i:[]}catch{return}}else return;const r=e.map(n=>typeof n=="number"?n:Number.parseInt(String(n).trim(),10)).filter(n=>Number.isInteger(n)&&n>0);return r.length>0?r:void 0}function ia(a){const e=te(),[r,n]=(0,d.useState)(null),[i,l]=(0,d.useState)(null),{data:s,loading:m,error:f}=P({queryName:"featuresConsolidated.bySlug",args:a?{harnessSlug:a,workspaceId:e}:void 0,enabled:!!a});(0,d.useEffect)(()=>{if(!a){n(null),l(null);return}m||!Array.isArray(s)||n(s.map(c=>({id:c.featureId,title:c.title,summary:c.summary??void 0,status:c.status,attempts:Number(c.attempts)||0,claims:Se(c.claims),sourcePlanSlug:c.sourcePlanSlug??void 0,needsReview:c.needsHumanReview??c.needs_human_review??void 0,tags:Se(c.tags),workingUsers:ra(c.workingUsers??c.working_users)})))},[a,s,m]),(0,d.useEffect)(()=>{l(f?f instanceof Error?f.message:String(f):null)},[f]);const o=(0,d.useCallback)((c,j)=>{n(g=>g&&g.map(x=>x.id===c?{...x,...j}:x))},[]);return{features:r,loading:r===null&&!i,error:i,patchFeature:o}}function sa(a){const e=typeof a.foundAt=="number"?a.foundAt:Date.parse(String(a.foundAt));return{id:a.issueId,title:a.title,severity:a.severity,source:a.source,status:a.status,foundAt:Number.isFinite(e)?new Date(e).toISOString():"",foundDuring:a.foundDuring??void 0,repro:a.repro??void 0,evidence:a.evidence??void 0,suggestedFix:a.suggestedFix??void 0,codePointer:a.codePointer??void 0,linkedFeatureId:a.linkedFeatureId??void 0,attempts:Number(a.attempts)||0,notes:Array.isArray(a.notes)?a.notes:[]}}function la(a){const e=te(),[r,n]=(0,d.useState)(null),[i,l]=(0,d.useState)(null),{data:s,loading:m,error:f}=P({queryName:"issuesConsolidated.bySlug",args:a?{harnessSlug:a,workspaceId:e}:void 0,enabled:!!a});(0,d.useEffect)(()=>{if(!a){n(null),l(null);return}m||!Array.isArray(s)||n(s.map(sa))},[a,s,m]),(0,d.useEffect)(()=>{l(f?f instanceof Error?f.message:String(f):null)},[f]);const{data:o}=P({queryName:"harnessPendingIssues.byHarness",args:a?{harnessSlug:a,phase:"staging",workspaceId:e}:void 0,enabled:!!a}),c=Array.isArray(o)?o.length:0,j=(0,d.useCallback)((g,x)=>{n(v=>v&&v.map(h=>h.id===g?{...h,...x}:h))},[]);return{issues:r,pendingCount:c,loading:r===null&&!i,error:i,patchIssue:j}}function Ne(a){if(a==null)return;if(typeof a=="number")return a;const e=Date.parse(String(a));return Number.isFinite(e)?e:void 0}function xn(a){const[e,r]=(0,d.useState)(null),[n,i]=(0,d.useState)(null),{data:l,loading:s,error:m,invalidate:f}=P({queryName:"agentRunsConsolidated.bySlug",args:a?{harnessSlug:a}:void 0,enabled:!!a}),o=(0,d.useCallback)(()=>f(),[f]);return(0,d.useEffect)(()=>{if(!a){r(null),i(null);return}s||!Array.isArray(l)||r(l.map(c=>({runId:c.runId,role:c.role,ts:Ne(c.ts),sizeBytes:Number(c.sizeBytes)||0,running:!!c.running,lastEventTs:Ne(c.lastEventTs),costUsd:c.costUsd!=null?Number(c.costUsd):void 0,featureId:c.featureId??void 0})))},[a,l,s]),(0,d.useEffect)(()=>{i(m?m instanceof Error?m.message:String(m):null)},[m]),{agents:e,total:Array.isArray(l)?De(l):e?.length??0,loading:e===null&&!n,error:n,refresh:o}}function bn(a,e=300){const[r,n]=(0,d.useState)(null),[i,l]=(0,d.useState)(null),[s,m]=(0,d.useState)(0),f=(0,d.useCallback)(()=>m(o=>o+1),[]);return(0,d.useEffect)(()=>{if(!a){n(null);return}let o=!1;return l(null),fetch(`/api/harness/${encodeURIComponent(a)}/log/history?limit=${e}&phase=staging`).then(c=>c.ok?c.json():Promise.reject(new Error(`log/history ${c.status}`))).then(c=>{o||n(Array.isArray(c.events)?c.events:[])}).catch(c=>{o||l(c.message)}),()=>{o=!0}},[a,e,s]),{events:r,loading:r===null&&!i,error:i,refresh:f}}async function Ce(a,e){const r=await fetch(a,{method:"POST",headers:e!==void 0?{"content-type":"application/json"}:void 0,body:e!==void 0?JSON.stringify(e):void 0});if(!r.ok)throw new Error(`${r.status}: ${await r.text()}`)}function Ve(a){switch(a){case"acknowledge":return"acknowledged";case"close":return"closed";case"wontfix":return"wontfix";default:return null}}async function oa(a,e,r){const n=`/api/harness/${encodeURIComponent(a)}/issues/${encodeURIComponent(e)}`;r==="promote"?await Ce(`${n}/promote`,{}):await Ce(`${n}/update`,{status:Ve(r)})}function da(a){return et({parse:e=>Et(e,a),serialize:e=>oe(e),eq:(e,r)=>oe(e)===oe(r)}).withDefault({})}function ca(a,e,r){const{ns:n}=r,i=(0,d.useMemo)(()=>da(a),[a]),[l,s]=q(n+"f",i),m=(0,d.useMemo)(()=>a.filter(h=>!!h.filter),[a]),f=(0,d.useMemo)(()=>wt(e,l,a),[e,l,a]),o=(0,d.useCallback)((h,_)=>{s(b=>({...b??{},[h]:_}))},[s]),c=(0,d.useCallback)(h=>{s(_=>{if(!_||!(h in _))return _;const b={..._};return delete b[h],b})},[s]),j=(0,d.useCallback)(()=>{s(null)},[s]),g=(0,d.useMemo)(()=>{const h=new Map;for(const _ of m)_.filter?.type==="enum"&&h.set(_.key,St(e,_));return h},[m,e]),x=(0,d.useMemo)(()=>({filterableColumns:m,valueFor:h=>l?.[h],setValue:o,remove:c,optionsFor:h=>g.get(h)??[]}),[m,l,o,c,g]),v=(0,d.useMemo)(()=>{if(!l)return[];const h=[];for(const _ of m){const b=l[_.key];if(b===void 0)continue;const $=Rt(_,b);$&&h.push({colKey:_.key,label:$,clear:()=>c(_.key)})}return h},[l,m,c]);return{rows:f,controller:x,activeChips:v,clearAll:j,hasActive:v.length>0}}var de="_add_filter_";function L(a){const e=a.header;return typeof e=="string"&&e.length>0?e:typeof e=="number"?String(e):typeof a.headerText=="string"&&a.headerText.length>0?a.headerText:a.key}var ua={display:"flex",flexDirection:"column",gap:8,minWidth:200,maxWidth:280,padding:10,background:"color-mix(in srgb, var(--bg-deeper, #0b1622), transparent 2%)",color:"var(--fg, #e7f7ff)",border:"1px solid color-mix(in oklab, var(--accent, #38bdf8), transparent 62%)",borderRadius:10,boxShadow:"0 18px 54px rgba(0,0,0,0.62)",fontSize:12},pa={fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--fg-mute, #7f9bb4)"},ma={display:"flex",alignItems:"center",gap:6},fa=8,ha={display:"flex",flexDirection:"column",gap:4,maxHeight:220,overflowY:"auto"},ga={width:"100%",padding:"4px 7px",fontSize:12,fontFamily:"inherit",color:"var(--fg, #e7f7ff)",background:"var(--bg-2, rgba(255,255,255,0.045))",border:"1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%))",borderRadius:6},va={display:"flex",alignItems:"center",gap:8,fontSize:10.5,color:"var(--fg-mute, #7f9bb4)"},xa={display:"flex",alignItems:"center",gap:8,cursor:"pointer"},ba={marginLeft:"auto",color:"var(--fg-mute, #7f9bb4)",fontVariantNumeric:"tabular-nums"},$e={width:70,padding:"4px 7px",fontSize:12,fontFamily:"inherit",color:"var(--fg, #e7f7ff)",background:"var(--bg-2, rgba(255,255,255,0.045))",border:"1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%))",borderRadius:6};function ya(a){return typeof a=="string"?a:""}function me(a){return Array.isArray(a)?a:[]}function _a(a){return a&&typeof a=="object"&&!Array.isArray(a)?a:{}}function ja(a){return typeof a=="boolean"?a:void 0}function ka({col:a,controller:e,onClose:r}){const[n,i]=(0,d.useState)(""),l=a.filter;if(!l)return null;const s=e.valueFor(a.key),m=o=>{o.key==="Enter"&&(o.preventDefault(),r())};if(l.type==="text")return(0,t.jsx)("input",{type:"text",className:"pc-advpanel__input",autoFocus:!0,value:ya(s),onChange:o=>e.setValue(a.key,o.target.value),onKeyDown:m,placeholder:`Filter ${L(a)}…`,"aria-label":`Filter ${L(a)}`,style:{width:"100%"}});if(l.type==="enum"){const o=e.optionsFor(a.key),c=me(s),j=l.multi!==!1,g=(b,$)=>{if(!j){e.setValue(a.key,$?[b]:[]);return}const N=$?[...c,b]:c.filter(R=>R!==b);e.setValue(a.key,N)},x=o.length>fa,v=n.trim().toLowerCase(),h=v?o.filter(b=>(b.label??b.value).toLowerCase().includes(v)):o,_=L(a);return(0,t.jsxs)("div",{style:{display:"flex",flexDirection:"column",gap:6},children:[x?(0,t.jsx)("input",{type:"text",className:"pc-advpanel__input",autoFocus:!0,value:n,onChange:b=>i(b.target.value),placeholder:`Search ${_}…`,"aria-label":`Search ${_} options`,style:ga}):null,x&&c.length>0?(0,t.jsxs)("div",{style:va,children:[(0,t.jsxs)("span",{children:[c.length," selected"]}),(0,t.jsx)("button",{type:"button",className:"pc-advpanel__chip",style:{marginLeft:"auto",fontSize:10.5},onClick:()=>e.setValue(a.key,[]),children:"Clear selection"})]}):null,(0,t.jsx)("div",{style:ha,children:o.length===0?(0,t.jsx)("span",{style:{color:"var(--fg-mute, #7f9bb4)"},children:"No values"}):h.length===0?(0,t.jsx)("span",{style:{color:"var(--fg-mute, #7f9bb4)"},children:"No matches"}):h.map(b=>(0,t.jsxs)("label",{style:xa,children:[(0,t.jsx)(pt,{checked:c.includes(b.value),onChange:$=>g(b.value,$),ariaLabel:b.label??b.value}),(0,t.jsx)("span",{children:b.label??b.value}),(0,t.jsx)("span",{style:ba,children:b.count})]},b.value))})]})}if(l.type==="number"){const o=_a(s),c=(j,g)=>{const x={...o};if(g==="")delete x[j];else{const v=Number(g);if(Number.isNaN(v))return;x[j]=v}e.setValue(a.key,x)};return(0,t.jsxs)("div",{style:ma,children:[(0,t.jsx)("input",{type:"number",style:$e,value:o.min??"",onChange:j=>c("min",j.target.value),onKeyDown:m,placeholder:"min","aria-label":`${L(a)} minimum`}),(0,t.jsx)("span",{style:{color:"var(--fg-mute, #7f9bb4)"},children:"–"}),(0,t.jsx)("input",{type:"number",style:$e,value:o.max??"",onChange:j=>c("max",j.target.value),onKeyDown:m,placeholder:"max","aria-label":`${L(a)} maximum`})]})}const f=ja(s);return(0,t.jsx)("div",{style:{display:"flex",gap:6},children:[{label:"True",val:!0},{label:"False",val:!1}].map(o=>(0,t.jsx)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":f===o.val,onClick:()=>e.setValue(a.key,o.val),children:o.label},o.label))})}function wa({controller:a,activeChips:e,hasActive:r,clearAll:n,layout:i="compact",inlineMax:l=8,promote:s}){const m=at(tt.GRID_COLUMN_FILTERS),[f,o]=(0,d.useState)(null);if(!m)return null;const c=new Set(e.map(p=>p.colKey)),j=a.filterableColumns.filter(p=>!c.has(p.key)),g=a.filterableColumns.find(p=>p.key===f)??null,x=new Map(e.map(p=>[p.colKey,p.label])),v=p=>{setTimeout(()=>o(p),0)},h=(p,y,A,F)=>{const E=me(a.valueFor(p));if(!F){a.setValue(p,A?[y]:[]);return}a.setValue(p,A?[...E,y]:E.filter(I=>I!==y))},_=(0,t.jsx)(gt,{open:g!=null,onOpenChange:p=>{p||o(null)},trigger:(0,t.jsx)("span",{"aria-hidden":!0,style:{width:0,height:0}}),side:"bottom",align:"start",ariaLabel:g?`Edit ${L(g)} filter`:"Edit filter",autoFocusOnOpen:!0,contentStyle:ua,children:g?(0,t.jsxs)(t.Fragment,{children:[(0,t.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:8},children:[(0,t.jsx)("span",{style:pa,children:L(g)}),(0,t.jsx)("button",{type:"button",className:"pc-advpanel__iconbtn",style:{marginLeft:"auto",width:22,height:22},"aria-label":"Close filter editor",onClick:()=>o(null),children:(0,t.jsx)(be,{size:12})})]}),(0,t.jsx)(ka,{col:g,controller:a,onClose:()=>o(null)},g.key)]}):null});if(i==="facets")return(0,t.jsxs)("div",{className:"pc-advpanel__filterbar pc-advpanel__filterbar--facets",children:[a.filterableColumns.map(p=>{const y=p.filter,A=y?.type==="enum",F=me(a.valueFor(p.key)),E=A?a.optionsFor(p.key):[],I=L(p);if(A&&E.length>0&&E.length<=l){const z=y?.type==="enum"?y.multi!==!1:!0;return(0,t.jsxs)("div",{className:"pc-advpanel__facetgroup",children:[(0,t.jsx)("span",{className:"pc-advpanel__facetlabel",children:I}),E.map(u=>{const w=F.includes(u.value);return(0,t.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":w,onClick:()=>h(p.key,u.value,!w,z),children:[(0,t.jsx)("span",{children:u.label??u.value}),(0,t.jsx)("span",{className:"pc-advpanel__chipcount",children:u.count})]},u.value)})]},p.key)}const S=c.has(p.key);return(0,t.jsx)(O,{label:S?"Edit filter":`Filter by ${I}`,children:(0,t.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":S,onClick:()=>v(p.key),children:[S?x.get(p.key)??I:I,(0,t.jsx)(xe,{size:11,"aria-hidden":!0})]})},p.key)}),r?(0,t.jsx)("button",{type:"button",className:"pc-advpanel__chip",onClick:n,children:"Clear all"}):null,_]});const b=new Set(s??[]),$=a.filterableColumns.filter(p=>b.has(p.key)&&!c.has(p.key)),N=new Set($.map(p=>p.key)),R=[{value:de,label:"Add filter…",disabled:!0},...j.filter(p=>!N.has(p.key)).map(p=>({value:p.key,label:L(p)}))];return(0,t.jsxs)("div",{className:"pc-advpanel__filterbar",children:[(0,t.jsx)(Kt,{size:13,"aria-hidden":!0,style:{color:"var(--fg-mute, #7f9bb4)",flexShrink:0}}),$.map(p=>{const y=L(p);return(0,t.jsx)(O,{label:`Filter by ${y}`,children:(0,t.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":!1,onClick:()=>v(p.key),children:[y,(0,t.jsx)(xe,{size:11,"aria-hidden":!0})]})},p.key)}),e.map(p=>(0,t.jsx)(O,{label:"Edit filter",children:(0,t.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":!0,onClick:()=>v(p.colKey),children:[p.label,(0,t.jsx)(be,{size:11,"aria-label":`Remove ${p.label} filter`,onClick:y=>{y.stopPropagation(),f===p.colKey&&o(null),p.clear()}})]})},p.colKey)),j.length>0?(0,t.jsx)(fe,{value:de,onChange:p=>{p!==de&&v(p)},ariaLabel:"Add a column filter",triggerClassName:"pc-advpanel__chip",options:R}):null,r?(0,t.jsx)("button",{type:"button",className:"pc-advpanel__chip",onClick:n,children:"Clear all"}):null,_]})}var Sa=(0,d.memo)(wa);function qe(a){if(a.origin!=="remote")return null;const e=a.verifiedAuthorGithubUserId!=null?`GitHub user ${a.verifiedAuthorGithubUserId}`:"an unverified author";return a.trusted?{label:"trusted",color:"#34d399",title:`Remote work by ${e}, on your trust list — verified remote work auto-runs.`}:a.auditVerdict==="reject"?{label:"rejected",color:"#fb7185",title:`Remote work by ${e} — the admission auditor rejected it.`}:a.auditVerdict==="admit"?{label:"admitted",color:"var(--accent-strong, var(--accent))",title:`Remote work by ${e} — admitted by the auditor${a.verifiedAuthorGithubUserId!=null?" (author not on your trust list)":""}.`}:{label:"pending audit",color:"#fcd34d",title:`Remote work by ${e} — awaiting the admission verdict; not auto-running yet.`}}function Na(a){const e=qe(a);return e?(0,t.jsx)("span",{style:{display:"inline-block",padding:"1px 8px",borderRadius:999,fontSize:10,fontWeight:700,textTransform:"uppercase",whiteSpace:"nowrap",color:e.color,background:`color-mix(in srgb, ${e.color}, transparent 85%)`},title:e.title,children:e.label}):null}var K={display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"};function Ke({isTrusted:a}){return[{key:"id",header:"ID",width:1.4,toCopyText:e=>e.id,filter:{type:"text",accessor:e=>e.id},render:({row:e})=>(0,t.jsx)("code",{style:K,title:e.id,children:e.id})},{key:"kind",header:"Kind",width:1.2,toCopyText:e=>e.kind,filter:{type:"enum",accessor:e=>e.kind},render:({row:e})=>(0,t.jsx)(Zt,{kind:e.kind,size:"xs"})},{key:"title",header:"Title",width:4,toCopyText:e=>e.title,filter:{type:"text",accessor:e=>e.title},render:({row:e})=>(0,t.jsx)("span",{style:K,title:e.title,children:e.title})},{key:"state",header:"State",width:1.2,toCopyText:e=>e.state,filter:{type:"enum",accessor:e=>e.state},render:({row:e})=>e.family==="issue"?(0,t.jsx)(ge,{status:e.state,size:"xs",variant:"chip"}):(0,t.jsx)(ee,{status:e.state,size:"xs",variant:"chip"})},{key:"trust",header:"Trust",width:1.3,toCopyText:e=>qe({origin:e.origin,auditVerdict:e.auditVerdict,verifiedAuthorGithubUserId:e.verifiedAuthorGithubUserId,trusted:a(e)})?.label??"",render:({row:e})=>(0,t.jsx)(Na,{origin:e.origin,auditVerdict:e.auditVerdict,verifiedAuthorGithubUserId:e.verifiedAuthorGithubUserId,trusted:a(e)})},{key:"stage",header:"Stage",width:1.7,toCopyText:e=>e.spineRole?`${e.spineRole}${e.spineStatus?` (${e.spineStatus})`:""}`:"",filter:{type:"enum",accessor:e=>e.spineRole},render:({row:e})=>e.spineRole?(0,t.jsxs)("span",{style:K,title:`latest spine role · status (spawned_agents): ${e.spineRole}${e.spineStatus?` (${e.spineStatus})`:""}`,children:[e.spineRole,e.spineStatus?(0,t.jsxs)("span",{style:{color:"var(--fg-mute)"},children:[" (",e.spineStatus,")"]}):null]}):(0,t.jsx)(t.Fragment,{children:"—"})},{key:"assignee",header:"Assignee",width:1.8,toCopyText:e=>e.assignee??"",filter:{type:"enum",accessor:e=>e.assignee},render:({row:e})=>(0,t.jsxs)("span",{style:K,title:e.assignee?`${e.assignee}${e.assignedBy?` — delegated by ${e.assignedBy}`:""}`:void 0,children:[e.assignee??"—",e.assignedBy?(0,t.jsxs)("span",{style:{color:"var(--fg-mute)"},children:[" ·by ",e.assignedBy]}):null]})},{key:"severity",header:"Sev",width:.9,toCopyText:e=>e.severity??"",filter:{type:"enum",accessor:e=>e.severity},render:({row:e})=>e.severity?(0,t.jsx)(he,{severity:e.severity,size:"xs"}):(0,t.jsx)(t.Fragment,{children:"—"})},{key:"priority",header:"Prio",width:.8,toCopyText:e=>e.priority==null?"":String(e.priority),filter:{type:"number",accessor:e=>e.priority},render:({row:e})=>(0,t.jsx)(t.Fragment,{children:e.priority??"—"})},{key:"rank",header:"Rank",width:.8,toCopyText:e=>e.rank==null?"":String(e.rank),filter:{type:"number",accessor:e=>e.rank},render:({row:e})=>(0,t.jsx)(t.Fragment,{children:e.rank??"—"})},{key:"plan",header:"Plan",width:1.8,toCopyText:e=>e.planSlug??"",filter:{type:"enum",accessor:e=>e.planSlug},render:({row:e})=>e.planSlug?(0,t.jsx)("code",{style:{...K,fontSize:11},title:e.planSlug,children:e.planSlug}):(0,t.jsx)(t.Fragment,{children:"—"})}]}function yn(){return Ke({isTrusted:()=>!1}).map(a=>({key:a.key,header:a.header,width:a.width,filter:a.filter,render:a.render}))}function Ca(a,e,r){return r?{title:`${a} of ${e}`,summary:`${a} of ${e} match`}:{title:`${e}`,summary:`${e} item${e===1?"":"s"}`}}function _n({params:a,api:e}){const r=a.harnessSlug||"",[n,i]=q("wq",Z.withDefault("")),[l,s]=q("sel",Z.withDefault("")),[m,f]=jt("pc-colw:adv:work-items"),o=500,[c,j]=(0,d.useState)(o);(0,d.useEffect)(()=>{j(o)},[r]);const g=P({queryName:"workItems.byHarness",args:{harnessSlug:r,limit:c},enabled:!!r}),x=g.loading?null:g.data,v=g.fetching,h=g.error?g.error.message:null,_=P({queryName:"trust.list"}),b=(0,d.useMemo)(()=>new Set((_.data??[]).map(S=>S.githubUserId)),[_.data]),$=De(x),N=x!=null&&x.length<$,R=(0,d.useCallback)(()=>j(S=>S+o),[]),p=(0,d.useMemo)(()=>Ke({isTrusted:S=>S.verifiedAuthorGithubUserId!=null&&b.has(S.verifiedAuthorGithubUserId)}),[b]),y=ca(p,x??[],{ns:"wi"}),A=(0,d.useMemo)(()=>{const S=n.trim().toLowerCase();return S?y.rows.filter(z=>`${z.id} ${z.title} ${z.state} ${z.assignee??""}`.toLowerCase().includes(S)):y.rows},[y.rows,n]),F=y.hasActive||n.trim()!=="",E=x?Ca(A.length,$,F):null,I=E?.title;return(0,d.useEffect)(()=>{I!=null&&e.setTitle(`Work items · ${r} (${I})`)},[I,r,e]),r?(0,t.jsxs)("div",{className:"pc-advpanel",children:[(0,t.jsxs)("div",{className:"pc-advpanel__bar",children:[(0,t.jsx)("input",{type:"text",className:"pc-advpanel__input",value:n,onChange:S=>{i(S.target.value)},placeholder:"Filter work items…","aria-label":"Filter work items"}),(0,t.jsx)(Sa,{controller:y.controller,activeChips:y.activeChips,hasActive:y.hasActive,clearAll:y.clearAll}),E?(0,t.jsx)(O,{label:F?"Rows matching the current filter / search, out of the store total.":"Total work items for this harness.",children:(0,t.jsx)("span",{className:"pc-advpanel__count","data-testid":"wi-count","aria-live":"polite",style:{marginLeft:"auto",fontSize:11,color:"var(--fg-mute)",whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"},children:E.summary})}):null,(0,t.jsx)(O,{label:"Refresh work items",children:(0,t.jsx)("button",{type:"button",className:"pc-advpanel__iconbtn",onClick:()=>g.invalidate(),disabled:v,"aria-label":"Refresh work items",children:(0,t.jsx)(ft,{size:13,"aria-hidden":!0,className:v?"pc-advpanel__spin":void 0})})})]}),h?(0,t.jsxs)("div",{className:"pc-advpanel__empty pc-advpanel__empty--err",children:["Could not load work items: ",h]}):x?A.length===0?(0,t.jsx)("div",{className:"pc-advpanel__empty",children:x.length===0?"No work items for this harness.":"No work items match the filter."}):(0,t.jsx)(Xe,{columns:p,rows:A,resizableColumns:!0,columnWidths:m,onColumnWidthsChange:f,getRowId:S=>S.id,onRowClick:S=>{s(S.id)},getRowBg:S=>S.id===l?"color-mix(in oklab, var(--accent), transparent 80%)":void 0,rowMinHeight:30,headerHeight:30,onEndReached:N?R:void 0}):(0,t.jsx)("div",{className:"pc-advpanel__empty",children:"Loading work items…"})]}):(0,t.jsx)("div",{className:"pc-advpanel__empty",children:"Pick a harness to view its work items."})}function $a(a){const e=a.spawnStatus?.trim()||null,r=a.errorMessage?.trim()||void 0;switch(e){case"done":return{kind:"done",label:"done"};case"failed":return{kind:"failed",label:`failed${a.exitCode!=null&&a.exitCode!==0?` (exit ${a.exitCode})`:""}`,detail:r};case"cancelled":return{kind:"cancelled",label:"cancelled",detail:r};case"reaped":return{kind:"muted",label:"reaped",detail:r};case"running":case"restarting":return{kind:"running",label:e};default:return a.running?{kind:"running",label:"running"}:null}}var Aa=["open","wip","blocked","needs-human","done","dropped"],G=[],ce=!1;async function Ea(a,e){try{const r=await fetch("/api/adv/sessions/launch-su",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agent:"claude",harness_slug:a,resume_session_id:e})}),n=await r.json().catch(()=>({}));if(!r.ok||n.status==="error")throw new Error(n.error||`${r.status}`);D.success(`Session ${e.slice(0,12)}… opening in a terminal.`)}catch(r){D.error("Open session failed",{description:String(r)})}}function ve(a){const e=typeof a=="number"?a:Date.parse(String(a));if(!Number.isFinite(e))return"";const r=Math.max(0,Math.round((Date.now()-e)/1e3));if(r<60)return`${r}s ago`;const n=Math.round(r/60);if(n<60)return`${n}m ago`;const i=Math.round(n/60);return i<24?`${i}h ago`:`${Math.round(i/24)}d ago`}function Ia(a){return a.trim()?a.split(/^## \S+ \d{4}-\d{2}-\d{2}T[^\n]+\s*$/gm).map(e=>e.trim()).filter(Boolean):[]}function Ta(a){return a?a.startsWith("F-")?"feature":a.startsWith("I-")?"issue":a.startsWith("agent:")?"agent":"workItem":null}function jn({params:a,api:e}){const r=ae(),n=a.harnessSlug||"",i=a.itemId||null,[l,s]=q("sel",Z.withDefault("")),[m,f]=q("edit",Z.withDefault("")),o=i??l,{features:c,patchFeature:j}=ia(n),{issues:g,patchIssue:x}=la(n),{data:v}=P({queryName:"agentRunsConsolidated.bySlug",args:n?{harnessSlug:n}:void 0,enabled:!!n}),h=(0,d.useCallback)(C=>{s(C||null),f(null)},[s,f]),_=(0,d.useRef)("");(0,d.useEffect)(()=>{if(i)return;if(ce){ce=!1,_.current=l;return}const C=_.current;C&&C!==l&&(G.push(C),G.length>50&&G.shift()),_.current=l},[l,i]);const b=(0,d.useCallback)(()=>{const C=G.pop();C!==void 0&&(ce=!0,s(C||null))},[s]),$=!i&&G.length>0?b:void 0,N=(0,d.useMemo)(()=>Ta(o),[o]),R=P({queryName:"featuresConsolidated.detail",args:{harnessSlug:n,featureId:o,workspaceId:te()},enabled:!!n&&N==="feature"&&!!o}),p=!R.loading&&R.data?.[0]?.featureId===o?R.data[0].summary??void 0:void 0,y=(0,d.useMemo)(()=>{if(N!=="feature")return null;const C=(c??[]).find(W=>W.id===o)??null;return C?p!==void 0?{...C,summary:p}:C:null},[N,c,o,p]),A=(0,d.useMemo)(()=>N==="issue"?(g??[]).find(C=>C.id===o)??null:null,[N,g,o]),F=P({queryName:"workItems.byHarness",args:{harnessSlug:n,limit:500},enabled:!!n&&N==="workItem"}),E=F.loading?null:F.data,I=P({queryName:"workItems.detail",args:{harnessSlug:n,id:o},enabled:!!n&&N==="workItem"&&!!o}),S=I.loading?null:I.data?.[0]??null,z=(0,d.useMemo)(()=>{if(N!=="workItem")return null;const C=(E??[]).find(W=>W.id===o)??null;return S&&S.id===o?S:C},[N,E,S,o]),u=P({queryName:"fleetAssignments.byHarness",args:{harnessSlug:n},enabled:!!n&&N==="agent"}),w=u.loading?null:u.data,T=(0,d.useMemo)(()=>N==="agent"?(w??[]).find(C=>`agent:${C.agentId}`===o)??null:null,[N,w,o]);return(0,d.useEffect)(()=>{i?e.setTitle(i):y?e.setTitle(`Detail · ${y.id}`):A?e.setTitle(`Detail · ${A.id}`):z?e.setTitle(`Detail · ${z.id}`):T?e.setTitle(`Detail · ${Me(T.name??T.label??T.agentId,r)}`):e.setTitle("Detail")},[e,i,y,A,z,T,r]),n?o?o&&!y&&!A&&!z&&!T?c===null||g===null||N==="workItem"&&E===null||N==="agent"&&w===null?(0,t.jsxs)(J,{children:["Loading ",o,"…"]}):N==="agent"?(0,t.jsxs)(J,{children:["Agent ",o.slice(6)," is no longer working here."]}):(0,t.jsxs)(J,{tone:"error",children:["No item found for ",o,"."]}):y?(0,t.jsx)(za,{slug:n,feature:y,issues:g??[],runs:Array.isArray(v)?v:[],onSelect:h,onBack:$,patchFeature:j,isEditing:!i&&m===y.id,onStartEdit:()=>{f(y.id)},onCloseEdit:()=>{f(null)}}):A?(0,t.jsx)(Fa,{slug:n,issue:A,onSelect:h,onBack:$,patchIssue:x}):z?(0,t.jsx)(Ge,{slug:n,workItem:z,onSelect:h,onBack:$}):T?(0,t.jsx)(Ra,{agent:T,onSelect:h,onBack:$}):null:(0,t.jsx)(J,{children:"Pick a work item from the list to inspect."}):(0,t.jsxs)(J,{children:["Pick a ",r("pot",{lower:!0})," to inspect its work items."]})}function Ra({agent:a,onSelect:e,onBack:r}){const n=ae(),i=st(a.heartbeatAt??""),l=s=>!!s&&(s.startsWith("F-")||s.startsWith("I-")||s.startsWith("WI-"));return(0,t.jsxs)("div",{className:"pc-adv-detail pc-adv-detail--compact",children:[(0,t.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,t.jsx)(re,{onBack:r}),(0,t.jsx)("div",{className:"pc-adv-detail__id",children:a.agentId}),(0,t.jsx)("div",{className:"pc-adv-detail__title",children:Me(a.name??a.label??a.agentId,n)}),(0,t.jsxs)("div",{className:"pc-adv-detail__meta",children:[(0,t.jsx)(ta,{kind:a.agentPaneKind,size:"xs"}),(0,t.jsxs)("span",{className:"pc-adv-detail__liveness",children:[(0,t.jsx)(lt,{liveness:i,title:""}),i,a.heartbeatAt?(0,t.jsxs)("span",{className:"pc-adv-detail__muted",children:[" · heartbeat ",ve(a.heartbeatAt)]}):null]}),a.driveMode?(0,t.jsxs)("span",{className:"pc-adv-detail__stat",children:["drive: ",a.driveMode]}):null,a.load>0?(0,t.jsxs)("span",{className:"pc-adv-detail__stat",children:["load: ",a.load]}):null,a.orphaned&&(0,t.jsx)(O,{label:"This agent holds claims but is no longer present — its work may need re-placing.",children:(0,t.jsx)("span",{className:"pc-adv-detail__warn-chip",children:"orphaned claims"})}),a.declaredUnclaimed&&(0,t.jsx)(O,{label:"Declared an intent without claiming items — invisible to fleet placement.",children:(0,t.jsx)("span",{className:"pc-adv-detail__warn-chip",children:"declared, unclaimed"})})]})]}),(0,t.jsxs)("section",{className:"pc-adv-detail__body",children:[a.intent?(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Intent"}),(0,t.jsx)("p",{className:"pc-adv-detail__prose",children:a.intent})]}):null,(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Working on"}),a.doing?(0,t.jsxs)("div",{className:"pc-adv-detail__related",children:[(0,t.jsx)(O,{label:a.doing.title,children:(0,t.jsxs)("button",{type:"button","data-testid":"agent-detail-doing",className:"pc-adv-detail__related-row",disabled:!l(a.doing.id),onClick:()=>l(a.doing.id)&&e(a.doing.id),children:[(0,t.jsx)("span",{className:"pc-adv-detail__related-id",children:a.doing.id}),(0,t.jsx)("span",{className:"pc-adv-detail__related-title",children:a.doing.title})]})}),a.queued.length>0&&(0,t.jsx)("div",{className:"pc-adv-detail__queue",children:a.queued.map((s,m)=>(0,t.jsx)("button",{type:"button",className:"pc-adv-detail__queue-chip",disabled:!l(s.id),onClick:()=>l(s.id)&&e(s.id),children:s.id},`${s.id}-${m}`))})]}):(0,t.jsx)("p",{className:"pc-adv-detail__muted",children:"Nothing claimed right now."})]}),a.claims.length>0&&(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsxs)("h3",{children:["Claims (",a.claims.length,")"]}),(0,t.jsx)("div",{className:"pc-adv-detail__related",children:a.claims.map((s,m)=>(0,t.jsxs)("div",{className:"pc-adv-detail__claim-row",children:[(0,t.jsx)("span",{className:"pc-adv-detail__related-id",children:l(s.id)?(0,t.jsx)("button",{type:"button",className:"pc-adv-detail__link pc-adv-detail__link-btn",onClick:()=>e(s.id),children:s.id}):s.id??s.type}),(0,t.jsx)("span",{className:"pc-adv-detail__claim-type",children:s.type}),(0,t.jsx)("span",{className:"pc-adv-detail__related-title",title:s.detail,children:s.detail})]},`${s.id??s.detail}-${m}`))})]})]}),(0,t.jsx)(ie,{})]})}function Ge({slug:a,workItem:e,onSelect:r,onBack:n,onOpenChat:i}){const[l,s]=(0,d.useState)(!1),m=async()=>{s(!0);try{const o=await We({slug:a,role:"worker",featureId:e.id,title:e.title,mode:"discuss",...i?{dispatch:!1}:{}});if(o&&typeof o=="object"&&"error"in o)throw new Error(String(o.error));i&&o&&typeof o=="object"&&"chatId"in o&&i(String(o.chatId))}catch(o){D.error("Open chat failed",{description:String(o)})}finally{s(!1)}},f=[["Kind",(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)("span",{className:"pc-adv-detail__kind-chip",children:e.kind})," ",(0,t.jsxs)("span",{className:"pc-adv-detail__muted",children:["(",e.family," family)"]})]})],["State",e.family==="issue"?(0,t.jsx)(ge,{status:e.state,size:"xs"}):(0,t.jsx)(ee,{status:e.state,size:"xs"})],["Severity",e.severity?(0,t.jsx)(he,{severity:e.severity,size:"xs"}):"—"],["Assignee",e.assignee?`${e.assignee}${e.assignedBy?` · by ${e.assignedBy}`:""}`:"—"],["Priority",e.priority??"—"],["Rank",e.rank??"—"],["Stage",e.spineRole?`${e.spineRole}${e.spineStatus?` (${e.spineStatus})`:""}`:"—"],["Updated",e.updatedAt?(0,t.jsx)("span",{title:new Date(e.updatedAt).toLocaleString(),children:ve(e.updatedAt)}):"—"]];return(0,t.jsxs)("div",{className:"pc-adv-detail pc-adv-detail--compact",children:[(0,t.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,t.jsx)(re,{onBack:n}),(0,t.jsx)("div",{className:"pc-adv-detail__id",children:e.id}),(0,t.jsx)("div",{className:"pc-adv-detail__title",children:e.title})]}),(0,t.jsxs)("div",{className:"pc-adv-detail__body",children:[(0,t.jsxs)("div",{className:"pc-adv-detail__section pc-adv-detail__fields",children:[f.map(([o,c])=>(0,t.jsxs)("div",{className:"pc-adv-detail__field-row",children:[(0,t.jsx)("span",{className:"pc-adv-detail__field-label",children:o}),(0,t.jsx)("span",{children:c})]},o)),e.planSlug?(0,t.jsxs)("div",{className:"pc-adv-detail__field-row",children:[(0,t.jsx)("span",{className:"pc-adv-detail__field-label",children:"Plan"}),(0,t.jsx)("code",{className:"pc-adv-detail__pointer",children:e.planSlug})]}):null]}),e.summary?(0,t.jsx)("div",{className:"pc-adv-detail__section",children:(0,t.jsx)("div",{className:"pc-adv-detail__prose",children:e.summary})}):null,e.family==="feature"&&e.id.startsWith("F-")?(0,t.jsxs)("button",{type:"button",className:"pc-adv-detail__link pc-adv-detail__link-btn",onClick:()=>r(e.id),children:["Open feature detail ",(0,t.jsx)(Ie,{size:12})]}):null,(0,t.jsx)("div",{className:"pc-adv-detail__section",children:(0,t.jsx)("div",{className:"pc-adv-detail__actions",children:(0,t.jsxs)("button",{type:"button","data-testid":"wi-detail-chat",disabled:l,onClick:()=>{m()},children:[(0,t.jsx)(Re,{size:13,"aria-hidden":!0})," Chat"]})})})]}),(0,t.jsx)(ie,{})]})}function re({onBack:a}){return a?(0,t.jsx)(O,{label:"Back to previous selection",children:(0,t.jsx)("button",{type:"button",className:"pc-adv-detail__back",onClick:a,children:"← Back"})}):null}function za({slug:a,feature:e,issues:r,runs:n,onSelect:i,onBack:l,patchFeature:s,isEditing:m,onStartEdit:f,onCloseEdit:o}){const c=ae(),[j,g]=(0,d.useState)(null),[x,v]=(0,d.useState)(null),[h,_]=(0,d.useState)(!1),[b,$]=(0,d.useState)(""),{confirm:N,element:R}=Ee(),p=P({queryName:"featureNotes.byHarness",args:{harnessSlug:a},enabled:!!a,staleTime:3e4}),y=p.data?.find(u=>u.featureId===e.id),A=(0,d.useCallback)(async()=>{const u=b.trim();if(u){g("steer");try{const w=await fetch(`/api/harness/${encodeURIComponent(a)}/features/${encodeURIComponent(e.id)}/notes`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:u})});if(!w.ok)throw new Error(`${w.status}: ${await w.text()}`);v(T=>[...T??[],u]),p.invalidate(),$(""),_(!0),D.success("Steer note added")}catch(w){D.error("Add steer note failed",{description:String(w)})}finally{g(null)}}},[e.id,p,a,b]),F=(0,d.useMemo)(()=>r.filter(u=>u.linkedFeatureId===e.id||u.foundDuring===e.id),[r,e.id]),E=(0,d.useMemo)(()=>n.filter(u=>u.featureId===e.id).sort((u,w)=>Date.parse(String(w.ts))-Date.parse(String(u.ts))).slice(0,3),[n,e.id]);(0,d.useEffect)(()=>{if(p.loading){v(null);return}v(Ia(y?.content??""))},[p.loading,y?.content]);const I=(0,d.useCallback)(async(u,w)=>{const T=await fetch(`/api/harness/${encodeURIComponent(a)}${u}`,w);if(!T.ok)throw new Error(`${T.status}: ${await T.text()}`);return T.json()},[a]),S=(0,d.useCallback)(async u=>{const w=e.status;s(e.id,{status:u}),g(`status:${u}`);try{await I(`/features/${e.id}?phase=staging`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:u})}),D.success(`${e.id} → ${u}`)}catch(T){s(e.id,{status:w}),D.error("Status change failed",{description:String(T)})}finally{g(null)}},[I,e.id,e.status,s]),z=(0,d.useCallback)(async()=>{if(!await N({title:`Reset ${e.id}?`,body:`Reset ${e.id} back to open and clear its attempts. The worker will pick it up fresh.`,destructive:!0,confirmLabel:"Reset"}))return;const u={status:e.status,attempts:e.attempts};s(e.id,{status:"open",attempts:0}),g("reset");try{await I(`/features/${e.id}/reset?phase=staging`,{method:"POST"}),D.success(`${e.id} reset`)}catch(w){s(e.id,u),D.error("Reset failed",{description:String(w)})}finally{g(null)}},[I,e.id,e.status,e.attempts,s,N]);return m?(0,t.jsx)(na,{embedded:!0,slug:a,feature:{id:e.id,title:e.title,claims:e.claims,status:e.status,attempts:e.attempts??0},onClose:o,onSaved:()=>{}}):(0,t.jsxs)("div",{className:"pc-adv-detail",children:[(0,t.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,t.jsx)(re,{onBack:l}),(0,t.jsx)("div",{className:"pc-adv-detail__id",children:e.id}),(0,t.jsx)("div",{className:"pc-adv-detail__title",children:e.title}),(0,t.jsxs)("div",{className:"pc-adv-detail__meta",children:[(0,t.jsx)(ee,{status:e.status}),typeof e.attempts=="number"&&e.attempts>0&&(0,t.jsxs)("span",{className:"pc-adv-detail__attempts",children:[e.attempts,"× attempts"]}),e.sourcePlanSlug&&(0,t.jsx)(O,{label:`From plan: ${e.sourcePlanSlug}`,children:(0,t.jsxs)("span",{className:"pc-adv-detail__plan",children:["↗ ",e.sourcePlanSlug]})})]})]}),(0,t.jsxs)("section",{className:"pc-adv-detail__body",children:[(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Description"}),e.summary?(0,t.jsx)("p",{className:"pc-adv-detail__prose",children:e.summary}):(0,t.jsx)("p",{className:"pc-adv-detail__muted",children:"No description."})]}),(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Status"}),(0,t.jsx)("div",{className:"pc-adv-detail__status-row",children:(0,t.jsx)(fe,{value:e.status,onChange:u=>{S(u)},disabled:j!==null,ariaLabel:"Change status",triggerClassName:"pc-adv-detail__select",options:Aa.map(u=>({value:u,label:(0,t.jsx)(ee,{status:u,size:"xs"})}))})})]}),F.length>0&&(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsxs)("h3",{children:["Issues (",F.length,")"]}),(0,t.jsx)("div",{className:"pc-adv-detail__related",children:F.map(u=>(0,t.jsx)(O,{label:u.title,children:(0,t.jsxs)("button",{type:"button",className:"pc-adv-detail__related-row",onClick:()=>i(u.id),children:[(0,t.jsx)("span",{className:"pc-adv-detail__related-id",children:u.id}),(0,t.jsx)("span",{className:"pc-adv-detail__related-dot",style:{background:Fe[u.severity].solid}}),(0,t.jsx)("span",{className:"pc-adv-detail__related-title",children:u.title})]})},u.id))})]}),(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Recent activity"}),E.length===0?(0,t.jsx)("p",{className:"pc-adv-detail__muted",children:"No agent runs for this feature yet."}):(0,t.jsx)("div",{className:"pc-adv-detail__runs",children:E.map(u=>{const w=$a(u);return(0,t.jsxs)("div",{className:"pc-adv-detail__run-block",children:[(0,t.jsxs)("div",{className:"pc-adv-detail__run",children:[(0,t.jsx)("span",{className:"pc-adv-detail__run-role",children:bt(u.role,c)}),(0,t.jsx)("span",{className:"pc-adv-detail__run-time",children:ve(u.ts)}),(0,t.jsxs)("span",{className:"pc-adv-detail__run-right",children:[u.costUsd!=null&&Number(u.costUsd)>0&&(0,t.jsxs)("span",{className:"pc-adv-detail__run-cost",children:["$",Number(u.costUsd).toFixed(2)]}),w&&(0,t.jsx)("span",{className:`pc-adv-detail__run-outcome is-${w.kind}`,title:w.detail,children:w.label}),u.sessionId&&(0,t.jsx)(O,{label:"Open this run's agent session in a terminal (claude --resume)",children:(0,t.jsx)("button",{type:"button",className:"pc-adv-detail__run-open",onClick:()=>{Ea(a,u.sessionId)},children:"Open session"})})]})]}),w?.kind==="failed"&&w.detail&&(0,t.jsx)("div",{className:"pc-adv-detail__run-error",title:w.detail,children:w.detail})]},u.runId)})})]}),(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:(0,t.jsxs)("button",{type:"button",className:"pc-adv-detail__collapse",onClick:()=>_(u=>!u),children:[h?"▾":"▸"," Steer notes",x&&x.length>0?` (${x.length})`:""]})}),h&&(0,t.jsxs)(t.Fragment,{children:[x&&x.length>0&&(0,t.jsx)("div",{className:"pc-adv-detail__notes",children:x.map((u,w)=>(0,t.jsx)("p",{className:"pc-adv-detail__note",children:u},w))}),(0,t.jsxs)("div",{className:"pc-adv-detail__note-form",children:[(0,t.jsx)("textarea",{value:b,onChange:u=>$(u.target.value),placeholder:"Add a steer note for the worker…",rows:2,"aria-label":"Add a steer note"}),(0,t.jsx)("button",{type:"button",disabled:j!==null||!b.trim(),onClick:()=>{A()},children:"Add steer note"})]})]})]}),(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Actions"}),(0,t.jsxs)("div",{className:"pc-adv-detail__actions",children:[(0,t.jsxs)("button",{type:"button",disabled:j!==null,onClick:async()=>{g("chat");try{const u=await We({slug:a,role:"worker",featureId:e.id,title:e.summary||e.title,mode:"discuss"});if(u&&typeof u=="object"&&"error"in u)throw new Error(String(u.error))}catch(u){D.error("Open chat failed",{description:String(u)})}finally{g(null)}},children:[(0,t.jsx)(Re,{size:13,"aria-hidden":!0})," Chat"]}),(0,t.jsx)("button",{type:"button",disabled:j!==null,onClick:z,children:"Reset"}),(0,t.jsx)("button",{type:"button",disabled:j!==null,onClick:f,children:"Edit"})]})]})]}),R,(0,t.jsx)(ie,{})]})}function Fa({slug:a,issue:e,onSelect:r,onBack:n,patchIssue:i}){const[l,s]=(0,d.useState)(null),[m,f]=(0,d.useState)(""),[o,c]=(0,d.useState)([]);(0,d.useEffect)(()=>{c([])},[e.id]);const j=(0,d.useMemo)(()=>[...e.notes??[],...o],[e.notes,o]),g=(0,d.useCallback)(async v=>{const h=Ve(v),_=e.status;h&&i(e.id,{status:h}),s(v);try{await oa(a,e.id,v),D.success(`${e.id} → ${v}`)}catch(b){h&&i(e.id,{status:_}),D.error(`${v} failed`,{description:String(b)})}finally{s(null)}},[a,e.id,e.status,i]),x=(0,d.useCallback)(async()=>{const v=m.trim();if(v){s("note");try{const h=await fetch(`/api/harness/${encodeURIComponent(a)}/issues/${encodeURIComponent(e.id)}/update`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({note:v,by:"human"})});if(!h.ok)throw new Error(`${h.status}: ${await h.text()}`);c(_=>[..._,{ts:new Date().toISOString(),by:"human",text:v}]),f(""),D.success("Note added")}catch(h){D.error("Add note failed",{description:String(h)})}finally{s(null)}}},[a,e.id,m]);return(0,t.jsxs)("div",{className:"pc-adv-detail",children:[(0,t.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,t.jsx)(re,{onBack:n}),(0,t.jsx)("div",{className:"pc-adv-detail__id",children:e.id}),(0,t.jsx)("div",{className:"pc-adv-detail__title",children:e.title}),(0,t.jsxs)("div",{className:"pc-adv-detail__meta",children:[(0,t.jsx)(he,{severity:e.severity}),(0,t.jsx)(ge,{status:e.status}),e.linkedFeatureId&&(0,t.jsx)(O,{label:`Go to linked feature ${e.linkedFeatureId}`,children:(0,t.jsxs)("button",{type:"button",className:"pc-adv-detail__link pc-adv-detail__link-btn",onClick:()=>r(e.linkedFeatureId),children:[(0,t.jsx)(Ie,{size:11,"aria-hidden":!0})," ",e.linkedFeatureId]})})]})]}),(0,t.jsxs)("section",{className:"pc-adv-detail__body",children:[e.evidence&&(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Evidence"}),(0,t.jsx)("pre",{className:"pc-adv-detail__code",children:e.evidence})]}),e.repro&&(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Reproduction"}),(0,t.jsx)("pre",{className:"pc-adv-detail__code",children:e.repro})]}),e.suggestedFix&&(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Suggested fix"}),(0,t.jsx)("pre",{className:"pc-adv-detail__code",children:e.suggestedFix})]}),e.codePointer&&(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Code pointer"}),(0,t.jsx)("code",{className:"pc-adv-detail__pointer",children:e.codePointer})]}),(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsxs)("h3",{children:["Notes",j.length>0?` (${j.length})`:""]}),j.length>0&&(0,t.jsx)("div",{className:"pc-adv-detail__notes",children:j.map((v,h)=>(0,t.jsxs)("div",{className:"pc-adv-detail__note-row",children:[(0,t.jsxs)("div",{className:"pc-adv-detail__note-meta",children:[v.by," · ",v.ts?new Date(v.ts).toLocaleString():""]}),(0,t.jsx)("p",{className:"pc-adv-detail__note",children:v.text})]},h))}),(0,t.jsxs)("div",{className:"pc-adv-detail__note-form",children:[(0,t.jsx)("textarea",{value:m,onChange:v=>f(v.target.value),placeholder:"Add a note…",rows:2,"aria-label":"Add a note"}),(0,t.jsx)("button",{type:"button",disabled:l!==null||!m.trim(),onClick:()=>{x()},children:"Add note"})]})]}),(0,t.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,t.jsx)("h3",{children:"Actions"}),(0,t.jsxs)("div",{className:"pc-adv-detail__actions",children:[!e.linkedFeatureId&&e.status!=="closed"&&e.status!=="wontfix"&&(0,t.jsx)("button",{type:"button",disabled:l!==null,onClick:()=>{g("promote")},children:"Promote"}),e.status!=="acknowledged"&&e.status!=="closed"&&(0,t.jsx)("button",{type:"button",disabled:l!==null,onClick:()=>{g("acknowledge")},children:"Acknowledge"}),e.status!=="closed"&&(0,t.jsx)("button",{type:"button",disabled:l!==null,onClick:()=>{g("close")},children:"Close"}),e.status!=="wontfix"&&(0,t.jsx)("button",{type:"button",disabled:l!==null,onClick:()=>{g("wontfix")},children:"Won't fix"})]})]})]}),(0,t.jsx)(ie,{})]})}function J({children:a,tone:e}){return(0,t.jsx)("div",{style:{height:"100%",display:"grid",placeItems:"center",padding:24,color:e==="error"?"var(--bad, #fb7185)":"var(--fg-mute, #7f9bb4)",fontSize:13,textAlign:"center"},children:a})}function ie(){return(0,t.jsx)("style",{children:`
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
    `})}function kn({id:a,harnessSlug:e,onSelect:r,onClose:n}){const i=a!==null,[l,s]=(0,d.useState)(null);(0,d.useEffect)(()=>{s(null)},[a]);const m=P({queryName:"workItems.detail",args:{harnessSlug:e??"",id:a??""},enabled:i&&!!e&&!!a}),f=(0,d.useMemo)(()=>m.data?.[0]??null,[m.data]);let o;return e?m.loading?o=(0,t.jsxs)("div",{className:"wi-popup__empty",children:["Loading ",a,"…"]}):!f||f.id!==a?o=(0,t.jsxs)("div",{className:"wi-popup__empty",children:["No item found for ",a,"."]}):l?o=(0,t.jsxs)("div",{className:"wi-popup__chat","data-testid":"wi-popup-chat",children:[(0,t.jsxs)("button",{type:"button",className:"wi-popup__chat-back",onClick:()=>s(null),"data-testid":"wi-popup-chat-back",children:["← Back to ",a]}),(0,t.jsx)(ot,{slug:e,chatId:l,mode:"discuss"})]}):o=(0,t.jsx)(Ge,{slug:e,workItem:f,onSelect:r,onOpenChat:s}):o=(0,t.jsxs)("div",{className:"wi-popup__empty",children:["No harness context for ",a,"."]}),i?(0,t.jsxs)(Ae,{open:!0,onOpenChange:c=>{c||n()},title:f?.title?`${a} — ${f.title}`:a??"Work item",srOnlyTitle:!0,contentClassName:"wi-popup",contentStyle:{width:"min(760px, 94vw)",height:"min(720px, calc(100vh - 4rem))",display:"flex",flexDirection:"column",overflow:"hidden",padding:0},children:[(0,t.jsx)("div",{className:"wi-popup__header",children:(0,t.jsx)("button",{type:"button",className:"wi-popup__close",onClick:n,"aria-label":"Close work item popup","data-testid":"wi-popup-close",children:"✕"})}),(0,t.jsx)("div",{className:"wi-popup__body","data-testid":"wi-popup-body",children:o})]}):null}export{Vt as _,Sa as a,jt as b,ia as c,ea as d,ta as f,We as g,je as h,yn as i,la as l,ee as m,jn as n,ca as o,Zt as p,_n as r,xn as s,kn as t,bn as u,Be as v,X as y};
