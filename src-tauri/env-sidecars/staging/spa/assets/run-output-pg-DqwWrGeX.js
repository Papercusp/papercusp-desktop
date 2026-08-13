import{n as _}from"./chunk-ChpBd9eV.js";function d(e){return e.length<=o?e:e.slice(0,o)+`

... [truncated: original ${e.length} chars, kept ${o}]
`}async function u(e,r){await e.pg`
    INSERT INTO harness_shared.harness_run_output
      (workspace_id, harness_slug, run_id, role,
       prompt_body, jsonl_body, out_body, err_body,
       exit_code, duration_ms, started_at, ended_at)
    VALUES (
      ${e.workspaceId}, ${e.harnessSlug}, ${r.runId}, ${r.role},
      ${d(r.promptBody)}, ${d(r.jsonlBody)},
      ${d(r.outBody)}, ${d(r.errBody)},
      ${r.exitCode}, ${r.durationMs}, ${r.startedAt}, ${r.endedAt}
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
  `}async function i(e,r){const n=await e.pg`
    SELECT run_id, role, prompt_body, jsonl_body, out_body, err_body,
           exit_code, duration_ms, started_at, ended_at
      FROM harness_shared.harness_run_output
     WHERE workspace_id = ${e.workspaceId}
       AND harness_slug = ${e.harnessSlug}
       AND run_id       = ${r}
     LIMIT 1
  `;if(n.length===0)return null;const t=n[0];return{runId:t.run_id,role:t.role,promptBody:t.prompt_body??"",jsonlBody:t.jsonl_body,outBody:t.out_body,errBody:t.err_body,exitCode:t.exit_code??0,durationMs:t.duration_ms??0,startedAt:typeof t.started_at=="bigint"?Number(t.started_at):t.started_at,endedAt:typeof t.ended_at=="bigint"?Number(t.ended_at):t.ended_at}}var o,s=_((()=>{o=10*1024*1024}));s();export{i as readRunOutputPg,u as recordRunOutputPg};
