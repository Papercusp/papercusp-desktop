import{n as e}from"./chunk-CMxvf4Kt.js";function t(e){return e.length<=i?e:e.slice(0,i)+`\n\n... [truncated: original ${e.length} chars, kept ${i}]\n`}async function n(e,n){await e.pg`
    INSERT INTO harness_shared.harness_run_output
      (workspace_id, harness_slug, run_id, role,
       prompt_body, jsonl_body, out_body, err_body,
       exit_code, duration_ms, started_at, ended_at)
    VALUES (
      ${e.workspaceId}, ${e.harnessSlug}, ${n.runId}, ${n.role},
      ${t(n.promptBody)}, ${t(n.jsonlBody)},
      ${t(n.outBody)}, ${t(n.errBody)},
      ${n.exitCode}, ${n.durationMs}, ${n.startedAt}, ${n.endedAt}
    )
    ON CONFLICT (workspace_id, harness_slug, run_id) DO UPDATE SET
      role        = EXCLUDED.role,
      prompt_body = EXCLUDED.prompt_body,
      jsonl_body  = EXCLUDED.jsonl_body,
      out_body    = EXCLUDED.out_body,
      err_body    = EXCLUDED.err_body,
      exit_code   = EXCLUDED.exit_code,
      duration_ms = EXCLUDED.duration_ms,
      ended_at    = EXCLUDED.ended_at
  `}async function r(e,t){let n=await e.pg`
    SELECT run_id, role, prompt_body, jsonl_body, out_body, err_body,
           exit_code, duration_ms, started_at, ended_at
      FROM harness_shared.harness_run_output
     WHERE workspace_id = ${e.workspaceId}
       AND harness_slug = ${e.harnessSlug}
       AND run_id       = ${t}
     LIMIT 1
  `;if(n.length===0)return null;let r=n[0];return{runId:r.run_id,role:r.role,promptBody:r.prompt_body??``,jsonlBody:r.jsonl_body,outBody:r.out_body,errBody:r.err_body,exitCode:r.exit_code??0,durationMs:r.duration_ms??0,startedAt:typeof r.started_at==`bigint`?Number(r.started_at):r.started_at,endedAt:typeof r.ended_at==`bigint`?Number(r.ended_at):r.ended_at}}var i;e((()=>{i=10*1024*1024}))();export{r as readRunOutputPg,n as recordRunOutputPg};