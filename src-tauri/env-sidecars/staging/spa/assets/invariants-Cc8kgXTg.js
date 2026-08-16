const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/pg-read-query-DfBwH5mP.js","assets/pg-read-query--ASww7An.js","assets/chunk-ChpBd9eV.js","assets/src-8fWtxfEz.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js"])))=>i.map(i=>d[i]);
import{n as p,o as m}from"./chunk-ChpBd9eV.js";import{n as v,t as y}from"./preload-helper-CcgcQsTF.js";import{st as c,t as h}from"./src-8fWtxfEz.js";import{t as w}from"./__vite-browser-external-56mrcCg8.js";import{O as E,j as g}from"./pg-read-query--ASww7An.js";function _(e,n){const r=t=>`'${t.replace(/'/g,"''")}'`;return e.replace(/\{\{\s*fleet\s*\}\}/g,r(n.fleet)).replace(/\{\{\s*workspace\s*\}\}/g,r(n.workspace))}function S(e){let n=0,r=0,t=0;for(const i of e)i.status==="error"?t+=1:i.status==="violated"&&(n+=1,i.severity==="critical"&&(r+=1));return{evaluated:e.length,violated:n,criticalViolated:r,errored:t}}function L(e){const{violated:n,criticalViolated:r,errored:t}=S(e);if(n===0&&t===0)return;const i=[];if(n>0){const s=e.filter(a=>a.status==="violated").map(a=>`${a.name}(${a.violationCount??0}${a.truncated?"+":""})`).join(", ");i.push(`${n} custom invariant(s) VIOLATED — ${s}`+(r>0?` — ${r} of them critical`:""))}if(t>0){const s=e.filter(a=>a.status==="error").map(a=>a.name).join(", ");i.push(`${t} invariant(s) FAILED TO RUN (${s}) — a check that cannot run is not a passing check; fix or deactivate it, because it is currently telling you nothing`)}return i.push("see customInvariants[] for the offending rows"),{reason:i.join("; ")}}async function I(e,n){const r=n??c().sql;return(await r`
    SELECT id, workspace_id, harness_slug, fleet_slug, name, description,
           query_sql, severity, active, created_by
      FROM harness_shared.fleet_invariants
     WHERE workspace_id = ${e.workspaceId}
       AND fleet_slug = ${e.fleetSlug}
       ${e.includeInactive?r``:r`AND active`}
     ORDER BY name
  `).map(t=>({id:String(t.id),workspaceId:String(t.workspace_id),harnessSlug:t.harness_slug==null?null:String(t.harness_slug),fleetSlug:String(t.fleet_slug),name:String(t.name),description:t.description==null?null:String(t.description),querySql:String(t.query_sql),severity:t.severity==="critical"?"critical":"warn",active:t.active===!0,createdBy:t.created_by==null?null:String(t.created_by)}))}async function U(e,n){const r=n??c().sql;try{const{assertSingleReadStatement:s}=await y(async()=>{const{assertSingleReadStatement:a}=await import("./pg-read-query-DfBwH5mP.js");return{assertSingleReadStatement:a}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11]));s(_(e.querySql,{fleet:e.fleetSlug,workspace:e.workspaceId}))}catch(s){return{ok:!1,error:`querySql is not a single read statement: ${s instanceof Error?s.message:String(s)}`}}const t=await I({workspaceId:e.workspaceId,fleetSlug:e.fleetSlug,includeInactive:!0},r);if(t.length>=10&&!t.some(s=>s.name===e.name))return{ok:!1,error:`fleet already has ${t.length} invariant(s) (cap 10) — these run on every brief, so remove one before adding another`};const i=(0,f.randomUUID)();return{ok:!0,id:(await r`
    INSERT INTO harness_shared.fleet_invariants
      (id, workspace_id, harness_slug, fleet_slug, name, description, query_sql, severity, active, created_by)
    VALUES (${i}, ${e.workspaceId}, ${e.harnessSlug??null}, ${e.fleetSlug}, ${e.name},
            ${e.description??null}, ${e.querySql}, ${e.severity??"warn"},
            ${e.active??!0}, ${e.createdBy??null})
    ON CONFLICT (workspace_id, fleet_slug, name) DO UPDATE
       SET query_sql   = EXCLUDED.query_sql,
           description = EXCLUDED.description,
           severity    = EXCLUDED.severity,
           active      = EXCLUDED.active,
           harness_slug = EXCLUDED.harness_slug,
           updated_at  = now()
    RETURNING id
  `)[0]?.id??i}}async function M(e,n){return{removed:(await(n??c().sql)`
    DELETE FROM harness_shared.fleet_invariants
     WHERE workspace_id = ${e.workspaceId}
       AND fleet_slug = ${e.fleetSlug}
       AND name = ${e.name}
    RETURNING id
  `).length>0}}async function b(e,n={}){const r=n.runQuery??g,t=e.maxRows??20,i=e.timeoutMs??3e3,s=[];for(const a of e.invariants){const u=Date.now(),d={name:a.name,severity:a.severity,...a.description?{description:a.description}:{}};try{const o=await r(_(a.querySql,{fleet:e.fleetSlug,workspace:e.workspaceId}),{maxRows:t,timeoutMs:i}),l=o.rows??[];s.push({...d,status:l.length>0?"violated":"satisfied",elapsedMs:Date.now()-u,...l.length>0?{violationCount:l.length,rows:l,...o.truncated?{truncated:!0}:{}}:{}})}catch(o){s.push({...d,status:"error",error:o instanceof Error?o.message:String(o),elapsedMs:Date.now()-u})}}return s}var f,$,q,D,C=p((()=>{f=m(w(),1),h(),E(),v(),$=20,q=3e3,D=10}));export{I as a,_ as c,C as i,S as l,L as n,U as o,b as r,M as s,q as t};
