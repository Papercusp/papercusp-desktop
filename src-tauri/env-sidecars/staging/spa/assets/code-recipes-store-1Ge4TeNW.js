import{n as L}from"./chunk-ChpBd9eV.js";function p(e){return{id:e.id,title:e.title,description:e.description,potSlug:e.pot_slug,authorRole:e.author_role,toolsUsed:e.tools_used??[],runCount:i(e.run_count),successCount:i(e.success_count),lastRunAt:g(e.last_run_at),status:e.status,promotedTool:e.promoted_tool,mergedInto:e.merged_into,tags:e.tags??[],hasEmbedding:e.has_embedding,createdBy:e.created_by,createdAt:d(e.created_at),updatedAt:d(e.updated_at)}}function o(e){return{...p(e),script:e.script}}async function S(e,t){const s=t.embedding&&t.embedding.length>0?`[${t.embedding.join(",")}]`:null;return o((await e`
    INSERT INTO harness_shared.code_recipes
      (id, title, description, script, pot_slug, author_role,
       tools_used, tags, embedding, created_by, updated_at)
    VALUES (
      ${t.id}, ${t.title},
      ${t.description}, ${t.script}, ${t.potSlug}, ${t.authorRole??null},
      ${t.toolsUsed??[]}, ${t.tags??[]},
      ${s}::vector, ${t.createdBy??null}, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      title       = EXCLUDED.title,
      description = EXCLUDED.description,
      script      = EXCLUDED.script,
      -- first-write pot attribution: a later update never steals the recipe from
      -- its authoring pot; a legacy NULL adopts the updater's pot (organic backfill)
      pot_slug    = COALESCE(harness_shared.code_recipes.pot_slug, EXCLUDED.pot_slug),
      author_role = EXCLUDED.author_role,
      tools_used  = EXCLUDED.tools_used,
      tags        = EXCLUDED.tags,
      -- keep the existing embedding when this write carries none (no embedder)
      embedding   = COALESCE(EXCLUDED.embedding, harness_shared.code_recipes.embedding),
      updated_at  = now()
    RETURNING ${n(e)}`)[0])}async function w(e,t){const s=t.success??!0;await e.begin(async a=>{await a`
      INSERT INTO harness_shared.code_recipe_runs
        (recipe_id, workspace_id, pot_slug, agent_owner, agent_role, success, reused)
      VALUES (
        ${t.recipeId}, ${t.workspaceId}, ${t.potSlug},
        ${t.agentOwner??null}, ${t.agentRole??null},
        ${s}, ${t.reused??!1}
      )`,await a`
      UPDATE harness_shared.code_recipes
         SET run_count     = run_count + 1,
             success_count = success_count + ${s?1:0},
             last_run_at   = now()
       WHERE id = ${t.recipeId}`})}async function D(e,t){const{survivorId:s}=t,a=[...new Set(t.duplicateIds)].filter(r=>r!==s);return await e.begin(async r=>{const E=await r`
      SELECT ${n(r)} FROM harness_shared.code_recipes
       WHERE id = ${s}
       FOR UPDATE`;if(!E[0])throw new Error(`mergeRecipes: survivor ${s} not found`);if(a.length===0)return{survivor:o(E[0]),mergedIds:[]};const u=await r`
      UPDATE harness_shared.code_recipes
         SET status      = 'merged',
             merged_into = ${s},
             updated_at  = now()
       WHERE id = ANY(${a})
         AND id <> ${s}
         AND NOT (status = 'merged' AND merged_into = ${s})
       RETURNING id, run_count, success_count`,m=u.map(c=>c.id);return{survivor:o((await r`
      UPDATE harness_shared.code_recipes
         SET run_count     = run_count + ${u.reduce((c,_)=>c+i(_.run_count),0)},
             success_count = success_count + ${u.reduce((c,_)=>c+i(_.success_count),0)},
             updated_at    = now()
       WHERE id = ${s}
      RETURNING ${n(r)}`)[0]),mergedIds:m}})}async function I(e,t={}){const s=t.staleDays??30,a=t.maxRunCount??1;return t.dryRun??!1?{swept:(await e`
      SELECT ${n(e)} FROM harness_shared.code_recipes
       WHERE status = 'active'
         AND run_count <= ${a}
         AND last_run_at IS NOT NULL
         AND last_run_at < now() - make_interval(days => ${s})
       ORDER BY last_run_at ASC NULLS LAST, run_count ASC, id`).map(o),dryRun:!0}:{swept:(await e`
    UPDATE harness_shared.code_recipes
       SET status = 'retired', updated_at = now()
     WHERE status = 'active'
       AND run_count <= ${a}
       AND last_run_at IS NOT NULL
       AND last_run_at < now() - make_interval(days => ${s})
    RETURNING ${n(e)}`).map(o),dryRun:!1}}async function N(e,t){const s=await e`
    SELECT ${n(e)} FROM harness_shared.code_recipes
     WHERE id = ${t}
     LIMIT 1`;return s[0]?o(s[0]):null}function T(e){return e==null||!Number.isFinite(e)?h:Math.max(1,Math.min(R,Math.floor(e)))}function A(e){return(e.toolsUsed?.length??0)<=1||/^recipe:\s/i.test(e.title)}async function C(e,t={}){const s=T(t.limit),a=t.includeTrivial?e`TRUE`:e`array_length(tools_used, 1) >= 2 AND title NOT ILIKE 'recipe: %'`;return(await e`
    SELECT ${l(e)} FROM harness_shared.code_recipes
     WHERE ${a}
     ORDER BY last_run_at DESC NULLS LAST, run_count DESC, id
     LIMIT ${s}`).map(p)}async function U(e){return(await e`
    SELECT count(*)::int AS n FROM harness_shared.code_recipes`)[0]?.n??0}var d,g,i,l,n,h,R,f=L((()=>{d=e=>typeof e=="string"?e:e.toISOString(),g=e=>e==null?null:d(e),i=e=>typeof e=="number"?e:parseInt(e,10),l=e=>e`
  id, title, description, pot_slug, author_role,
  tools_used, run_count, success_count, last_run_at, status, promoted_tool,
  merged_into, tags, (embedding IS NOT NULL) AS has_embedding,
  created_by, created_at, updated_at
`,n=e=>e`
  script, ${l(e)}
`,h=1e3,R=2e3}));export{A as a,w as c,f as i,I as l,U as n,C as o,N as r,D as s,h as t,S as u};
