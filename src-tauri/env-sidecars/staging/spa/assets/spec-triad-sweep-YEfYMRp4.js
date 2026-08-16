import{n as I}from"./chunk-ChpBd9eV.js";import{s as R}from"./types-DoRTXl1W.js";import{t as N}from"./src-DduH0PES.js";import{st as F,t as D}from"./src-8fWtxfEz.js";import{l as L,o as P}from"./server-BXcXKvn3.js";import{f as v,t as C}from"./src-BB4lVSvl.js";import{i as O,o as k,r as b,s as M}from"./spec-triad-policy-4pvWSP_G.js";import{n as U,r as x,t as G}from"./spec-triad-filing-G9VvisGd.js";function m(a){return`${a.workspace_id}/${a.harness_slug}/${a.plan_slug}`}function W(a){return Array.isArray(a)?a.length:void 0}function H(a){const{rows:t,alreadyOpen:d,candidateKeys:o,epoch:_,maxFilings:p}=a,s=[];let i=0;for(const n of t){if(o&&!o.has(m(n)))continue;const r=M({planSlug:n.plan_slug,content:n.content,created:n.created,itemCount:W(n.items)},{flagEnabled:!0,epoch:_});r.scope.inScope&&i++,!(!r.gated||!r.triad)&&s.push({row:n,missing:r.missing,gap:v(r.triad)})}const l=s.filter(n=>!d.has(m(n.row))),f=l.slice(0,Math.max(0,p));return{inScope:i,owing:s,toFile:l,batch:f,deferred:l.length-f.length,alreadyFiled:s.length-l.length}}async function se(a={}){const t=e=>({skipped:!0,reason:e,scanned:0,inScope:0,owing:0,filed:0,alreadyFiled:0,deferred:0,filedIds:[],summary:`skipped: ${e}`});if({}.PAPERCUSP_SPEC_TRIAD_SWEEP==="0")return t("kill-switch");let d=a.flagEnabled;if(d===void 0)try{d=await P(R.SPEC_TRIAD_REQUIRED,"system:spec-triad-sweep")}catch{return t("flag unreadable")}if(!d)return t("flag off");const o=k(),_=a.maxFilings??25,{sql:p}=F();let s=[];try{s=await p`
      SELECT workspace_id,
             harness_slug,
             plan_slug,
             created,
             (content LIKE '%specTriad:%') AS has_declaration
        FROM harness_shared.harness_plans
       WHERE archived = false
         AND is_legacy = false
         AND (status IS NULL OR status = ANY(${y}))
    `}catch(e){return t(`plan scan failed: ${e.message}`)}const i=s.filter(e=>e.has_declaration?!0:O({content:"",created:e.created},{flagEnabled:!0,epoch:o}).inScope);if(i.length===0)return{skipped:!1,scanned:s.length,inScope:0,owing:0,filed:0,alreadyFiled:0,deferred:0,filedIds:[],summary:`${s.length} live plan(s) scanned, none in scope for the spec triad`};const l=i.map(e=>e.plan_slug);let f=[];try{f=await p`
      SELECT workspace_id, harness_slug, plan_slug, created, content, items
        FROM harness_shared.harness_plans
       WHERE archived = false
         AND is_legacy = false
         AND plan_slug = ANY(${l})
    `}catch(e){return t(`plan content read failed: ${e.message}`)}const n=new Set(i.map(m));let r=new Set;try{const e=await p`
      SELECT DISTINCT payload->>'specTriadPlan' AS ref
        FROM harness_shared.work_items
       WHERE payload->>'specTriadPlan' IS NOT NULL
         AND status = ANY(${G})
    `;r=new Set(e.map(g=>g.ref).filter(g=>!!g))}catch(e){return t(`dedupe read failed: ${e.message}`)}const{inScope:S,owing:E,batch:T,deferred:h,alreadyFiled:w}=H({rows:f,alreadyOpen:r,candidateKeys:n,epoch:o,maxFilings:_}),u=[];for(const{row:e,missing:g,gap:$}of T){const c=await U({workspaceId:e.workspace_id,harnessSlug:e.harness_slug,planSlug:e.plan_slug,missing:g,gap:$});c.outcome==="created"&&c.id?u.push(c.id):c.outcome==="error"&&console.warn(`[spec-triad-sweep] filing for ${c.ref} failed (non-fatal): ${c.error}`)}const A=`${s.length} live plan(s) scanned · ${S} in scope · ${E.length} owing the triad · ${u.length} filed · ${w} already filed`+(h>0?` · ${h} DEFERRED past the ${_}/run cap`:"");return{skipped:!1,scanned:s.length,inScope:S,owing:E.length,filed:u.length,alreadyFiled:w,deferred:h,filedIds:u,summary:A}}var K,y,Y=I((()=>{D(),L(),N(),C(),b(),x(),K=25,y=["draft","ready","active"]}));Y();export{se as runSpecTriadSweepOnce};
