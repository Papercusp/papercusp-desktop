import{n as c}from"./chunk-ChpBd9eV.js";function p(e){return{id:e.id,workspaceId:e.workspace_id,harnessSlug:e.harness_slug,name:e.name,body:e.body,description:e.description,argHint:e.arg_hint,createdAt:i(e.created_at),updatedAt:i(e.updated_at),parentId:e.parent_id,position:e.position,title:e.title,collapsed:e.collapsed,pinned:e.pinned,usageCount:e.usage_count,lastUsedAt:d(e.last_used_at),archivedAt:d(e.archived_at),completedAt:d(e.completed_at)}}async function E(e,a,s){return(s.kind==="harness"?await e`
          SELECT * FROM harness_shared.saved_prompts
           WHERE workspace_id = ${a} AND harness_slug = ${s.slug}
           ORDER BY name`:await e`
          SELECT * FROM harness_shared.saved_prompts
           WHERE workspace_id = ${a} AND harness_slug IS NULL
           ORDER BY name`).map(p)}async function u(e,a){const s=a.scope.kind==="harness"?a.scope.slug:null;return p((await e`
    INSERT INTO harness_shared.saved_prompts
      (workspace_id, harness_slug, name, body, description, arg_hint, updated_at)
    VALUES (
      ${a.workspaceId}, ${s}, ${a.name}, ${a.body},
      ${a.description??null}, ${a.argHint??null}, now()
    )
    ON CONFLICT (workspace_id, COALESCE(harness_slug, ''), name)
    DO UPDATE SET body = EXCLUDED.body,
                  description = EXCLUDED.description,
                  arg_hint = EXCLUDED.arg_hint,
                  updated_at = now()
    RETURNING *`)[0])}function _(e){const a=e.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-");return a.length>0?a:"prompt"}async function m(e,a){const s=a.scope.kind==="harness"?a.scope.slug:null,t=_(a.title);for(let n=0;;n+=1){const r=n===0?t:n<50?`${t}-${n+1}`:`${t}-${Math.random().toString(36).slice(2,8)}`;try{return p((await e`
        INSERT INTO harness_shared.saved_prompts
          (workspace_id, harness_slug, name, title, body, description, arg_hint,
           parent_id, position, updated_at)
        VALUES (
          ${a.workspaceId}, ${s}, ${r}, ${a.title||null}, ${a.body},
          ${a.description??null}, ${a.argHint??null},
          ${a.parentId??null}, ${a.position??null}, now()
        )
        RETURNING *`)[0])}catch(o){if(o.code!=="23505")throw o}}}async function h(e,a,s,t){const n=await e`
    UPDATE harness_shared.saved_prompts SET
      title       = COALESCE(${t.title??null}, title),
      body        = COALESCE(${t.body??null}, body),
      description = ${t.description!==void 0?t.description:e`description`},
      arg_hint    = ${t.argHint!==void 0?t.argHint:e`arg_hint`},
      collapsed   = COALESCE(${t.collapsed??null}, collapsed),
      pinned      = COALESCE(${t.pinned??null}, pinned),
      completed_at = ${t.completed===void 0?e`completed_at`:t.completed?e`COALESCE(completed_at, now())`:null},
      updated_at  = now()
    WHERE workspace_id = ${a} AND id = ${s}
    RETURNING *`;return n.length?p(n[0]):null}async function $(e,a,s){if(s.length===0)return 0;let t=0;return await e.begin(async n=>{for(const r of s){const o=await n`
        UPDATE harness_shared.saved_prompts
           SET parent_id = ${r.parentId}, position = ${r.position}, updated_at = now()
         WHERE workspace_id = ${a} AND id = ${r.id}`;t+=o.count}}),t}async function N(e,a,s){return(await e`
    WITH RECURSIVE subtree AS (
      SELECT id FROM harness_shared.saved_prompts
       WHERE workspace_id = ${a} AND id = ${s}
      UNION ALL
      SELECT c.id FROM harness_shared.saved_prompts c
        JOIN subtree s ON c.parent_id = s.id
       WHERE c.workspace_id = ${a}
    )
    UPDATE harness_shared.saved_prompts p
       SET archived_at = now(), updated_at = now()
      FROM subtree s
     WHERE p.id = s.id AND p.archived_at IS NULL
    RETURNING p.id`).map(t=>t.id)}async function g(e,a,s){return s.length===0?0:(await e`
    UPDATE harness_shared.saved_prompts
       SET archived_at = NULL, updated_at = now()
     WHERE workspace_id = ${a} AND id = ANY(${s}::uuid[])
       AND archived_at IS NOT NULL`).count}async function w(e,a,s){return(await e`
    DELETE FROM harness_shared.saved_prompts
     WHERE workspace_id = ${a} AND id = ${s}`).count>0}async function R(e,a,s){await e`
    UPDATE harness_shared.saved_prompts
       SET usage_count = usage_count + 1, last_used_at = now()
     WHERE workspace_id = ${a} AND id = ${s}`}async function A(e,a,s,t){return(s.kind==="harness"?await e`
          DELETE FROM harness_shared.saved_prompts
           WHERE workspace_id = ${a} AND harness_slug = ${s.slug} AND name = ${t}`:await e`
          DELETE FROM harness_shared.saved_prompts
           WHERE workspace_id = ${a} AND harness_slug IS NULL AND name = ${t}`).count>0}var i,d,S=c((()=>{i=e=>typeof e=="string"?e:e.toISOString(),d=e=>e===null?null:i(e)}));export{$ as a,A as c,h as d,u as f,E as i,_ as l,m as n,R as o,S as r,w as s,N as t,g as u};
