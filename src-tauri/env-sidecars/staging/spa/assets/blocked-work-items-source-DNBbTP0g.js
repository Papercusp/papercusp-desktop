import{n as o}from"./chunk-ChpBd9eV.js";import{st as d,t as c}from"./src-BmBNODK0.js";import{c as m,r as l}from"./workspace-registry-Du2UbhlH.js";import{a as u,n as k}from"./external-blockers-Do8Nx6Qk.js";async function L(e){const{sql:i}=d(),r=e?.workspaceId??l(),a=e?.harness??null;return(await i`
    SELECT feature_id, title, summary, harness_slug, item_kind, taken_by, payload, updated_ts
      FROM harness_shared.work_items
     WHERE (workspace_id = ${r} OR workspace_id = 'default')
       AND (${a}::text IS NULL OR harness_slug = ${a})
       AND status = 'blocked'
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT ${e?.limit??300}
  `).map(t=>{const s=k(t.payload),n=s.length>0?s.map(_=>_.summary).join("; "):t.summary?.trim()||"marked blocked";return{feature_id:t.feature_id,title:t.title,reason:n,harness_slug:t.harness_slug,item_kind:t.item_kind,taken_by:t.taken_by,updated_ts:t.updated_ts}})}var p,f=o((()=>{c(),u(),m(),p=300}));f();export{L as readBlockedWorkItems};
