import{n as s}from"./chunk-ChpBd9eV.js";import{st as n,t as c}from"./src-BmBNODK0.js";import{c as d,r as o}from"./workspace-registry-Du2UbhlH.js";async function y(t){const{sql:e}=n();await e`
    INSERT INTO harness_shared.attention_triage (workspace_id, item_id, action, note, triaged_by)
    VALUES (${t.workspaceId??o()}, ${t.itemId}, ${t.action}, ${t.note??null}, ${t.triagedBy??null})
    ON CONFLICT (workspace_id, item_id) DO UPDATE
      SET action = EXCLUDED.action,
          note = EXCLUDED.note,
          triaged_by = EXCLUDED.triaged_by,
          triaged_at = now()
  `}async function _(t){const{sql:e}=n(),r=await e`
    SELECT item_id, action, note, triaged_by, triaged_at
      FROM harness_shared.attention_triage
     WHERE workspace_id = ${t??o()}
  `,i=new Map;for(const a of r)i.set(a.item_id,{action:a.action,note:a.note,triagedBy:a.triaged_by,triagedAt:a.triaged_at?new Date(a.triaged_at).toISOString():null});return i}async function f(t){const e=new Set;try{const r=await _(t);for(const[i,a]of r)(a.action==="downgrade"||a.action==="resolve")&&e.add(i)}catch{}return e}var l=s((()=>{c(),d()}));export{y as i,_ as n,f as r,l as t};
