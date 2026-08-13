import{n as o}from"./chunk-ChpBd9eV.js";import{st as n,t as i}from"./src-BmBNODK0.js";async function h(t){try{const{sql:a}=n(),e=await a`
      SELECT path FROM ${a(s)} WHERE workspace_id = ${t}
    `;return new Set(e.map(r=>r.path))}catch{return new Set}}async function u(t){const{sql:a}=n();return(await a`
    SELECT path, reason, created_by, created_at
      FROM ${a(s)}
     WHERE workspace_id = ${t}
     ORDER BY created_at DESC
  `).map(e=>({path:e.path,reason:e.reason,createdBy:e.created_by,createdAt:e.created_at}))}async function f(t){const{sql:a}=n();await a`
    INSERT INTO ${a(s)} (workspace_id, path, reason, created_by)
    VALUES (${t.workspaceId}, ${t.path}, ${t.reason}, ${t.createdBy})
    ON CONFLICT (workspace_id, path) DO UPDATE
      SET reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now()
  `}async function m(t,a){const{sql:e}=n();await e`DELETE FROM ${e(s)} WHERE workspace_id = ${t} AND path = ${a}`}function d(t,a){if(t.size===0)return!1;if(t.has(a))return!0;for(const e of t){const r=e.endsWith("/**")?e.slice(0,-2):e.endsWith("/")?e:null;if(r&&a.startsWith(r))return!0}return!1}function w(t,a){if(a.size===0)return{blocking:[...t],exempted:[]};const e=[],r=[];for(const c of t)(d(a,c.path)?r:e).push(c);return{blocking:e,exempted:r}}var s,l=o((()=>{i(),s="harness_shared.secrets_guard_path_exemptions"}));export{h as a,u as i,l as n,w as o,d as r,m as s,f as t};
