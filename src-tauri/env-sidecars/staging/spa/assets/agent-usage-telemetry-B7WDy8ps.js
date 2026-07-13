import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CRqYcphb.js";import{n as r,t as i}from"./src-B9A-E1GX.js";import{n as a,s as o}from"./workspace-registry-Bu1Yy540.js";async function s(e){try{let{sql:n}=t(),r=a(),o=d(e.costUsd),s=e.costSource??(o===null?null:`provider`);if(o===null&&e.model){let t=i(e.model,e);t.priced&&(o=t.usd,s=`estimated`)}await n`
      INSERT INTO ${n(u)}
        (workspace_id, ts, bucket_key, provider, model_class, source,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd,
         model, cost_source, harness_slug, run_id, role,
         rl_requests_limit, rl_requests_remaining, rl_tokens_limit, rl_tokens_remaining, rl_reset_at,
         session_id, plan_id, tool_name, turn_trigger, account_id)
      VALUES (
        ${r}, ${Date.now()}, ${e.bucketKey}, ${e.provider}, ${e.modelClass}, ${e.source},
        ${d(e.inputTokens)}, ${d(e.outputTokens)}, ${d(e.cacheReadTokens)}, ${d(e.cacheCreationTokens)}, ${o},
        ${e.model??null}, ${s}, ${e.harnessSlug??null}, ${e.runId??null}, ${e.role??null},
        ${d(e.rlRequestsLimit)}, ${d(e.rlRequestsRemaining)}, ${d(e.rlTokensLimit)}, ${d(e.rlTokensRemaining)}, ${d(e.rlResetAt)},
        ${e.sessionId??null}, ${e.planId??null}, ${e.toolName??null}, ${e.turnTrigger??null}, ${e.accountId??null}
      )
    `}catch{}}async function c(e,t,n,r,i){let a={};for(let[e,t]of Object.entries(r))a[e.toLowerCase()]=t;let o=e=>{if(e===void 0)return;let t=Number(e);return Number.isFinite(t)?t:void 0},c=a[`anthropic-ratelimit-tokens-reset`]??a[`anthropic-ratelimit-requests-reset`],l=c?Date.parse(c):void 0,u={bucketKey:e,provider:t,modelClass:n,source:`headers`,rlRequestsLimit:o(a[`anthropic-ratelimit-requests-limit`]),rlRequestsRemaining:o(a[`anthropic-ratelimit-requests-remaining`]),rlTokensLimit:o(a[`anthropic-ratelimit-tokens-limit`]??a[`anthropic-ratelimit-input-tokens-limit`]),rlTokensRemaining:o(a[`anthropic-ratelimit-tokens-remaining`]??a[`anthropic-ratelimit-input-tokens-remaining`]),rlResetAt:l!==void 0&&Number.isFinite(l)?l:void 0,...i};u.rlRequestsLimit===void 0&&u.rlTokensLimit===void 0&&u.inputTokens===void 0&&u.outputTokens===void 0&&u.costUsd===void 0||await s(u)}async function l(e=3600*1e3){let{sql:n}=t(),r=a(),i=Date.now()-e,o=await n`
    WITH agg AS (
      SELECT bucket_key, provider, model_class,
             COUNT(*) AS calls,
             SUM(COALESCE(input_tokens, 0)) AS input_tokens,
             SUM(COALESCE(output_tokens, 0)) AS output_tokens,
             SUM(COALESCE(cache_read_tokens, 0)) AS cache_read_tokens,
             SUM(COALESCE(cache_creation_tokens, 0)) AS cache_creation_tokens,
             SUM(COALESCE(cost_usd, 0)) AS cost_usd
        FROM ${n(u)}
       WHERE workspace_id = ${r} AND ts >= ${i}
       GROUP BY bucket_key, provider, model_class
    ),
    latest AS (
      SELECT DISTINCT ON (bucket_key) bucket_key, rl_tokens_limit, rl_tokens_remaining, rl_reset_at
        FROM ${n(u)}
       WHERE workspace_id = ${r} AND ts >= ${i} AND rl_tokens_limit IS NOT NULL
       ORDER BY bucket_key, ts DESC
    )
    SELECT agg.*, latest.rl_tokens_limit, latest.rl_tokens_remaining, latest.rl_reset_at
      FROM agg LEFT JOIN latest USING (bucket_key)
     ORDER BY agg.bucket_key
  `,s=0,c=0,l=0,d=0,f=0,p=0,m=o.map(e=>{let t=Number(e.calls),n=Number(e.input_tokens??0),r=Number(e.output_tokens??0),i=Number(e.cache_read_tokens??0),a=Number(e.cache_creation_tokens??0),o=Number(e.cost_usd??0);s+=t,c+=n,l+=r,d+=i,f+=a,p+=o;let u=e.rl_tokens_limit===null?null:Number(e.rl_tokens_limit),m=e.rl_tokens_remaining===null?null:Number(e.rl_tokens_remaining),h=u!==null&&u>0&&m!==null?Math.max(0,Math.min(100,(1-m/u)*100)):null;return{key:e.bucket_key,provider:e.provider,modelClass:e.model_class,calls:t,inputTokens:n,outputTokens:r,cacheReadTokens:i,cacheCreationTokens:a,spendUsd:o,usagePct:h,rlResetAt:e.rl_reset_at===null?null:Number(e.rl_reset_at)}});return{windowMs:e,calls:s,inputTokens:c,outputTokens:l,cacheReadTokens:d,cacheCreationTokens:f,spendUsd:p,buckets:m}}var u,d,f=e((()=>{r(),n(),o(),u=`harness_shared.agent_usage_samples`,d=e=>typeof e==`number`&&Number.isFinite(e)?e:null}));export{c as n,l as r,f as t};