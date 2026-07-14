import{n as e}from"./chunk-CMxvf4Kt.js";function t(e){return{id:e.id,title:e.title,description:e.description,script:e.script,authorRole:e.author_role,toolsUsed:e.tools_used??[],runCount:a(e.run_count),successCount:a(e.success_count),lastRunAt:i(e.last_run_at),status:e.status,promotedTool:e.promoted_tool,mergedInto:e.merged_into,tags:e.tags??[],hasEmbedding:e.has_embedding,createdBy:e.created_by,createdAt:r(e.created_at),updatedAt:r(e.updated_at)}}async function n(e,n={}){let r=n.staleDays??30,i=n.maxRunCount??1;return n.dryRun??!1?{swept:(await e`
      SELECT ${o(e)} FROM harness_shared.code_recipes
       WHERE status = 'active'
         AND run_count <= ${i}
         AND last_run_at IS NOT NULL
         AND last_run_at < now() - make_interval(days => ${r})
       ORDER BY last_run_at ASC NULLS LAST, run_count ASC, id`).map(t),dryRun:!0}:{swept:(await e`
    UPDATE harness_shared.code_recipes
       SET status = 'retired', updated_at = now()
     WHERE status = 'active'
       AND run_count <= ${i}
       AND last_run_at IS NOT NULL
       AND last_run_at < now() - make_interval(days => ${r})
    RETURNING ${o(e)}`).map(t),dryRun:!1}}var r,i,a,o,s=e((()=>{r=e=>typeof e==`string`?e:e.toISOString(),i=e=>e==null?null:r(e),a=e=>typeof e==`number`?e:parseInt(e,10),o=e=>e`
  id, title, description, script, author_role,
  tools_used, run_count, success_count, last_run_at, status, promoted_tool,
  merged_into, tags, (embedding IS NOT NULL) AS has_embedding,
  created_by, created_at, updated_at
`}));export{n,s as t};