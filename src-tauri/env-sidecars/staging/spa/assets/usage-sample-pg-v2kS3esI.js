import{n as a}from"./chunk-ChpBd9eV.js";import{n as d,t as p}from"./src-DIpFKetJ.js";function _(s){return s==="claude-code"||s==="anthropic-direct"?"anthropic":s==="codex"?"openai":"unknown"}function m(s,o){if(s==="omp")return"self";const e=o.toLowerCase();return/opus/.test(e)?"opus":/sonnet/.test(e)?"sonnet":/haiku/.test(e)?"haiku":"default"}async function g(s,o){const{usage:e}=o;if(e.inputTokens===void 0&&e.outputTokens===void 0&&e.costUsd===void 0)return;const i=_(o.backend),l=m(o.backend,o.model),u=e.model??o.model,t=n=>typeof n=="number"&&Number.isFinite(n)?n:null;let r=t(e.costUsd),c=r!==null?"provider":null;if(r===null&&u){const n=p(u,e);n.priced&&(r=n.usd,c="estimated")}await s.pg`
    INSERT INTO harness_shared.agent_usage_samples
      (workspace_id, ts, bucket_key, provider, model_class, source,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd,
       model, cost_source, harness_slug, run_id, role, turn_count, session_id, tool_name, turn_trigger, account_id)
    VALUES (
      ${s.workspaceId}, ${Date.now()}, ${`${i}:${l}`}, ${i}, ${l}, ${"jsonl"},
      ${t(e.inputTokens)}, ${t(e.outputTokens)}, ${t(e.cacheReadTokens)}, ${t(e.cacheCreationTokens)}, ${r},
      ${u||null}, ${c}, ${o.harnessSlug??null}, ${o.runId??null}, ${o.role??null}, ${t(e.turns)}, ${o.sessionId??null}, ${o.toolName??null}, ${o.turnTrigger??null}, ${o.accountId??null}
    )
  `}var $=a((()=>{d()}));$();export{g as recordUsageSamplePg};
