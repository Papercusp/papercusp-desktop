import{n as e}from"./chunk-CMxvf4Kt.js";import{t}from"./src-C4Fj_oRp.js";import{q as n,t as r}from"./src-DTtGQmae.js";import{n as i,s as a}from"./workspace-registry-C3lTKlnO.js";import{t as o}from"./event-log-DlTwD7ps.js";function s(e){return e??n().sql}function c(e){let t=e?.trim();return t&&t!==`*`&&t!=="default"?t:void 0}async function l(e,t={},n){if(e.length===0)return[];let r=s(n),a=t.workspaceId??i(),o=t.limitPerSelector??12,c=[];for(let t of e){let e=t.scope===`workspace`?``:(t.scopeRef??``).trim();if(t.scope!==`workspace`&&!e)continue;let n=await r`
      SELECT scope, scope_ref, key, body, source_ref, created_by,
             updated_at::text, expires_at::text
        FROM harness_shared.agent_facts
       WHERE workspace_id = ${a} AND scope = ${t.scope}
         AND coalesce(scope_ref,'') = ${e}
         AND retracted_at IS NULL AND expires_at > now()
       ORDER BY updated_at DESC
       LIMIT ${o}`;c.push(...n.map(p))}return c}async function u(e){return(await s(e)`
    DELETE FROM harness_shared.agent_facts
     WHERE expires_at < now() - interval '30 days'
        OR retracted_at < now() - interval '30 days'
    RETURNING key`).length}function d(e){return e.outcome===`won`||(e.grade??0)>=4}function f(e,t=Date.now()){return e.length===0?``:`### Standing facts (deterministic — assert via facts:assert, retract when stale)\n${e.map(e=>{let n=e.scopeRef?`${e.scope}:${e.scopeRef}`:e.scope,r=Math.max(0,Math.round((Date.parse(e.expiresAt)-t)/864e5)),i=e.sourceRef?`, src ${e.sourceRef}`:``;return`• [${n}] ${e.body} (expires ~${r}d${i})`}).join(`
`)}`}function p(e){return{scope:e.scope,scopeRef:e.scope_ref,key:e.key,body:e.body,sourceRef:e.source_ref,createdBy:e.created_by,updatedAt:e.updated_at,expiresAt:e.expires_at}}var m=e((()=>{r(),o(),t(),a()}));export{c as a,f as i,l as n,u as o,m as r,d as t};