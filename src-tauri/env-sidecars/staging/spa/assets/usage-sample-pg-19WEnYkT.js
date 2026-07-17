import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./src--IjyQZQp.js";function r(e){return e===`claude-code`||e===`anthropic-direct`?`anthropic`:e===`codex`?`openai`:`unknown`}function i(e,t){if(e===`omp`)return`self`;let n=t.toLowerCase();return/opus/.test(n)?`opus`:/sonnet/.test(n)?`sonnet`:/haiku/.test(n)?`haiku`:`default`}async function a(e,t){let{usage:a}=t;if(a.inputTokens===void 0&&a.outputTokens===void 0&&a.costUsd===void 0)return;let o=r(t.backend),s=i(t.backend,t.model),c=a.model??t.model,l=e=>typeof e==`number`&&Number.isFinite(e)?e:null,u=l(a.costUsd),d=u===null?null:`provider`;if(u===null&&c){let e=n(c,a);e.priced&&(u=e.usd,d=`estimated`)}await e.pg`
    INSERT INTO harness_shared.agent_usage_samples
      (workspace_id, ts, bucket_key, provider, model_class, source,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd,
       model, cost_source, harness_slug, run_id, role, turn_count, session_id, plan_id, tool_name, turn_trigger, account_id)
    VALUES (
      ${e.workspaceId}, ${Date.now()}, ${`${o}:${s}`}, ${o}, ${s}, ${`jsonl`},
      ${l(a.inputTokens)}, ${l(a.outputTokens)}, ${l(a.cacheReadTokens)}, ${l(a.cacheCreationTokens)}, ${u},
      ${c||null}, ${d}, ${t.harnessSlug??null}, ${t.runId??null}, ${t.role??null}, ${l(a.turns)}, ${t.sessionId??null}, ${t.planId??null}, ${t.toolName??null}, ${t.turnTrigger??null}, ${t.accountId??null}
    )
  `}e((()=>{t()}))();export{a as recordUsageSamplePg};