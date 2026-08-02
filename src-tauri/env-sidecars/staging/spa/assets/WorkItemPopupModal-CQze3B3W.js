import{o as Ke}from"./chunk-ChpBd9eV.js";import{t as Ge}from"./react-DqHYuLt-.js";import{t as Je}from"./jsx-runtime-BmDUFisN.js";import{t as Ye}from"./VirtualGrid-BjQ1W_hB.js";import{r as D}from"./SyncContext-Dsm36pME.js";import{n as M}from"./dist-CREypBH1.js";import{a as Z,c as q,r as Qe,t as Xe}from"./dist-_S1YDkZy.js";import{c as Ze}from"./client-CpvG_XzT.js";import{t as et}from"./flag-hooks-DLzhzRPJ.js";import{t as te}from"./use-workspace-id-CWJdEj3C.js";import{n as tt,r as at,t as nt}from"./dist-BSIbfAoE.js";import{t as $e}from"./Modal-5HhhXtJg.js";import{t as Ae}from"./useConfirmDialog-XesAx_Ds.js";import{n as rt,t as it}from"./presence-ui-kFcCiUuS.js";import{t as O}from"./Tooltip-CN_wdpx4.js";import{t as L}from"./createLucideIcon-H39hj3ia.js";import{n as se,t as st}from"./ChatPanel-Lf86OCp7.js";import{t as Ee}from"./arrow-up-right-0anD4iWN.js";import{t as lt}from"./check-Cdd_-6Wk.js";import{t as ot}from"./chevron-down-Cewb32jP.js";import{t as Ie}from"./eye-Ir_yoFNS.js";import{t as dt}from"./flask-conical-CjB7y8cu.js";import{n as ct,t as Te}from"./message-circle-tkiFGShA.js";import{t as ut}from"./Checkbox-BNFXAjTh.js";import{t as pt}from"./puzzle-Dl388NgU.js";import{t as mt}from"./refresh-cw-DU29wawW.js";import{t as ft}from"./sparkles-B3Y1Aaqk.js";import{t as Re}from"./triangle-alert-CeknQp5m.js";import{t as xe}from"./x-DBWzBmCv.js";import{t as ht}from"./Popover-BU-sg86L.js";import{t as ae}from"./useLexicon-BFEdkamb.js";import{_ as Y,b as be,h as ze,t as ye,u as gt,v as vt}from"./theme-Ct4folNn.js";import{t as fe}from"./Select-GLTnP1v5.js";import{n as xt,r as bt,t as Fe}from"./agent-display-CMypfJF9.js";import{n as Me}from"./list-meta-OQ9h26eS.js";var c=Ke(Ge());function yt(t,a){try{const r=t?.getItem(a);if(!r)return{};const n=JSON.parse(r);if(!n||typeof n!="object"||Array.isArray(n))return{};const s={};for(const[o,l]of Object.entries(n))typeof l=="number"&&Number.isFinite(l)&&l>0&&(s[o]=l);return s}catch{return{}}}function _t(t,a){const r=a??(typeof window<"u"?window.localStorage:void 0),[n,s]=(0,c.useState)(()=>yt(r,t));return[n,(0,c.useCallback)(o=>{s(o);try{r?.setItem(t,JSON.stringify(o))}catch{}},[t,r])]}function ne(t,a){switch(t.type){case"text":return typeof a!="string"||a.length===0;case"enum":return!Array.isArray(a)||a.length===0;case"number":{if(a==null||typeof a!="object"||Array.isArray(a))return!0;const{min:r,max:n}=a;return r==null&&n==null}case"boolean":return typeof a!="boolean";default:return!0}}function jt(t,a,r){if(ne(t,a))return!0;switch(t.type){case"text":{const n=t.accessor(r);return n==null?!1:String(n).toLowerCase().includes(a.toLowerCase())}case"enum":{const n=t.accessor(r);return n==null?!1:a.includes(n)}case"number":{const n=t.accessor(r);if(n==null||typeof n!="number"||Number.isNaN(n))return!1;const{min:s,max:o}=a;return!(s!=null&&n<s||o!=null&&n>o)}case"boolean":{const n=t.accessor(r);return n==null?!1:n===a}default:return!0}}function kt(t,a,r){if(!a)return t;const n=[];for(const s of Object.keys(a)){const o=r.find(f=>f.key===s);if(!o?.filter)continue;const l=a[s];ne(o.filter,l)||n.push({spec:o.filter,value:l})}return n.length===0?t:t.filter(s=>n.every(({spec:o,value:l})=>jt(o,l,s)))}function wt(t,a){const r=a.filter;if(!r||r.type!=="enum")return[];const n=new Map;for(const s of t){const o=r.accessor(s);o!=null&&n.set(o,(n.get(o)??0)+1)}return r.options&&r.options.length>0?r.options.map(s=>({value:s.value,...s.label!==void 0?{label:s.label}:{},count:n.get(s.value)??0})):[...n.keys()].sort((s,o)=>s.localeCompare(o)).map(s=>({value:s,count:n.get(s)}))}var De="~",Pe=":",Oe=",",Le="..";function ue(t){return t.replace(/[%~,:]/g,a=>"%"+a.charCodeAt(0).toString(16).toUpperCase().padStart(2,"0"))}function le(t){return t.replace(/%([0-9A-Fa-f]{2})/g,(a,r)=>String.fromCharCode(parseInt(r,16)))}function St(t,a){if(ne(t,a))return null;switch(t.type){case"text":return ue(a);case"enum":return a.map(ue).join(Oe);case"number":{const{min:r,max:n}=a;return`${r!=null?String(r):""}${Le}${n!=null?String(n):""}`}case"boolean":return a?"true":"false";default:return null}}function oe(t){if(!t)return"";const a=[];for(const r of Object.keys(t)){const n=t[r],s=Ct(n);if(!s)continue;const o=St(s,n);o!=null&&a.push(`${Nt(r)}${Pe}${o}`)}return a.join(De)}function Nt(t){return ue(t)}function Ct(t){return typeof t=="string"?{type:"text",accessor:()=>null}:Array.isArray(t)?{type:"enum",accessor:()=>null}:typeof t=="boolean"?{type:"boolean",accessor:()=>null}:t!=null&&typeof t=="object"?{type:"number",accessor:()=>null}:null}function $t(t){const a=t.indexOf(Le);if(a===-1)return null;const r=t.slice(0,a),n=t.slice(a+2),s={};if(r!==""){const o=Number(r);if(Number.isNaN(o))return null;s.min=o}if(n!==""){const o=Number(n);if(Number.isNaN(o))return null;s.max=o}return s.min==null&&s.max==null?null:s}function At(t,a){const r={};if(!t)return r;const n=new Map;for(const s of a)s.filter&&n.set(s.key,s.filter);for(const s of t.split(De)){if(s==="")continue;const o=s.indexOf(Pe);if(o===-1)continue;const l=le(s.slice(0,o)),f=s.slice(o+1),h=n.get(l);if(h)switch(h.type){case"text":{const d=le(f);if(d.length===0)continue;r[l]=d;break}case"enum":{const d=f.split(Oe).filter(p=>p!=="").map(le);if(d.length===0)continue;r[l]=d;break}case"number":{const d=$t(f);if(!d)continue;r[l]=d;break}case"boolean":f==="true"?r[l]=!0:f==="false"&&(r[l]=!1);break}}return r}function Et(t,a){return t.options?.find(r=>r.value===a)?.label??a}function It(t){return typeof t.header=="string"&&t.header.length>0?t.header:typeof t.header=="number"?String(t.header):typeof t.headerText=="string"&&t.headerText.length>0?t.headerText:t.key}function Tt(t,a){const r=t.filter,n=It(t);if(!r||ne(r,a))return"";switch(r.type){case"text":return`${n}: ${a}`;case"enum":return`${n}: ${a.map(s=>Et(r,s)).join(", ")}`;case"number":{const{min:s,max:o}=a;return s!=null&&o!=null?`${n}: ${s}–${o}`:s!=null?`${n}: ≥${s}`:`${n}: ≤${o}`}case"boolean":return`${n}: ${a?"true":"false"}`;default:return""}}var Rt=[["path",{d:"M12 20v-9",key:"1qisl0"}],["path",{d:"M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z",key:"uouzyp"}],["path",{d:"M14.12 3.88 16 2",key:"qol33r"}],["path",{d:"M21 21a4 4 0 0 0-3.81-4",key:"1b0z45"}],["path",{d:"M21 5a4 4 0 0 1-3.55 3.97",key:"5cxbf6"}],["path",{d:"M22 13h-4",key:"1jl80f"}],["path",{d:"M3 21a4 4 0 0 1 3.81-4",key:"1fjd4g"}],["path",{d:"M3 5a4 4 0 0 0 3.55 3.97",key:"1d7oge"}],["path",{d:"M6 13H2",key:"82j7cp"}],["path",{d:"m8 2 1.88 1.88",key:"fmnt4t"}],["path",{d:"M9 7.13V6a3 3 0 1 1 6 0v1.13",key:"1vgav8"}]],zt=L("bug",Rt),Ft=[["path",{d:"M21.801 10A10 10 0 1 1 17 3.335",key:"yps3ct"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],X=L("circle-check-big",Ft),Mt=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],Ue=L("circle-x",Mt),Dt=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]],B=L("circle",Dt),Pt=[["rect",{width:"12",height:"12",x:"2",y:"10",rx:"2",ry:"2",key:"6agr2n"}],["path",{d:"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6",key:"1o487t"}],["path",{d:"M6 18h.01",key:"uhywen"}],["path",{d:"M10 14h.01",key:"ssrbsk"}],["path",{d:"M15 6h.01",key:"cblpky"}],["path",{d:"M18 9h.01",key:"2061c0"}]],Ot=L("dices",Pt),Lt=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M9 10h6",key:"9gxzsh"}],["path",{d:"M12 13V7",key:"h0r20n"}],["path",{d:"M9 17h6",key:"r8uit2"}]],Ut=L("file-diff",Lt),Bt=[["path",{d:"m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9",key:"1hayfq"}],["path",{d:"m18 15 4-4",key:"16gjal"}],["path",{d:"m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5",key:"15ts47"}]],pe=L("hammer",Bt),Ht=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]],Wt=L("info",Ht),Vt=[["path",{d:"M2 5h20",key:"1fs1ex"}],["path",{d:"M6 12h12",key:"8npq4p"}],["path",{d:"M9 19h6",key:"456am0"}]],qt=L("list-filter",Vt),Kt=[["path",{d:"M12 16h.01",key:"1drbdi"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z",key:"1fd625"}]],Be=L("octagon-alert",Kt),_e="papercusp:open-chat";async function He(t){const a=t.dispatch!==!1;try{try{const o=await fetch(`/api/harness/${encodeURIComponent(t.slug)}/agent-chats`);if(o.ok){const l=((await o.json()).chats??[]).find(f=>f.role===t.role&&f.feature_id===t.featureId);if(l){const f={slug:t.slug,chatId:l.id,title:l.title??t.title,role:l.role,featureId:t.featureId,...t.mode?{mode:t.mode}:{}};if(a&&typeof window<"u"){const h=window,d=h.__PAPERCUSP_PENDING_CHAT_OPENS__??[];d.push(f),h.__PAPERCUSP_PENDING_CHAT_OPENS__=d,window.dispatchEvent(new CustomEvent(_e,{detail:f}))}return{chatId:l.id}}}}catch{}const r=await fetch(`/api/harness/${encodeURIComponent(t.slug)}/agent-chats`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({role:t.role,feature_id:t.featureId,title:t.title})});if(!r.ok)return{error:(await r.json().catch(()=>({}))).error??`HTTP ${r.status}`};const n=await r.json(),s={slug:t.slug,chatId:n.id,title:n.title,role:n.role,featureId:n.feature_id??void 0,...t.mode?{mode:t.mode}:{}};if(a&&typeof window<"u"){const o=window,l=o.__PAPERCUSP_PENDING_CHAT_OPENS__??[];l.push(s),o.__PAPERCUSP_PENDING_CHAT_OPENS__=l,window.dispatchEvent(new CustomEvent(_e,{detail:s}))}return{chatId:n.id}}catch(r){return{error:r.message}}}var e=Je();function Q({meta:t,Icon:a,glyph:r,size:n,showLabel:s,labelOverride:o}){const l=n==="xs"?10:11;return(0,e.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:4,padding:"1px 8px",borderRadius:999,fontSize:n==="xs"?10:Y.xs,fontWeight:700,textTransform:"uppercase",color:t.text,background:t.bg,whiteSpace:"nowrap"},children:[a?(0,e.jsx)(a,{size:l,"aria-hidden":!0}):(0,e.jsx)("span",{"aria-hidden":!0,style:{fontSize:l+1,lineHeight:1},children:r}),s&&(0,e.jsx)("span",{children:o??t.label})]})}var Gt={open:B,wip:pe,blocked:Re,"needs-human":Be,done:X,dropped:se,todo:B,in_progress:pe,validating:Ie,failing:Ue,passed:X,deprecated:se,resolved:X,closed:se};function ee({status:t,size:a="sm",showLabel:r=!0,variant:n="dot"}){const s=vt[t];if(n==="chip")return(0,e.jsx)(Q,{meta:s,Icon:Gt[t]??B,size:a,showLabel:r});const o=a==="xs"?6:8;return(0,e.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:6,fontSize:a==="xs"?Y.xs:Y.sm,color:s.text,fontWeight:500,whiteSpace:"nowrap"},children:[(0,e.jsx)("span",{"aria-hidden":!0,style:{width:o,height:o,borderRadius:"50%",background:s.solid,flexShrink:0}}),r&&(0,e.jsx)("span",{children:s.label})]})}var Jt={critical:Be,major:Re,minor:Wt,nit:B},Yt={open:B,acknowledged:Ie,fixing:pe,resolved:lt,closed:X,wontfix:Ue};function he({severity:t,size:a="sm",showLabel:r=!0}){const n=ze[t];return(0,e.jsx)(Q,{meta:n,Icon:Jt[t]??B,size:a,showLabel:r})}function ge({status:t,size:a="sm",showLabel:r=!0,variant:n="dot"}){const s=gt[t];if(n==="chip")return(0,e.jsx)(Q,{meta:s,Icon:Yt[t]??B,size:a,showLabel:r});const o=a==="xs"?6:8;return(0,e.jsxs)("span",{style:{display:"inline-flex",alignItems:"center",gap:6,fontSize:a==="xs"?Y.xs:Y.sm,color:s.text,fontWeight:500,whiteSpace:"nowrap"},children:[(0,e.jsx)("span",{"aria-hidden":!0,style:{width:o,height:o,borderRadius:"50%",background:s.solid,flexShrink:0}}),r&&(0,e.jsx)("span",{children:s.label})]})}var Qt={feature:ft,chunk:pt,bug:zt,change:Ut,task:ct,bet:Ot,"research-task":dt};function Xt({kind:t,size:a="sm",showLabel:r=!0}){const n=be[t];return(0,e.jsx)(Q,{meta:n,Icon:Qt[t]??B,size:a,showLabel:r,labelOverride:t in be?void 0:t})}var Zt={queen:"☕",overwatch:"🫖",bee:"🍵",sentinel:"🥤",planner:"📋",su:"🛠",mug:"☕",kettle:"🫖",cup:"🍵",papercup:"🥤"};function ea({kind:t,size:a="sm",showLabel:r=!0}){const n=ae(),s=ye[t],o=bt(t),l=o?n(o):t in ye?void 0:t;return(0,e.jsx)(Q,{meta:s,glyph:Zt[t]??"·",size:a,showLabel:r,labelOverride:l})}var je=["open","wip","blocked","needs-human","done","dropped"];function ke(t){try{return JSON.parse(t)}catch{return t}}function ta(t,a,r){return r||!a||!Array.isArray(t)?null:t.filter(n=>n.featureId===a).map(n=>({ts:n.ts,field:n.field,old:n.oldValue?ke(n.oldValue):null,new:n.newValue?ke(n.newValue):null,actor:n.actor??""}))}function aa({slug:t,feature:a,onClose:r,onSaved:n,embedded:s=!1}){const o=te(),l=a===null,[f,h]=(0,c.useState)(a?.id??""),[d,p]=(0,c.useState)(a?.title??""),[y,x]=(0,c.useState)((a?.claims??[]).join(`
`)),[v,b]=(0,c.useState)(a?.status??"open"),[g,_]=(0,c.useState)(a?.attempts??0),[u,w]=(0,c.useState)(a?.deprecation_reason??""),[k,T]=(0,c.useState)(!1),[A,N]=(0,c.useState)(null),{confirm:$,element:F}=Ae();(0,c.useEffect)(()=>{a&&(h(a.id),p(a.title),x((a.claims??[]).join(`
`)),b(a.status),_(a.attempts),w(a.deprecation_reason??""))},[a]);const E=(0,c.useCallback)(async()=>{T(!0);try{const j=y.split(`
`).map(z=>z.trim()).filter(Boolean);if(v==="dropped"&&u.trim()===""){N('Deprecation reason is required when status is "dropped".'),T(!1);return}if(l){const z=await fetch(`/api/harness/${t}/features`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:f,title:d,claims:j,status:v})});if(!z.ok)throw new Error(`${z.status}: ${await z.text()}`)}else{const z={title:d,claims:j,status:v,attempts:g};v==="dropped"&&(z.deprecation_reason=u.trim());const V=await fetch(`/api/harness/${t}/features/${f}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(z)});if(!V.ok)throw new Error(`${V.status}: ${await V.text()}`)}N("saved"),n(),setTimeout(()=>{r()},400)}catch(j){N(`save failed: ${j}`)}finally{T(!1)}},[t,f,d,y,v,g,l,r,n]),R=(0,c.useCallback)(async()=>{if(a&&await $({title:`Delete feature ${a.id}?`,body:"This cannot be undone.",confirmLabel:"Delete",destructive:!0})){T(!0);try{const j=await fetch(`/api/harness/${t}/features/${a.id}`,{method:"DELETE"});if(!j.ok)throw new Error(`${j.status}: ${await j.text()}`);N("deleted"),n(),setTimeout(()=>{r()},400)}catch(j){N(`delete failed: ${j}`)}finally{T(!1)}}},[t,a,r,n,$]),[P,i]=q("history",Qe.withDefault(!1)),[m,S]=(0,c.useState)(null),{data:I}=D({queryName:"featureAudit.byHarness",args:{harnessSlug:t,workspaceId:o},enabled:!l&&!!t}),C=(0,c.useMemo)(()=>ta(I,a?.id,l),[I,l,a?.id]);(0,c.useEffect)(()=>{const j=z=>{(z.metaKey||z.ctrlKey)&&z.key.toLowerCase()==="s"&&(z.preventDefault(),E())};return window.addEventListener("keydown",j),()=>window.removeEventListener("keydown",j)},[E]);const W=(0,e.jsxs)(e.Fragment,{children:[F,(0,e.jsxs)("div",{style:{padding:"0.75rem 1rem",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:"0.75rem"},children:[(0,e.jsx)("strong",{style:{color:"var(--fg)"},children:l?"New feature":`Edit ${a.id}`}),(0,e.jsx)("span",{style:{color:"var(--fg-mute)",fontSize:"0.75rem",fontFamily:"monospace"},title:"Features live in Postgres (harness_features); edits dispatch via /api/harness/<slug>/features",children:"harness_features"}),(0,e.jsxs)("div",{style:{marginLeft:"auto",display:"flex",gap:"0.5rem",alignItems:"center"},children:[A&&(0,e.jsx)("span",{style:{color:/failed/i.test(A)?"var(--bad)":"var(--good)",fontSize:"0.8rem"},children:A}),!l&&(0,e.jsx)("button",{onClick:R,disabled:k,style:{background:"transparent",color:"var(--bad)",border:"1px solid #7f1d1d",borderRadius:3,padding:"0.35rem 0.75rem",cursor:k?"wait":"pointer",fontSize:"0.8rem"},children:"delete"}),(0,e.jsx)("button",{onClick:E,disabled:k||!d.trim()||l&&!f.trim(),style:{background:"#2563eb",color:"white",border:"none",borderRadius:3,padding:"0.35rem 0.9rem",cursor:k?"wait":"pointer",fontWeight:600},children:k?"saving…":"save"}),(0,e.jsx)("button",{onClick:r,style:{background:"transparent",color:"var(--fg-mute)",border:"1px solid var(--border)",borderRadius:3,padding:"0.35rem 0.75rem",cursor:"pointer"},children:"cancel"})]})]}),(0,e.jsxs)("div",{style:{flex:1,overflow:"auto",padding:"1rem",display:"flex",flexDirection:"column",gap:"0.9rem"},children:[(0,e.jsxs)("div",{children:[(0,e.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"ID"}),(0,e.jsx)("input",{value:f,onChange:j=>h(j.target.value.toUpperCase()),disabled:!l,placeholder:"F-NEW-001",style:{width:"100%",boxSizing:"border-box",background:l?"#111827":"#1f2937",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontFamily:"monospace",fontSize:"0.85rem",opacity:l?1:.6}}),l&&(0,e.jsxs)("div",{style:{fontSize:"0.7rem",color:"var(--fg-mute)",marginTop:"0.25rem"},children:["must match ",(0,e.jsx)("code",{children:"^F-[A-Z0-9-]+$"}),". Convention: ",(0,e.jsx)("code",{children:"F-FIX-001"})," for fix features."]})]}),(0,e.jsxs)("div",{children:[(0,e.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Title"}),(0,e.jsx)("textarea",{value:d,onChange:j=>p(j.target.value),rows:2,style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem",resize:"vertical",fontFamily:"system-ui, sans-serif"}})]}),(0,e.jsxs)("div",{children:[(0,e.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Claims — one per line (validation contract IDs)"}),(0,e.jsx)("textarea",{value:y,onChange:j=>x(j.target.value),rows:6,placeholder:`VAL-GRID-001
VAL-GRID-002`,style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.8rem",fontFamily:"ui-monospace, monospace",resize:"vertical"}})]}),(0,e.jsxs)("div",{style:{display:"flex",gap:"1rem"},children:[(0,e.jsxs)("div",{style:{flex:1},children:[(0,e.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Status"}),(0,e.jsx)(fe,{value:v,onChange:j=>b(j),ariaLabel:"Status",options:[...je.map(j=>({value:j,label:j})),...je.includes(v)?[]:[{value:v,label:`${v} (legacy)`}]],triggerStyle:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem"}})]}),!l&&(0,e.jsxs)("div",{style:{flex:1},children:[(0,e.jsx)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:"Attempts"}),(0,e.jsx)("input",{type:"number",min:0,value:g,onChange:j=>_(Math.max(0,Math.floor(Number(j.target.value)||0))),style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem"}})]})]}),v==="dropped"&&(0,e.jsxs)("div",{children:[(0,e.jsxs)("label",{style:{display:"block",fontSize:"0.75rem",color:"var(--fg-mute)",marginBottom:"0.25rem"},children:["Deprecation reason ",(0,e.jsx)("span",{style:{color:"var(--bad)"},children:"(required)"})]}),(0,e.jsx)("textarea",{value:u,onChange:j=>w(j.target.value),placeholder:"e.g. The plan no longer asks for JWT cookie rotation; replaced by F-AUTH-012 (session cookies).",rows:3,style:{width:"100%",boxSizing:"border-box",background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border)",borderRadius:3,padding:"0.45rem 0.6rem",fontSize:"0.85rem",fontFamily:"inherit",resize:"vertical"}}),(0,e.jsx)("p",{style:{margin:"0.35rem 0 0",fontSize:"0.7rem",color:"var(--fg-mute)"},children:"Code is not auto-removed when a feature is deprecated; the row stays for audit and is hidden from default queue views."})]}),!l&&(0,e.jsxs)(tt,{open:P,onOpenChange:i,style:{marginTop:"0.5rem",borderTop:"1px solid var(--border)",paddingTop:"0.6rem"},children:[(0,e.jsx)(at,{asChild:!0,children:(0,e.jsxs)("button",{type:"button",style:{cursor:"pointer",fontSize:"0.8rem",color:"var(--fg-mute)",userSelect:"none",background:"none",border:"none",padding:0,textAlign:"left"},children:["History ",C?`(${C.length})`:""]})}),(0,e.jsxs)(nt,{style:{marginTop:"0.5rem",fontSize:"0.75rem",maxHeight:240,overflowY:"auto"},children:[m&&(0,e.jsxs)("div",{style:{color:"var(--bad)"},children:["Failed to load: ",m]}),!m&&C===null&&P&&(0,e.jsx)("div",{style:{color:"var(--fg-mute)"},children:"Loading…"}),!m&&C!==null&&C.length===0&&(0,e.jsx)("div",{style:{color:"var(--fg-mute)"},children:"No edit history yet."}),C&&C.length>0&&(0,e.jsx)("div",{style:{display:"flex",flexDirection:"column",gap:"0.25rem"},children:C.map((j,z)=>{const V=H=>H==null?"∅":typeof H=="string"?H.length>40?H.slice(0,37)+"…":H:JSON.stringify(H).slice(0,40);return(0,e.jsxs)("div",{style:{display:"grid",gridTemplateColumns:"11ch 9ch 1fr",gap:"0.5rem",alignItems:"baseline",color:"var(--fg)"},children:[(0,e.jsx)("span",{style:{color:"var(--fg-mute)",fontVariantNumeric:"tabular-nums"},children:new Date(j.ts).toLocaleString(void 0,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}),(0,e.jsx)("span",{style:{color:"#a1a1aa"},children:j.actor}),(0,e.jsxs)("span",{children:[(0,e.jsx)("code",{style:{color:"var(--warn)"},children:j.field}),(0,e.jsx)("span",{style:{color:"var(--fg-mute)"},children:": "}),(0,e.jsx)("span",{style:{color:"var(--fg-mute)"},children:V(j.old)}),(0,e.jsx)("span",{style:{color:"var(--fg-mute)"},children:" → "}),(0,e.jsx)("span",{children:V(j.new)})]})]},z)})})]})]})]})]});return s?(0,e.jsx)("div",{style:{height:"100%",minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg-1, #0b1220)",fontFamily:"system-ui, sans-serif"},children:W}):(0,e.jsx)($e,{open:!0,onOpenChange:j=>{j||r()},title:"Edit feature",srOnlyTitle:!0,zIndex:120,contentStyle:{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:6,width:"70vw",maxWidth:720,height:"65vh",display:"flex",flexDirection:"column",overflow:"hidden",fontFamily:"system-ui, sans-serif"},children:W})}function we(t){if(t){if(Array.isArray(t))return t.map(a=>String(a));if(typeof t=="string")try{const a=JSON.parse(t);if(Array.isArray(a))return a.map(r=>String(r))}catch{}}}function na(t){if(t==null)return;let a;if(Array.isArray(t))a=t;else if(typeof t=="string"){const n=t.trim();if(!n||n==="{}"||n==="[]")return;if(n.startsWith("{")&&n.endsWith("}"))a=n.slice(1,-1).split(",");else try{const s=JSON.parse(n);a=Array.isArray(s)?s:[]}catch{return}}else return;const r=a.map(n=>typeof n=="number"?n:Number.parseInt(String(n).trim(),10)).filter(n=>Number.isInteger(n)&&n>0);return r.length>0?r:void 0}function ra(t){const a=te(),[r,n]=(0,c.useState)(null),[s,o]=(0,c.useState)(null),{data:l,loading:f,error:h}=D({queryName:"featuresConsolidated.bySlug",args:t?{harnessSlug:t,workspaceId:a}:void 0,enabled:!!t});(0,c.useEffect)(()=>{if(!t){n(null),o(null);return}f||!Array.isArray(l)||n(l.map(p=>({id:p.featureId,title:p.title,summary:p.summary??void 0,status:p.status,attempts:Number(p.attempts)||0,claims:we(p.claims),sourcePlanSlug:p.sourcePlanSlug??void 0,needsReview:p.needsHumanReview??p.needs_human_review??void 0,tags:we(p.tags),workingUsers:na(p.workingUsers??p.working_users)})))},[t,l,f]),(0,c.useEffect)(()=>{o(h?h instanceof Error?h.message:String(h):null)},[h]);const d=(0,c.useCallback)((p,y)=>{n(x=>x&&x.map(v=>v.id===p?{...v,...y}:v))},[]);return{features:r,loading:r===null&&!s,error:s,patchFeature:d}}function ia(t){const a=typeof t.foundAt=="number"?t.foundAt:Date.parse(String(t.foundAt));return{id:t.issueId,title:t.title,severity:t.severity,source:t.source,status:t.status,foundAt:Number.isFinite(a)?new Date(a).toISOString():"",foundDuring:t.foundDuring??void 0,repro:t.repro??void 0,evidence:t.evidence??void 0,suggestedFix:t.suggestedFix??void 0,codePointer:t.codePointer??void 0,linkedFeatureId:t.linkedFeatureId??void 0,attempts:Number(t.attempts)||0,notes:Array.isArray(t.notes)?t.notes:[]}}function sa(t){const a=te(),[r,n]=(0,c.useState)(null),[s,o]=(0,c.useState)(null),{data:l,loading:f,error:h}=D({queryName:"issuesConsolidated.bySlug",args:t?{harnessSlug:t,workspaceId:a}:void 0,enabled:!!t});(0,c.useEffect)(()=>{if(!t){n(null),o(null);return}f||!Array.isArray(l)||n(l.map(ia))},[t,l,f]),(0,c.useEffect)(()=>{o(h?h instanceof Error?h.message:String(h):null)},[h]);const{data:d}=D({queryName:"harnessPendingIssues.byHarness",args:t?{harnessSlug:t,phase:"staging",workspaceId:a}:void 0,enabled:!!t}),p=Array.isArray(d)?d.length:0,y=(0,c.useCallback)((x,v)=>{n(b=>b&&b.map(g=>g.id===x?{...g,...v}:g))},[]);return{issues:r,pendingCount:p,loading:r===null&&!s,error:s,patchIssue:y}}function Se(t){if(t==null)return;if(typeof t=="number")return t;const a=Date.parse(String(t));return Number.isFinite(a)?a:void 0}function gn(t){const[a,r]=(0,c.useState)(null),[n,s]=(0,c.useState)(null),{data:o,loading:l,error:f,invalidate:h}=D({queryName:"agentRunsConsolidated.bySlug",args:t?{harnessSlug:t}:void 0,enabled:!!t}),d=(0,c.useCallback)(()=>h(),[h]);return(0,c.useEffect)(()=>{if(!t){r(null),s(null);return}l||!Array.isArray(o)||r(o.map(p=>({runId:p.runId,role:p.role,ts:Se(p.ts),sizeBytes:Number(p.sizeBytes)||0,running:!!p.running,lastEventTs:Se(p.lastEventTs),costUsd:p.costUsd!=null?Number(p.costUsd):void 0,featureId:p.featureId??void 0})))},[t,o,l]),(0,c.useEffect)(()=>{s(f?f instanceof Error?f.message:String(f):null)},[f]),{agents:a,total:Array.isArray(o)?Me(o):a?.length??0,loading:a===null&&!n,error:n,refresh:d}}function vn(t,a=300){const[r,n]=(0,c.useState)(null),[s,o]=(0,c.useState)(null),[l,f]=(0,c.useState)(0),h=(0,c.useCallback)(()=>f(d=>d+1),[]);return(0,c.useEffect)(()=>{if(!t){n(null);return}let d=!1;return o(null),fetch(`/api/harness/${encodeURIComponent(t)}/log/history?limit=${a}&phase=staging`).then(p=>p.ok?p.json():Promise.reject(new Error(`log/history ${p.status}`))).then(p=>{d||n(Array.isArray(p.events)?p.events:[])}).catch(p=>{d||o(p.message)}),()=>{d=!0}},[t,a,l]),{events:r,loading:r===null&&!s,error:s,refresh:h}}async function Ne(t,a){const r=await fetch(t,{method:"POST",headers:a!==void 0?{"content-type":"application/json"}:void 0,body:a!==void 0?JSON.stringify(a):void 0});if(!r.ok)throw new Error(`${r.status}: ${await r.text()}`)}function We(t){switch(t){case"acknowledge":return"acknowledged";case"close":return"closed";case"wontfix":return"wontfix";default:return null}}async function la(t,a,r){const n=`/api/harness/${encodeURIComponent(t)}/issues/${encodeURIComponent(a)}`;r==="promote"?await Ne(`${n}/promote`,{}):await Ne(`${n}/update`,{status:We(r)})}function oa(t){return Xe({parse:a=>At(a,t),serialize:a=>oe(a),eq:(a,r)=>oe(a)===oe(r)}).withDefault({})}function da(t,a,r){const{ns:n}=r,s=(0,c.useMemo)(()=>oa(t),[t]),[o,l]=q(n+"f",s),f=(0,c.useMemo)(()=>t.filter(g=>!!g.filter),[t]),h=(0,c.useMemo)(()=>kt(a,o,t),[a,o,t]),d=(0,c.useCallback)((g,_)=>{l(u=>({...u??{},[g]:_}))},[l]),p=(0,c.useCallback)(g=>{l(_=>{if(!_||!(g in _))return _;const u={..._};return delete u[g],u})},[l]),y=(0,c.useCallback)(()=>{l(null)},[l]),x=(0,c.useMemo)(()=>{const g=new Map;for(const _ of f)_.filter?.type==="enum"&&g.set(_.key,wt(a,_));return g},[f,a]),v=(0,c.useMemo)(()=>({filterableColumns:f,valueFor:g=>o?.[g],setValue:d,remove:p,optionsFor:g=>x.get(g)??[]}),[f,o,d,p,x]),b=(0,c.useMemo)(()=>{if(!o)return[];const g=[];for(const _ of f){const u=o[_.key];if(u===void 0)continue;const w=Tt(_,u);w&&g.push({colKey:_.key,label:w,clear:()=>p(_.key)})}return g},[o,f,p]);return{rows:h,controller:v,activeChips:b,clearAll:y,hasActive:b.length>0}}var de="_add_filter_";function U(t){const a=t.header;return typeof a=="string"&&a.length>0?a:typeof a=="number"?String(a):typeof t.headerText=="string"&&t.headerText.length>0?t.headerText:t.key}var ca={display:"flex",flexDirection:"column",gap:8,minWidth:200,maxWidth:280,padding:10,background:"color-mix(in srgb, var(--bg-deeper, #0b1622), transparent 2%)",color:"var(--fg, #e7f7ff)",border:"1px solid color-mix(in oklab, var(--accent, #38bdf8), transparent 62%)",borderRadius:10,boxShadow:"0 18px 54px rgba(0,0,0,0.62)",fontSize:12},ua={fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--fg-mute, #7f9bb4)"},pa={display:"flex",alignItems:"center",gap:6},ma=8,fa={display:"flex",flexDirection:"column",gap:4,maxHeight:220,overflowY:"auto"},ha={width:"100%",padding:"4px 7px",fontSize:12,fontFamily:"inherit",color:"var(--fg, #e7f7ff)",background:"var(--bg-2, rgba(255,255,255,0.045))",border:"1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%))",borderRadius:6},ga={display:"flex",alignItems:"center",gap:8,fontSize:10.5,color:"var(--fg-mute, #7f9bb4)"},va={display:"flex",alignItems:"center",gap:8,cursor:"pointer"},xa={marginLeft:"auto",color:"var(--fg-mute, #7f9bb4)",fontVariantNumeric:"tabular-nums"},Ce={width:70,padding:"4px 7px",fontSize:12,fontFamily:"inherit",color:"var(--fg, #e7f7ff)",background:"var(--bg-2, rgba(255,255,255,0.045))",border:"1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%))",borderRadius:6};function ba(t){return typeof t=="string"?t:""}function me(t){return Array.isArray(t)?t:[]}function ya(t){return t&&typeof t=="object"&&!Array.isArray(t)?t:{}}function _a(t){return typeof t=="boolean"?t:void 0}function ja({col:t,controller:a,onClose:r}){const[n,s]=(0,c.useState)(""),o=t.filter;if(!o)return null;const l=a.valueFor(t.key),f=d=>{d.key==="Enter"&&(d.preventDefault(),r())};if(o.type==="text")return(0,e.jsx)("input",{type:"text",className:"pc-advpanel__input",autoFocus:!0,value:ba(l),onChange:d=>a.setValue(t.key,d.target.value),onKeyDown:f,placeholder:`Filter ${U(t)}…`,"aria-label":`Filter ${U(t)}`,style:{width:"100%"}});if(o.type==="enum"){const d=a.optionsFor(t.key),p=me(l),y=o.multi!==!1,x=(u,w)=>{if(!y){a.setValue(t.key,w?[u]:[]);return}const k=w?[...p,u]:p.filter(T=>T!==u);a.setValue(t.key,k)},v=d.length>ma,b=n.trim().toLowerCase(),g=b?d.filter(u=>(u.label??u.value).toLowerCase().includes(b)):d,_=U(t);return(0,e.jsxs)("div",{style:{display:"flex",flexDirection:"column",gap:6},children:[v?(0,e.jsx)("input",{type:"text",className:"pc-advpanel__input",autoFocus:!0,value:n,onChange:u=>s(u.target.value),placeholder:`Search ${_}…`,"aria-label":`Search ${_} options`,style:ha}):null,v&&p.length>0?(0,e.jsxs)("div",{style:ga,children:[(0,e.jsxs)("span",{children:[p.length," selected"]}),(0,e.jsx)("button",{type:"button",className:"pc-advpanel__chip",style:{marginLeft:"auto",fontSize:10.5},onClick:()=>a.setValue(t.key,[]),children:"Clear selection"})]}):null,(0,e.jsx)("div",{style:fa,children:d.length===0?(0,e.jsx)("span",{style:{color:"var(--fg-mute, #7f9bb4)"},children:"No values"}):g.length===0?(0,e.jsx)("span",{style:{color:"var(--fg-mute, #7f9bb4)"},children:"No matches"}):g.map(u=>(0,e.jsxs)("label",{style:va,children:[(0,e.jsx)(ut,{checked:p.includes(u.value),onChange:w=>x(u.value,w),ariaLabel:u.label??u.value}),(0,e.jsx)("span",{children:u.label??u.value}),(0,e.jsx)("span",{style:xa,children:u.count})]},u.value))})]})}if(o.type==="number"){const d=ya(l),p=(y,x)=>{const v={...d};if(x==="")delete v[y];else{const b=Number(x);if(Number.isNaN(b))return;v[y]=b}a.setValue(t.key,v)};return(0,e.jsxs)("div",{style:pa,children:[(0,e.jsx)("input",{type:"number",style:Ce,value:d.min??"",onChange:y=>p("min",y.target.value),onKeyDown:f,placeholder:"min","aria-label":`${U(t)} minimum`}),(0,e.jsx)("span",{style:{color:"var(--fg-mute, #7f9bb4)"},children:"–"}),(0,e.jsx)("input",{type:"number",style:Ce,value:d.max??"",onChange:y=>p("max",y.target.value),onKeyDown:f,placeholder:"max","aria-label":`${U(t)} maximum`})]})}const h=_a(l);return(0,e.jsx)("div",{style:{display:"flex",gap:6},children:[{label:"True",val:!0},{label:"False",val:!1}].map(d=>(0,e.jsx)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":h===d.val,onClick:()=>a.setValue(t.key,d.val),children:d.label},d.label))})}function ka({controller:t,activeChips:a,hasActive:r,clearAll:n,layout:s="compact",inlineMax:o=8}){const l=et(Ze.GRID_COLUMN_FILTERS),[f,h]=(0,c.useState)(null);if(!l)return null;const d=new Set(a.map(u=>u.colKey)),p=t.filterableColumns.filter(u=>!d.has(u.key)),y=t.filterableColumns.find(u=>u.key===f)??null,x=new Map(a.map(u=>[u.colKey,u.label])),v=u=>{setTimeout(()=>h(u),0)},b=(u,w,k,T)=>{const A=me(t.valueFor(u));if(!T){t.setValue(u,k?[w]:[]);return}t.setValue(u,k?[...A,w]:A.filter(N=>N!==w))},g=(0,e.jsx)(ht,{open:y!=null,onOpenChange:u=>{u||h(null)},trigger:(0,e.jsx)("span",{"aria-hidden":!0,style:{width:0,height:0}}),side:"bottom",align:"start",ariaLabel:y?`Edit ${U(y)} filter`:"Edit filter",autoFocusOnOpen:!0,contentStyle:ca,children:y?(0,e.jsxs)(e.Fragment,{children:[(0,e.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:8},children:[(0,e.jsx)("span",{style:ua,children:U(y)}),(0,e.jsx)("button",{type:"button",className:"pc-advpanel__iconbtn",style:{marginLeft:"auto",width:22,height:22},"aria-label":"Close filter editor",onClick:()=>h(null),children:(0,e.jsx)(xe,{size:12})})]}),(0,e.jsx)(ja,{col:y,controller:t,onClose:()=>h(null)},y.key)]}):null});if(s==="facets")return(0,e.jsxs)("div",{className:"pc-advpanel__filterbar pc-advpanel__filterbar--facets",children:[t.filterableColumns.map(u=>{const w=u.filter,k=w?.type==="enum",T=me(t.valueFor(u.key)),A=k?t.optionsFor(u.key):[],N=U(u);if(k&&A.length>0&&A.length<=o){const F=w?.type==="enum"?w.multi!==!1:!0;return(0,e.jsxs)("div",{className:"pc-advpanel__facetgroup",children:[(0,e.jsx)("span",{className:"pc-advpanel__facetlabel",children:N}),A.map(E=>{const R=T.includes(E.value);return(0,e.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":R,onClick:()=>b(u.key,E.value,!R,F),children:[(0,e.jsx)("span",{children:E.label??E.value}),(0,e.jsx)("span",{className:"pc-advpanel__chipcount",children:E.count})]},E.value)})]},u.key)}const $=d.has(u.key);return(0,e.jsx)(O,{label:$?"Edit filter":`Filter by ${N}`,children:(0,e.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":$,onClick:()=>v(u.key),children:[$?x.get(u.key)??N:N,(0,e.jsx)(ot,{size:11,"aria-hidden":!0})]})},u.key)}),r?(0,e.jsx)("button",{type:"button",className:"pc-advpanel__chip",onClick:n,children:"Clear all"}):null,g]});const _=[{value:de,label:"Add filter…",disabled:!0},...p.map(u=>({value:u.key,label:U(u)}))];return(0,e.jsxs)("div",{className:"pc-advpanel__filterbar",children:[(0,e.jsx)(qt,{size:13,"aria-hidden":!0,style:{color:"var(--fg-mute, #7f9bb4)",flexShrink:0}}),a.map(u=>(0,e.jsx)(O,{label:"Edit filter",children:(0,e.jsxs)("button",{type:"button",className:"pc-advpanel__chip","aria-pressed":!0,onClick:()=>v(u.colKey),children:[u.label,(0,e.jsx)(xe,{size:11,"aria-label":`Remove ${u.label} filter`,onClick:w=>{w.stopPropagation(),f===u.colKey&&h(null),u.clear()}})]})},u.colKey)),p.length>0?(0,e.jsx)(fe,{value:de,onChange:u=>{u!==de&&v(u)},ariaLabel:"Add a column filter",triggerClassName:"pc-advpanel__chip",options:_}):null,r?(0,e.jsx)("button",{type:"button",className:"pc-advpanel__chip",onClick:n,children:"Clear all"}):null,g]})}function Ve(t){if(t.origin!=="remote")return null;const a=t.verifiedAuthorGithubUserId!=null?`GitHub user ${t.verifiedAuthorGithubUserId}`:"an unverified author";return t.trusted?{label:"trusted",color:"#34d399",title:`Remote work by ${a}, on your trust list — verified remote work auto-runs.`}:t.auditVerdict==="reject"?{label:"rejected",color:"#fb7185",title:`Remote work by ${a} — the admission auditor rejected it.`}:t.auditVerdict==="admit"?{label:"admitted",color:"var(--accent-strong, var(--accent))",title:`Remote work by ${a} — admitted by the auditor${t.verifiedAuthorGithubUserId!=null?" (author not on your trust list)":""}.`}:{label:"pending audit",color:"#fcd34d",title:`Remote work by ${a} — awaiting the admission verdict; not auto-running yet.`}}function wa(t){const a=Ve(t);return a?(0,e.jsx)("span",{style:{display:"inline-block",padding:"1px 8px",borderRadius:999,fontSize:10,fontWeight:700,textTransform:"uppercase",whiteSpace:"nowrap",color:a.color,background:`color-mix(in srgb, ${a.color}, transparent 85%)`},title:a.title,children:a.label}):null}var K={display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"};function Sa(t,a,r){return r?{title:`${t} of ${a}`,summary:`${t} of ${a} match`}:{title:`${a}`,summary:`${a} item${a===1?"":"s"}`}}function xn({params:t,api:a}){const r=t.harnessSlug||"",[n,s]=q("wq",Z.withDefault("")),[o,l]=q("sel",Z.withDefault("")),[f,h]=_t("pc-colw:adv:work-items"),d=500,[p,y]=(0,c.useState)(d);(0,c.useEffect)(()=>{y(d)},[r]);const x=D({queryName:"workItems.byHarness",args:{harnessSlug:r,limit:p},enabled:!!r}),v=x.loading?null:x.data,b=x.fetching,g=x.error?x.error.message:null,_=D({queryName:"trust.list"}),u=(0,c.useMemo)(()=>new Set((_.data??[]).map(i=>i.githubUserId)),[_.data]),w=i=>i.verifiedAuthorGithubUserId!=null&&u.has(i.verifiedAuthorGithubUserId),k=Me(v),T=v!=null&&v.length<k,A=(0,c.useCallback)(()=>y(i=>i+d),[]),N=[{key:"id",header:"ID",width:1.4,toCopyText:i=>i.id,filter:{type:"text",accessor:i=>i.id},render:({row:i})=>(0,e.jsx)("code",{style:K,title:i.id,children:i.id})},{key:"kind",header:"Kind",width:1.2,toCopyText:i=>i.kind,filter:{type:"enum",accessor:i=>i.kind},render:({row:i})=>(0,e.jsx)(Xt,{kind:i.kind,size:"xs"})},{key:"title",header:"Title",width:4,toCopyText:i=>i.title,filter:{type:"text",accessor:i=>i.title},render:({row:i})=>(0,e.jsx)("span",{style:K,title:i.title,children:i.title})},{key:"state",header:"State",width:1.2,toCopyText:i=>i.state,filter:{type:"enum",accessor:i=>i.state},render:({row:i})=>i.family==="issue"?(0,e.jsx)(ge,{status:i.state,size:"xs",variant:"chip"}):(0,e.jsx)(ee,{status:i.state,size:"xs",variant:"chip"})},{key:"trust",header:"Trust",width:1.3,toCopyText:i=>Ve({origin:i.origin,auditVerdict:i.auditVerdict,verifiedAuthorGithubUserId:i.verifiedAuthorGithubUserId,trusted:w(i)})?.label??"",render:({row:i})=>(0,e.jsx)(wa,{origin:i.origin,auditVerdict:i.auditVerdict,verifiedAuthorGithubUserId:i.verifiedAuthorGithubUserId,trusted:w(i)})},{key:"stage",header:"Stage",width:1.7,toCopyText:i=>i.spineRole?`${i.spineRole}${i.spineStatus?` (${i.spineStatus})`:""}`:"",filter:{type:"enum",accessor:i=>i.spineRole},render:({row:i})=>i.spineRole?(0,e.jsxs)("span",{style:K,title:`latest spine role · status (spawned_agents): ${i.spineRole}${i.spineStatus?` (${i.spineStatus})`:""}`,children:[i.spineRole,i.spineStatus?(0,e.jsxs)("span",{style:{color:"var(--fg-mute)"},children:[" (",i.spineStatus,")"]}):null]}):(0,e.jsx)(e.Fragment,{children:"—"})},{key:"assignee",header:"Assignee",width:1.8,toCopyText:i=>i.assignee??"",filter:{type:"enum",accessor:i=>i.assignee},render:({row:i})=>(0,e.jsxs)("span",{style:K,title:i.assignee?`${i.assignee}${i.assignedBy?` — delegated by ${i.assignedBy}`:""}`:void 0,children:[i.assignee??"—",i.assignedBy?(0,e.jsxs)("span",{style:{color:"var(--fg-mute)"},children:[" ·by ",i.assignedBy]}):null]})},{key:"severity",header:"Sev",width:.9,toCopyText:i=>i.severity??"",filter:{type:"enum",accessor:i=>i.severity},render:({row:i})=>i.severity?(0,e.jsx)(he,{severity:i.severity,size:"xs"}):(0,e.jsx)(e.Fragment,{children:"—"})},{key:"priority",header:"Prio",width:.8,toCopyText:i=>i.priority==null?"":String(i.priority),filter:{type:"number",accessor:i=>i.priority},render:({row:i})=>(0,e.jsx)(e.Fragment,{children:i.priority??"—"})},{key:"rank",header:"Rank",width:.8,toCopyText:i=>i.rank==null?"":String(i.rank),filter:{type:"number",accessor:i=>i.rank},render:({row:i})=>(0,e.jsx)(e.Fragment,{children:i.rank??"—"})},{key:"plan",header:"Plan",width:1.8,toCopyText:i=>i.planSlug??"",filter:{type:"enum",accessor:i=>i.planSlug},render:({row:i})=>i.planSlug?(0,e.jsx)("code",{style:{...K,fontSize:11},title:i.planSlug,children:i.planSlug}):(0,e.jsx)(e.Fragment,{children:"—"})}],$=da(N,v??[],{ns:"wi"}),F=(0,c.useMemo)(()=>{const i=n.trim().toLowerCase();return i?$.rows.filter(m=>`${m.id} ${m.title} ${m.state} ${m.assignee??""}`.toLowerCase().includes(i)):$.rows},[$.rows,n]),E=$.hasActive||n.trim()!=="",R=v?Sa(F.length,k,E):null,P=R?.title;return(0,c.useEffect)(()=>{P!=null&&a.setTitle(`Work items · ${r} (${P})`)},[P,r,a]),r?(0,e.jsxs)("div",{className:"pc-advpanel",children:[(0,e.jsxs)("div",{className:"pc-advpanel__bar",children:[(0,e.jsx)("input",{type:"text",className:"pc-advpanel__input",value:n,onChange:i=>{s(i.target.value)},placeholder:"Filter work items…","aria-label":"Filter work items"}),(0,e.jsx)(ka,{controller:$.controller,activeChips:$.activeChips,hasActive:$.hasActive,clearAll:$.clearAll}),R?(0,e.jsx)(O,{label:E?"Rows matching the current filter / search, out of the store total.":"Total work items for this harness.",children:(0,e.jsx)("span",{className:"pc-advpanel__count","data-testid":"wi-count","aria-live":"polite",style:{marginLeft:"auto",fontSize:11,color:"var(--fg-mute)",whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"},children:R.summary})}):null,(0,e.jsx)(O,{label:"Refresh work items",children:(0,e.jsx)("button",{type:"button",className:"pc-advpanel__iconbtn",onClick:()=>x.invalidate(),disabled:b,"aria-label":"Refresh work items",children:(0,e.jsx)(mt,{size:13,"aria-hidden":!0,className:b?"pc-advpanel__spin":void 0})})})]}),g?(0,e.jsxs)("div",{className:"pc-advpanel__empty pc-advpanel__empty--err",children:["Could not load work items: ",g]}):v?F.length===0?(0,e.jsx)("div",{className:"pc-advpanel__empty",children:v.length===0?"No work items for this harness.":"No work items match the filter."}):(0,e.jsx)(Ye,{columns:N,rows:F,resizableColumns:!0,columnWidths:f,onColumnWidthsChange:h,getRowId:i=>i.id,onRowClick:i=>{l(i.id)},getRowBg:i=>i.id===o?"color-mix(in oklab, var(--accent), transparent 80%)":void 0,rowMinHeight:30,headerHeight:30,onEndReached:T?A:void 0}):(0,e.jsx)("div",{className:"pc-advpanel__empty",children:"Loading work items…"})]}):(0,e.jsx)("div",{className:"pc-advpanel__empty",children:"Pick a harness to view its work items."})}function Na(t){const a=t.spawnStatus?.trim()||null,r=t.errorMessage?.trim()||void 0;switch(a){case"done":return{kind:"done",label:"done"};case"failed":return{kind:"failed",label:`failed${t.exitCode!=null&&t.exitCode!==0?` (exit ${t.exitCode})`:""}`,detail:r};case"cancelled":return{kind:"cancelled",label:"cancelled",detail:r};case"reaped":return{kind:"muted",label:"reaped",detail:r};case"running":case"restarting":return{kind:"running",label:a};default:return t.running?{kind:"running",label:"running"}:null}}var Ca=["open","wip","blocked","needs-human","done","dropped"],G=[],ce=!1;async function $a(t,a){try{const r=await fetch("/api/adv/sessions/launch-su",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agent:"claude",harness_slug:t,resume_session_id:a})}),n=await r.json().catch(()=>({}));if(!r.ok||n.status==="error")throw new Error(n.error||`${r.status}`);M.success(`Session ${a.slice(0,12)}… opening in a terminal.`)}catch(r){M.error("Open session failed",{description:String(r)})}}function ve(t){const a=typeof t=="number"?t:Date.parse(String(t));if(!Number.isFinite(a))return"";const r=Math.max(0,Math.round((Date.now()-a)/1e3));if(r<60)return`${r}s ago`;const n=Math.round(r/60);if(n<60)return`${n}m ago`;const s=Math.round(n/60);return s<24?`${s}h ago`:`${Math.round(s/24)}d ago`}function Aa(t){return t.trim()?t.split(/^## \S+ \d{4}-\d{2}-\d{2}T[^\n]+\s*$/gm).map(a=>a.trim()).filter(Boolean):[]}function Ea(t){return t?t.startsWith("F-")?"feature":t.startsWith("I-")?"issue":t.startsWith("agent:")?"agent":"workItem":null}function bn({params:t,api:a}){const r=ae(),n=t.harnessSlug||"",s=t.itemId||null,[o,l]=q("sel",Z.withDefault("")),[f,h]=q("edit",Z.withDefault("")),d=s??o,{features:p,patchFeature:y}=ra(n),{issues:x,patchIssue:v}=sa(n),{data:b}=D({queryName:"agentRunsConsolidated.bySlug",args:n?{harnessSlug:n}:void 0,enabled:!!n}),g=(0,c.useCallback)(C=>{l(C||null),h(null)},[l,h]),_=(0,c.useRef)("");(0,c.useEffect)(()=>{if(s)return;if(ce){ce=!1,_.current=o;return}const C=_.current;C&&C!==o&&(G.push(C),G.length>50&&G.shift()),_.current=o},[o,s]);const u=(0,c.useCallback)(()=>{const C=G.pop();C!==void 0&&(ce=!0,l(C||null))},[l]),w=!s&&G.length>0?u:void 0,k=(0,c.useMemo)(()=>Ea(d),[d]),T=D({queryName:"featuresConsolidated.detail",args:{harnessSlug:n,featureId:d,workspaceId:te()},enabled:!!n&&k==="feature"&&!!d}),A=!T.loading&&T.data?.[0]?.featureId===d?T.data[0].summary??void 0:void 0,N=(0,c.useMemo)(()=>{if(k!=="feature")return null;const C=(p??[]).find(W=>W.id===d)??null;return C?A!==void 0?{...C,summary:A}:C:null},[k,p,d,A]),$=(0,c.useMemo)(()=>k==="issue"?(x??[]).find(C=>C.id===d)??null:null,[k,x,d]),F=D({queryName:"workItems.byHarness",args:{harnessSlug:n,limit:500},enabled:!!n&&k==="workItem"}),E=F.loading?null:F.data,R=D({queryName:"workItems.detail",args:{harnessSlug:n,id:d},enabled:!!n&&k==="workItem"&&!!d}),P=R.loading?null:R.data?.[0]??null,i=(0,c.useMemo)(()=>{if(k!=="workItem")return null;const C=(E??[]).find(W=>W.id===d)??null;return P&&P.id===d?P:C},[k,E,P,d]),m=D({queryName:"fleetAssignments.byHarness",args:{harnessSlug:n},enabled:!!n&&k==="agent"}),S=m.loading?null:m.data,I=(0,c.useMemo)(()=>k==="agent"?(S??[]).find(C=>`agent:${C.agentId}`===d)??null:null,[k,S,d]);return(0,c.useEffect)(()=>{s?a.setTitle(s):N?a.setTitle(`Detail · ${N.id}`):$?a.setTitle(`Detail · ${$.id}`):i?a.setTitle(`Detail · ${i.id}`):I?a.setTitle(`Detail · ${Fe(I.name??I.label??I.agentId,r)}`):a.setTitle("Detail")},[a,s,N,$,i,I,r]),n?d?d&&!N&&!$&&!i&&!I?p===null||x===null||k==="workItem"&&E===null||k==="agent"&&S===null?(0,e.jsxs)(J,{children:["Loading ",d,"…"]}):k==="agent"?(0,e.jsxs)(J,{children:["Agent ",d.slice(6)," is no longer working here."]}):(0,e.jsxs)(J,{tone:"error",children:["No item found for ",d,"."]}):N?(0,e.jsx)(Ta,{slug:n,feature:N,issues:x??[],runs:Array.isArray(b)?b:[],onSelect:g,onBack:w,patchFeature:y,isEditing:!s&&f===N.id,onStartEdit:()=>{h(N.id)},onCloseEdit:()=>{h(null)}}):$?(0,e.jsx)(Ra,{slug:n,issue:$,onSelect:g,onBack:w,patchIssue:v}):i?(0,e.jsx)(qe,{slug:n,workItem:i,onSelect:g,onBack:w}):I?(0,e.jsx)(Ia,{agent:I,onSelect:g,onBack:w}):null:(0,e.jsx)(J,{children:"Pick a work item from the list to inspect."}):(0,e.jsxs)(J,{children:["Pick a ",r("pot",{lower:!0})," to inspect its work items."]})}function Ia({agent:t,onSelect:a,onBack:r}){const n=ae(),s=rt(t.heartbeatAt??""),o=l=>!!l&&(l.startsWith("F-")||l.startsWith("I-")||l.startsWith("WI-"));return(0,e.jsxs)("div",{className:"pc-adv-detail pc-adv-detail--compact",children:[(0,e.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,e.jsx)(re,{onBack:r}),(0,e.jsx)("div",{className:"pc-adv-detail__id",children:t.agentId}),(0,e.jsx)("div",{className:"pc-adv-detail__title",children:Fe(t.name??t.label??t.agentId,n)}),(0,e.jsxs)("div",{className:"pc-adv-detail__meta",children:[(0,e.jsx)(ea,{kind:t.agentPaneKind,size:"xs"}),(0,e.jsxs)("span",{className:"pc-adv-detail__liveness",children:[(0,e.jsx)(it,{liveness:s,title:""}),s,t.heartbeatAt?(0,e.jsxs)("span",{className:"pc-adv-detail__muted",children:[" · heartbeat ",ve(t.heartbeatAt)]}):null]}),t.driveMode?(0,e.jsxs)("span",{className:"pc-adv-detail__stat",children:["drive: ",t.driveMode]}):null,t.load>0?(0,e.jsxs)("span",{className:"pc-adv-detail__stat",children:["load: ",t.load]}):null,t.orphaned&&(0,e.jsx)(O,{label:"This agent holds claims but is no longer present — its work may need re-placing.",children:(0,e.jsx)("span",{className:"pc-adv-detail__warn-chip",children:"orphaned claims"})}),t.declaredUnclaimed&&(0,e.jsx)(O,{label:"Declared an intent without claiming items — invisible to fleet placement.",children:(0,e.jsx)("span",{className:"pc-adv-detail__warn-chip",children:"declared, unclaimed"})})]})]}),(0,e.jsxs)("section",{className:"pc-adv-detail__body",children:[t.intent?(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Intent"}),(0,e.jsx)("p",{className:"pc-adv-detail__prose",children:t.intent})]}):null,(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Working on"}),t.doing?(0,e.jsxs)("div",{className:"pc-adv-detail__related",children:[(0,e.jsx)(O,{label:t.doing.title,children:(0,e.jsxs)("button",{type:"button","data-testid":"agent-detail-doing",className:"pc-adv-detail__related-row",disabled:!o(t.doing.id),onClick:()=>o(t.doing.id)&&a(t.doing.id),children:[(0,e.jsx)("span",{className:"pc-adv-detail__related-id",children:t.doing.id}),(0,e.jsx)("span",{className:"pc-adv-detail__related-title",children:t.doing.title})]})}),t.queued.length>0&&(0,e.jsx)("div",{className:"pc-adv-detail__queue",children:t.queued.map((l,f)=>(0,e.jsx)("button",{type:"button",className:"pc-adv-detail__queue-chip",disabled:!o(l.id),onClick:()=>o(l.id)&&a(l.id),children:l.id},`${l.id}-${f}`))})]}):(0,e.jsx)("p",{className:"pc-adv-detail__muted",children:"Nothing claimed right now."})]}),t.claims.length>0&&(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsxs)("h3",{children:["Claims (",t.claims.length,")"]}),(0,e.jsx)("div",{className:"pc-adv-detail__related",children:t.claims.map((l,f)=>(0,e.jsxs)("div",{className:"pc-adv-detail__claim-row",children:[(0,e.jsx)("span",{className:"pc-adv-detail__related-id",children:o(l.id)?(0,e.jsx)("button",{type:"button",className:"pc-adv-detail__link pc-adv-detail__link-btn",onClick:()=>a(l.id),children:l.id}):l.id??l.type}),(0,e.jsx)("span",{className:"pc-adv-detail__claim-type",children:l.type}),(0,e.jsx)("span",{className:"pc-adv-detail__related-title",title:l.detail,children:l.detail})]},`${l.id??l.detail}-${f}`))})]})]}),(0,e.jsx)(ie,{})]})}function qe({slug:t,workItem:a,onSelect:r,onBack:n,onOpenChat:s}){const[o,l]=(0,c.useState)(!1),f=async()=>{l(!0);try{const d=await He({slug:t,role:"worker",featureId:a.id,title:a.title,mode:"discuss",...s?{dispatch:!1}:{}});if(d&&typeof d=="object"&&"error"in d)throw new Error(String(d.error));s&&d&&typeof d=="object"&&"chatId"in d&&s(String(d.chatId))}catch(d){M.error("Open chat failed",{description:String(d)})}finally{l(!1)}},h=[["Kind",(0,e.jsxs)(e.Fragment,{children:[(0,e.jsx)("span",{className:"pc-adv-detail__kind-chip",children:a.kind})," ",(0,e.jsxs)("span",{className:"pc-adv-detail__muted",children:["(",a.family," family)"]})]})],["State",a.family==="issue"?(0,e.jsx)(ge,{status:a.state,size:"xs"}):(0,e.jsx)(ee,{status:a.state,size:"xs"})],["Severity",a.severity?(0,e.jsx)(he,{severity:a.severity,size:"xs"}):"—"],["Assignee",a.assignee?`${a.assignee}${a.assignedBy?` · by ${a.assignedBy}`:""}`:"—"],["Priority",a.priority??"—"],["Rank",a.rank??"—"],["Stage",a.spineRole?`${a.spineRole}${a.spineStatus?` (${a.spineStatus})`:""}`:"—"],["Updated",a.updatedAt?(0,e.jsx)("span",{title:new Date(a.updatedAt).toLocaleString(),children:ve(a.updatedAt)}):"—"]];return(0,e.jsxs)("div",{className:"pc-adv-detail pc-adv-detail--compact",children:[(0,e.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,e.jsx)(re,{onBack:n}),(0,e.jsx)("div",{className:"pc-adv-detail__id",children:a.id}),(0,e.jsx)("div",{className:"pc-adv-detail__title",children:a.title})]}),(0,e.jsxs)("div",{className:"pc-adv-detail__body",children:[(0,e.jsxs)("div",{className:"pc-adv-detail__section pc-adv-detail__fields",children:[h.map(([d,p])=>(0,e.jsxs)("div",{className:"pc-adv-detail__field-row",children:[(0,e.jsx)("span",{className:"pc-adv-detail__field-label",children:d}),(0,e.jsx)("span",{children:p})]},d)),a.planSlug?(0,e.jsxs)("div",{className:"pc-adv-detail__field-row",children:[(0,e.jsx)("span",{className:"pc-adv-detail__field-label",children:"Plan"}),(0,e.jsx)("code",{className:"pc-adv-detail__pointer",children:a.planSlug})]}):null]}),a.summary?(0,e.jsx)("div",{className:"pc-adv-detail__section",children:(0,e.jsx)("div",{className:"pc-adv-detail__prose",children:a.summary})}):null,a.family==="feature"&&a.id.startsWith("F-")?(0,e.jsxs)("button",{type:"button",className:"pc-adv-detail__link pc-adv-detail__link-btn",onClick:()=>r(a.id),children:["Open feature detail ",(0,e.jsx)(Ee,{size:12})]}):null,(0,e.jsx)("div",{className:"pc-adv-detail__section",children:(0,e.jsx)("div",{className:"pc-adv-detail__actions",children:(0,e.jsxs)("button",{type:"button","data-testid":"wi-detail-chat",disabled:o,onClick:()=>{f()},children:[(0,e.jsx)(Te,{size:13,"aria-hidden":!0})," Chat"]})})})]}),(0,e.jsx)(ie,{})]})}function re({onBack:t}){return t?(0,e.jsx)(O,{label:"Back to previous selection",children:(0,e.jsx)("button",{type:"button",className:"pc-adv-detail__back",onClick:t,children:"← Back"})}):null}function Ta({slug:t,feature:a,issues:r,runs:n,onSelect:s,onBack:o,patchFeature:l,isEditing:f,onStartEdit:h,onCloseEdit:d}){const p=ae(),[y,x]=(0,c.useState)(null),[v,b]=(0,c.useState)(null),[g,_]=(0,c.useState)(!1),[u,w]=(0,c.useState)(""),{confirm:k,element:T}=Ae(),A=D({queryName:"featureNotes.byHarness",args:{harnessSlug:t},enabled:!!t,staleTime:3e4}),N=A.data?.find(m=>m.featureId===a.id),$=(0,c.useCallback)(async()=>{const m=u.trim();if(m){x("steer");try{const S=await fetch(`/api/harness/${encodeURIComponent(t)}/features/${encodeURIComponent(a.id)}/notes`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:m})});if(!S.ok)throw new Error(`${S.status}: ${await S.text()}`);b(I=>[...I??[],m]),A.invalidate(),w(""),_(!0),M.success("Steer note added")}catch(S){M.error("Add steer note failed",{description:String(S)})}finally{x(null)}}},[a.id,A,t,u]),F=(0,c.useMemo)(()=>r.filter(m=>m.linkedFeatureId===a.id||m.foundDuring===a.id),[r,a.id]),E=(0,c.useMemo)(()=>n.filter(m=>m.featureId===a.id).sort((m,S)=>Date.parse(String(S.ts))-Date.parse(String(m.ts))).slice(0,3),[n,a.id]);(0,c.useEffect)(()=>{if(A.loading){b(null);return}b(Aa(N?.content??""))},[A.loading,N?.content]);const R=(0,c.useCallback)(async(m,S)=>{const I=await fetch(`/api/harness/${encodeURIComponent(t)}${m}`,S);if(!I.ok)throw new Error(`${I.status}: ${await I.text()}`);return I.json()},[t]),P=(0,c.useCallback)(async m=>{const S=a.status;l(a.id,{status:m}),x(`status:${m}`);try{await R(`/features/${a.id}?phase=staging`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:m})}),M.success(`${a.id} → ${m}`)}catch(I){l(a.id,{status:S}),M.error("Status change failed",{description:String(I)})}finally{x(null)}},[R,a.id,a.status,l]),i=(0,c.useCallback)(async()=>{if(!await k({title:`Reset ${a.id}?`,body:`Reset ${a.id} back to open and clear its attempts. The worker will pick it up fresh.`,destructive:!0,confirmLabel:"Reset"}))return;const m={status:a.status,attempts:a.attempts};l(a.id,{status:"open",attempts:0}),x("reset");try{await R(`/features/${a.id}/reset?phase=staging`,{method:"POST"}),M.success(`${a.id} reset`)}catch(S){l(a.id,m),M.error("Reset failed",{description:String(S)})}finally{x(null)}},[R,a.id,a.status,a.attempts,l,k]);return f?(0,e.jsx)(aa,{embedded:!0,slug:t,feature:{id:a.id,title:a.title,claims:a.claims,status:a.status,attempts:a.attempts??0},onClose:d,onSaved:()=>{}}):(0,e.jsxs)("div",{className:"pc-adv-detail",children:[(0,e.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,e.jsx)(re,{onBack:o}),(0,e.jsx)("div",{className:"pc-adv-detail__id",children:a.id}),(0,e.jsx)("div",{className:"pc-adv-detail__title",children:a.title}),(0,e.jsxs)("div",{className:"pc-adv-detail__meta",children:[(0,e.jsx)(ee,{status:a.status}),typeof a.attempts=="number"&&a.attempts>0&&(0,e.jsxs)("span",{className:"pc-adv-detail__attempts",children:[a.attempts,"× attempts"]}),a.sourcePlanSlug&&(0,e.jsx)(O,{label:`From plan: ${a.sourcePlanSlug}`,children:(0,e.jsxs)("span",{className:"pc-adv-detail__plan",children:["↗ ",a.sourcePlanSlug]})})]})]}),(0,e.jsxs)("section",{className:"pc-adv-detail__body",children:[(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Description"}),a.summary?(0,e.jsx)("p",{className:"pc-adv-detail__prose",children:a.summary}):(0,e.jsx)("p",{className:"pc-adv-detail__muted",children:"No description."})]}),(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Status"}),(0,e.jsx)("div",{className:"pc-adv-detail__status-row",children:(0,e.jsx)(fe,{value:a.status,onChange:m=>{P(m)},disabled:y!==null,ariaLabel:"Change status",triggerClassName:"pc-adv-detail__select",options:Ca.map(m=>({value:m,label:(0,e.jsx)(ee,{status:m,size:"xs"})}))})})]}),F.length>0&&(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsxs)("h3",{children:["Issues (",F.length,")"]}),(0,e.jsx)("div",{className:"pc-adv-detail__related",children:F.map(m=>(0,e.jsx)(O,{label:m.title,children:(0,e.jsxs)("button",{type:"button",className:"pc-adv-detail__related-row",onClick:()=>s(m.id),children:[(0,e.jsx)("span",{className:"pc-adv-detail__related-id",children:m.id}),(0,e.jsx)("span",{className:"pc-adv-detail__related-dot",style:{background:ze[m.severity].solid}}),(0,e.jsx)("span",{className:"pc-adv-detail__related-title",children:m.title})]})},m.id))})]}),(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Recent activity"}),E.length===0?(0,e.jsx)("p",{className:"pc-adv-detail__muted",children:"No agent runs for this feature yet."}):(0,e.jsx)("div",{className:"pc-adv-detail__runs",children:E.map(m=>{const S=Na(m);return(0,e.jsxs)("div",{className:"pc-adv-detail__run-block",children:[(0,e.jsxs)("div",{className:"pc-adv-detail__run",children:[(0,e.jsx)("span",{className:"pc-adv-detail__run-role",children:xt(m.role,p)}),(0,e.jsx)("span",{className:"pc-adv-detail__run-time",children:ve(m.ts)}),(0,e.jsxs)("span",{className:"pc-adv-detail__run-right",children:[m.costUsd!=null&&Number(m.costUsd)>0&&(0,e.jsxs)("span",{className:"pc-adv-detail__run-cost",children:["$",Number(m.costUsd).toFixed(2)]}),S&&(0,e.jsx)("span",{className:`pc-adv-detail__run-outcome is-${S.kind}`,title:S.detail,children:S.label}),m.sessionId&&(0,e.jsx)(O,{label:"Open this run's agent session in a terminal (claude --resume)",children:(0,e.jsx)("button",{type:"button",className:"pc-adv-detail__run-open",onClick:()=>{$a(t,m.sessionId)},children:"Open session"})})]})]}),S?.kind==="failed"&&S.detail&&(0,e.jsx)("div",{className:"pc-adv-detail__run-error",title:S.detail,children:S.detail})]},m.runId)})})]}),(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:(0,e.jsxs)("button",{type:"button",className:"pc-adv-detail__collapse",onClick:()=>_(m=>!m),children:[g?"▾":"▸"," Steer notes",v&&v.length>0?` (${v.length})`:""]})}),g&&(0,e.jsxs)(e.Fragment,{children:[v&&v.length>0&&(0,e.jsx)("div",{className:"pc-adv-detail__notes",children:v.map((m,S)=>(0,e.jsx)("p",{className:"pc-adv-detail__note",children:m},S))}),(0,e.jsxs)("div",{className:"pc-adv-detail__note-form",children:[(0,e.jsx)("textarea",{value:u,onChange:m=>w(m.target.value),placeholder:"Add a steer note for the worker…",rows:2,"aria-label":"Add a steer note"}),(0,e.jsx)("button",{type:"button",disabled:y!==null||!u.trim(),onClick:()=>{$()},children:"Add steer note"})]})]})]}),(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Actions"}),(0,e.jsxs)("div",{className:"pc-adv-detail__actions",children:[(0,e.jsxs)("button",{type:"button",disabled:y!==null,onClick:async()=>{x("chat");try{const m=await He({slug:t,role:"worker",featureId:a.id,title:a.summary||a.title,mode:"discuss"});if(m&&typeof m=="object"&&"error"in m)throw new Error(String(m.error))}catch(m){M.error("Open chat failed",{description:String(m)})}finally{x(null)}},children:[(0,e.jsx)(Te,{size:13,"aria-hidden":!0})," Chat"]}),(0,e.jsx)("button",{type:"button",disabled:y!==null,onClick:i,children:"Reset"}),(0,e.jsx)("button",{type:"button",disabled:y!==null,onClick:h,children:"Edit"})]})]})]}),T,(0,e.jsx)(ie,{})]})}function Ra({slug:t,issue:a,onSelect:r,onBack:n,patchIssue:s}){const[o,l]=(0,c.useState)(null),[f,h]=(0,c.useState)(""),[d,p]=(0,c.useState)([]);(0,c.useEffect)(()=>{p([])},[a.id]);const y=(0,c.useMemo)(()=>[...a.notes??[],...d],[a.notes,d]),x=(0,c.useCallback)(async b=>{const g=We(b),_=a.status;g&&s(a.id,{status:g}),l(b);try{await la(t,a.id,b),M.success(`${a.id} → ${b}`)}catch(u){g&&s(a.id,{status:_}),M.error(`${b} failed`,{description:String(u)})}finally{l(null)}},[t,a.id,a.status,s]),v=(0,c.useCallback)(async()=>{const b=f.trim();if(b){l("note");try{const g=await fetch(`/api/harness/${encodeURIComponent(t)}/issues/${encodeURIComponent(a.id)}/update`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({note:b,by:"human"})});if(!g.ok)throw new Error(`${g.status}: ${await g.text()}`);p(_=>[..._,{ts:new Date().toISOString(),by:"human",text:b}]),h(""),M.success("Note added")}catch(g){M.error("Add note failed",{description:String(g)})}finally{l(null)}}},[t,a.id,f]);return(0,e.jsxs)("div",{className:"pc-adv-detail",children:[(0,e.jsxs)("header",{className:"pc-adv-detail__header",children:[(0,e.jsx)(re,{onBack:n}),(0,e.jsx)("div",{className:"pc-adv-detail__id",children:a.id}),(0,e.jsx)("div",{className:"pc-adv-detail__title",children:a.title}),(0,e.jsxs)("div",{className:"pc-adv-detail__meta",children:[(0,e.jsx)(he,{severity:a.severity}),(0,e.jsx)(ge,{status:a.status}),a.linkedFeatureId&&(0,e.jsx)(O,{label:`Go to linked feature ${a.linkedFeatureId}`,children:(0,e.jsxs)("button",{type:"button",className:"pc-adv-detail__link pc-adv-detail__link-btn",onClick:()=>r(a.linkedFeatureId),children:[(0,e.jsx)(Ee,{size:11,"aria-hidden":!0})," ",a.linkedFeatureId]})})]})]}),(0,e.jsxs)("section",{className:"pc-adv-detail__body",children:[a.evidence&&(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Evidence"}),(0,e.jsx)("pre",{className:"pc-adv-detail__code",children:a.evidence})]}),a.repro&&(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Reproduction"}),(0,e.jsx)("pre",{className:"pc-adv-detail__code",children:a.repro})]}),a.suggestedFix&&(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Suggested fix"}),(0,e.jsx)("pre",{className:"pc-adv-detail__code",children:a.suggestedFix})]}),a.codePointer&&(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Code pointer"}),(0,e.jsx)("code",{className:"pc-adv-detail__pointer",children:a.codePointer})]}),(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsxs)("h3",{children:["Notes",y.length>0?` (${y.length})`:""]}),y.length>0&&(0,e.jsx)("div",{className:"pc-adv-detail__notes",children:y.map((b,g)=>(0,e.jsxs)("div",{className:"pc-adv-detail__note-row",children:[(0,e.jsxs)("div",{className:"pc-adv-detail__note-meta",children:[b.by," · ",b.ts?new Date(b.ts).toLocaleString():""]}),(0,e.jsx)("p",{className:"pc-adv-detail__note",children:b.text})]},g))}),(0,e.jsxs)("div",{className:"pc-adv-detail__note-form",children:[(0,e.jsx)("textarea",{value:f,onChange:b=>h(b.target.value),placeholder:"Add a note…",rows:2,"aria-label":"Add a note"}),(0,e.jsx)("button",{type:"button",disabled:o!==null||!f.trim(),onClick:()=>{v()},children:"Add note"})]})]}),(0,e.jsxs)("div",{className:"pc-adv-detail__section",children:[(0,e.jsx)("h3",{children:"Actions"}),(0,e.jsxs)("div",{className:"pc-adv-detail__actions",children:[!a.linkedFeatureId&&a.status!=="closed"&&a.status!=="wontfix"&&(0,e.jsx)("button",{type:"button",disabled:o!==null,onClick:()=>{x("promote")},children:"Promote"}),a.status!=="acknowledged"&&a.status!=="closed"&&(0,e.jsx)("button",{type:"button",disabled:o!==null,onClick:()=>{x("acknowledge")},children:"Acknowledge"}),a.status!=="closed"&&(0,e.jsx)("button",{type:"button",disabled:o!==null,onClick:()=>{x("close")},children:"Close"}),a.status!=="wontfix"&&(0,e.jsx)("button",{type:"button",disabled:o!==null,onClick:()=>{x("wontfix")},children:"Won't fix"})]})]})]}),(0,e.jsx)(ie,{})]})}function J({children:t,tone:a}){return(0,e.jsx)("div",{style:{height:"100%",display:"grid",placeItems:"center",padding:24,color:a==="error"?"var(--bad, #fb7185)":"var(--fg-mute, #7f9bb4)",fontSize:13,textAlign:"center"},children:t})}function ie(){return(0,e.jsx)("style",{children:`
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
    `})}function yn({id:t,harnessSlug:a,onSelect:r,onClose:n}){const s=t!==null,[o,l]=(0,c.useState)(null);(0,c.useEffect)(()=>{l(null)},[t]);const f=D({queryName:"workItems.detail",args:{harnessSlug:a??"",id:t??""},enabled:s&&!!a&&!!t}),h=(0,c.useMemo)(()=>f.data?.[0]??null,[f.data]);let d;return a?f.loading?d=(0,e.jsxs)("div",{className:"wi-popup__empty",children:["Loading ",t,"…"]}):!h||h.id!==t?d=(0,e.jsxs)("div",{className:"wi-popup__empty",children:["No item found for ",t,"."]}):o?d=(0,e.jsxs)("div",{className:"wi-popup__chat","data-testid":"wi-popup-chat",children:[(0,e.jsxs)("button",{type:"button",className:"wi-popup__chat-back",onClick:()=>l(null),"data-testid":"wi-popup-chat-back",children:["← Back to ",t]}),(0,e.jsx)(st,{slug:a,chatId:o,mode:"discuss"})]}):d=(0,e.jsx)(qe,{slug:a,workItem:h,onSelect:r,onOpenChat:l}):d=(0,e.jsxs)("div",{className:"wi-popup__empty",children:["No harness context for ",t,"."]}),s?(0,e.jsxs)($e,{open:!0,onOpenChange:p=>{p||n()},title:h?.title?`${t} — ${h.title}`:t??"Work item",srOnlyTitle:!0,contentClassName:"wi-popup",contentStyle:{width:"min(760px, 94vw)",height:"min(720px, calc(100vh - 4rem))",display:"flex",flexDirection:"column",overflow:"hidden",padding:0},children:[(0,e.jsx)("div",{className:"wi-popup__header",children:(0,e.jsx)("button",{type:"button",className:"wi-popup__close",onClick:n,"aria-label":"Close work item popup","data-testid":"wi-popup-close",children:"✕"})}),(0,e.jsx)("div",{className:"wi-popup__body","data-testid":"wi-popup-body",children:d})]}):null}export{Ue as _,da as a,sa as c,ea as d,Xt as f,Wt as g,He as h,ka as i,vn as l,_e as m,bn as n,gn as o,ee as p,xn as r,ra as s,yn as t,Zt as u,X as v,_t as y};
