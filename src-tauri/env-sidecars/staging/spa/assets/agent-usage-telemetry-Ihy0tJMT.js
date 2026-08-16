import{n as C}from"./chunk-ChpBd9eV.js";import{st as b,t as L}from"./src-8fWtxfEz.js";import{n as v,t as y}from"./src-DIpFKetJ.js";import{c as O,r as N}from"./workspace-registry-Du2UbhlH.js";async function U(t){try{const{sql:r}=b(),l=N();let o=s(t.costUsd),u=t.costSource??(o!==null?"provider":null);if(o===null&&t.model){const e=y(t.model,t);e.priced&&(o=e.usd,u="estimated")}await r`
      INSERT INTO ${r(m)}
        (workspace_id, ts, bucket_key, provider, model_class, source,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd,
         model, cost_source, harness_slug, run_id, role,
         rl_requests_limit, rl_requests_remaining, rl_tokens_limit, rl_tokens_remaining, rl_reset_at,
         session_id, tool_name, turn_trigger, account_id)
      VALUES (
        ${l}, ${Date.now()}, ${t.bucketKey}, ${t.provider}, ${t.modelClass}, ${t.source},
        ${s(t.inputTokens)}, ${s(t.outputTokens)}, ${s(t.cacheReadTokens)}, ${s(t.cacheCreationTokens)}, ${o},
        ${t.model??null}, ${u}, ${t.harnessSlug??null}, ${t.runId??null}, ${t.role??null},
        ${s(t.rlRequestsLimit)}, ${s(t.rlRequestsRemaining)}, ${s(t.rlTokensLimit)}, ${s(t.rlTokensRemaining)}, ${s(t.rlResetAt)},
        ${t.sessionId??null}, ${t.toolName??null}, ${t.turnTrigger??null}, ${t.accountId??null}
      )
    `}catch{}}async function M(t,r,l,o,u){const e={};for(const[a,k]of Object.entries(o))e[a.toLowerCase()]=k;const c=a=>{if(a===void 0)return;const k=Number(a);return Number.isFinite(k)?k:void 0},d=e["anthropic-ratelimit-tokens-reset"]??e["anthropic-ratelimit-requests-reset"],_=d?Date.parse(d):void 0,i={bucketKey:t,provider:r,modelClass:l,source:"headers",rlRequestsLimit:c(e["anthropic-ratelimit-requests-limit"]),rlRequestsRemaining:c(e["anthropic-ratelimit-requests-remaining"]),rlTokensLimit:c(e["anthropic-ratelimit-tokens-limit"]??e["anthropic-ratelimit-input-tokens-limit"]),rlTokensRemaining:c(e["anthropic-ratelimit-tokens-remaining"]??e["anthropic-ratelimit-input-tokens-remaining"]),rlResetAt:_!==void 0&&Number.isFinite(_)?_:void 0,...u};i.rlRequestsLimit===void 0&&i.rlTokensLimit===void 0&&i.inputTokens===void 0&&i.outputTokens===void 0&&i.costUsd===void 0||await U(i)}async function F(t=3600*1e3){const{sql:r}=b(),l=N(),o=Date.now()-t,u=await r`
    WITH agg AS (
      SELECT bucket_key, provider, model_class,
             COUNT(*) AS calls,
             SUM(COALESCE(input_tokens, 0)) AS input_tokens,
             SUM(COALESCE(output_tokens, 0)) AS output_tokens,
             SUM(COALESCE(cache_read_tokens, 0)) AS cache_read_tokens,
             SUM(COALESCE(cache_creation_tokens, 0)) AS cache_creation_tokens,
             SUM(COALESCE(cost_usd, 0)) AS cost_usd
        FROM ${r(m)}
       WHERE workspace_id = ${l} AND ts >= ${o}
       GROUP BY bucket_key, provider, model_class
    ),
    latest AS (
      SELECT DISTINCT ON (bucket_key) bucket_key, rl_tokens_limit, rl_tokens_remaining, rl_reset_at
        FROM ${r(m)}
       WHERE workspace_id = ${l} AND ts >= ${o} AND rl_tokens_limit IS NOT NULL
       ORDER BY bucket_key, ts DESC
    )
    SELECT agg.*, latest.rl_tokens_limit, latest.rl_tokens_remaining, latest.rl_reset_at
      FROM agg LEFT JOIN latest USING (bucket_key)
     ORDER BY agg.bucket_key
  `;let e=0,c=0,d=0,_=0,i=0,a=0;const k=u.map(n=>{const T=Number(n.calls),$=Number(n.input_tokens??0),h=Number(n.output_tokens??0),S=Number(n.cache_read_tokens??0),p=Number(n.cache_creation_tokens??0),E=Number(n.cost_usd??0);e+=T,c+=$,d+=h,_+=S,i+=p,a+=E;const g=n.rl_tokens_limit!==null?Number(n.rl_tokens_limit):null,R=n.rl_tokens_remaining!==null?Number(n.rl_tokens_remaining):null,A=g!==null&&g>0&&R!==null?Math.max(0,Math.min(100,(1-R/g)*100)):null;return{key:n.bucket_key,provider:n.provider,modelClass:n.model_class,calls:T,inputTokens:$,outputTokens:h,cacheReadTokens:S,cacheCreationTokens:p,spendUsd:E,usagePct:A,rlResetAt:n.rl_reset_at!==null?Number(n.rl_reset_at):null}});return{windowMs:t,calls:e,inputTokens:c,outputTokens:d,cacheReadTokens:_,cacheCreationTokens:i,spendUsd:a,buckets:k}}var m,s,B=C((()=>{v(),L(),O(),m="harness_shared.agent_usage_samples",s=t=>typeof t=="number"&&Number.isFinite(t)?t:null}));export{F as i,M as n,U as r,B as t};
