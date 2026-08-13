import{n}from"./chunk-ChpBd9eV.js";import{st as a,t as p}from"./src-BmBNODK0.js";async function m(r,s,e){const{sql:t}=a(),o=await t`
    SELECT prompt_md FROM harness_shared.harness_prompt_overrides
     WHERE workspace_id = ${r} AND harness_slug = ${s} AND role = ${e}
     LIMIT 1
  `;return o.length>0?o[0].prompt_md:null}async function l(r,s,e,t){const{sql:o}=a();await o`
    INSERT INTO harness_shared.harness_prompt_overrides (workspace_id, harness_slug, role, prompt_md, updated_at)
    VALUES (${r}, ${s}, ${e}, ${t}, ${Date.now()})
    ON CONFLICT (workspace_id, harness_slug, role) DO UPDATE
      SET prompt_md = EXCLUDED.prompt_md, updated_at = EXCLUDED.updated_at
  `}async function E(r,s,e){const{sql:t}=a();return(await t`
    DELETE FROM harness_shared.harness_prompt_overrides
     WHERE workspace_id = ${r} AND harness_slug = ${s} AND role = ${e}
     RETURNING role
  `).length>0}async function c(r,s){const{sql:e}=a();return(await e`
    DELETE FROM harness_shared.harness_prompt_overrides
     WHERE workspace_id = ${r} AND harness_slug = ${s}
     RETURNING role
  `).length}async function h(r,s){const{sql:e}=a();return(await e`
    SELECT role, prompt_md, updated_at FROM harness_shared.harness_prompt_overrides
     WHERE workspace_id = ${r} AND harness_slug = ${s}
     ORDER BY role
  `).map(t=>({role:t.role,promptMd:t.prompt_md,updatedAt:Number(t.updated_at)}))}var u=n((()=>{p()}));export{h as a,u as i,E as n,l as o,m as r,c as t};
