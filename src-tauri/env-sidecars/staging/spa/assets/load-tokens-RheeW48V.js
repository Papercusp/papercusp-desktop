import{n as M}from"./chunk-ChpBd9eV.js";function R(t){const e=new Date(t);return`${C[e.getUTCMonth()]} ${e.getUTCDate()}`}function U(t,e=!0){return{windowMs:t,totals:{tokens:0,costUsd:0,estimatedUsd:0,runs:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0},byModel:[],byRole:[],byAccount:[],byDay:[],accountAttributionAvailable:e}}async function y(t){const{workspace_id:e,harness_slug:d,runQuery:u}=t,r=t.windowMs??7*E,_=Math.max(1,Math.min(100,t.groupLimit??20)),c=[e,d,Date.now()-r];try{const[k,i,O,L,l]=await Promise.all([u(`SELECT COUNT(*)                                                          AS runs,
                COALESCE(SUM(cost_usd), 0)                                        AS total_usd,
                COALESCE(SUM(cost_usd) FILTER (WHERE cost_source = 'estimated'), 0) AS estimated_usd,
                COALESCE(SUM(${a}), 0)                                  AS tokens,
                COALESCE(SUM(COALESCE(input_tokens, 0)), 0)                       AS input_tokens,
                COALESCE(SUM(COALESCE(output_tokens, 0)), 0)                      AS output_tokens,
                COALESCE(SUM(COALESCE(cache_read_tokens, 0)), 0)                  AS cache_read_tokens,
                COALESCE(SUM(COALESCE(cache_creation_tokens, 0)), 0)             AS cache_creation_tokens
           FROM harness_shared.agent_usage_samples
          WHERE workspace_id = $1 AND harness_slug = $2 AND ts >= $3`,c),u(`SELECT COALESCE(NULLIF(model, ''), model_class, 'unknown') AS key,
                COALESCE(SUM(${a}), 0)                     AS tokens,
                COALESCE(SUM(cost_usd), 0)                           AS cost_usd,
                COUNT(*)                                             AS runs
           FROM harness_shared.agent_usage_samples
          WHERE workspace_id = $1 AND harness_slug = $2 AND ts >= $3
          GROUP BY 1
          ORDER BY tokens DESC
          LIMIT ${_}`,c),u(`SELECT COALESCE(NULLIF(role, ''), 'unattributed') AS key,
                COALESCE(SUM(${a}), 0)            AS tokens,
                COALESCE(SUM(cost_usd), 0)                  AS cost_usd,
                COUNT(*)                                    AS runs
           FROM harness_shared.agent_usage_samples
          WHERE workspace_id = $1 AND harness_slug = $2 AND ts >= $3
          GROUP BY 1
          ORDER BY tokens DESC
          LIMIT ${_}`,c),u(`SELECT account_id AS key,
                COALESCE(SUM(${a}), 0) AS tokens,
                COALESCE(SUM(cost_usd), 0)       AS cost_usd,
                COUNT(*)                         AS runs
           FROM harness_shared.agent_usage_samples
          WHERE workspace_id = $1 AND harness_slug = $2 AND ts >= $3
            AND account_id IS NOT NULL
          GROUP BY 1
          ORDER BY tokens DESC
          LIMIT ${_}`,c),u(`SELECT (FLOOR(ts / ${E}) * ${E})::bigint AS day_start,
                COALESCE(SUM(${a}), 0)            AS tokens,
                COALESCE(SUM(cost_usd), 0)                  AS cost_usd
           FROM harness_shared.agent_usage_samples
          WHERE workspace_id = $1 AND harness_slug = $2 AND ts >= $3
          GROUP BY 1
          ORDER BY day_start ASC`,c)]),n=k[0],S=o=>({key:o.key??"unknown",tokens:s(o.tokens),costUsd:s(o.cost_usd),runs:s(o.runs)}),p=o=>{const A=s(o.day_start);return{startMs:A,label:R(A),tokens:s(o.tokens),costUsd:s(o.cost_usd)}};return{windowMs:r,totals:{tokens:s(n?.tokens),costUsd:s(n?.total_usd),estimatedUsd:s(n?.estimated_usd),runs:s(n?.runs),inputTokens:s(n?.input_tokens),outputTokens:s(n?.output_tokens),cacheReadTokens:s(n?.cache_read_tokens),cacheCreationTokens:s(n?.cache_creation_tokens)},byModel:i.map(S),byRole:O.map(S),byAccount:L.map(S),byDay:l.map(p),accountAttributionAvailable:!0}}catch{return U(r,!1)}}var s,a,E,C,h=M((()=>{s=t=>{if(t==null)return 0;const e=typeof t=="string"?Number.parseFloat(t):Number(t);return Number.isFinite(e)?e:0},a=`COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
                     + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)`,E=1440*60*1e3,C=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]}));h();export{y as loadHarnessTokens};
