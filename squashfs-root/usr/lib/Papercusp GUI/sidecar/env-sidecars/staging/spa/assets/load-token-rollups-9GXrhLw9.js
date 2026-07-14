import{n as e}from"./chunk-CMxvf4Kt.js";async function t(e){let{workspace_id:t,harness_slug:o,runQuery:s}=e,c=e.windowMs??7*r,l=Date.now()-c,u=o?` AND harness_slug = $2`:``,d=o?[t,o,l]:[t,l],f=o?`$3`:`$2`,p=[],m=!1;try{p=(await s(`SELECT COALESCE(NULLIF(turn_trigger, ''), 'unattributed') AS trigger,
              COALESCE(SUM(${i}), 0)                    AS tokens,
              COALESCE(SUM(cost_usd), 0)                          AS cost_usd,
              COUNT(*)                                            AS runs
         FROM harness_shared.agent_usage_samples
        WHERE workspace_id = $1${u} AND ts >= ${f}
        GROUP BY 1
        ORDER BY cost_usd DESC`,d)).map(e=>({trigger:e.trigger??`unattributed`,tokens:n(e.tokens),costUsd:n(e.cost_usd),runs:n(e.runs)})),m=p.some(e=>e.trigger!==`unattributed`)}catch{p=[],m=!1}let h=[];try{h=(await s(`SELECT ${a}             AS role_class,
              COALESCE(SUM(${i}), 0)    AS tokens,
              COALESCE(SUM(cost_usd), 0)          AS cost_usd,
              COUNT(*)                            AS runs
         FROM harness_shared.agent_usage_samples
        WHERE workspace_id = $1${u} AND ts >= ${f}
        GROUP BY 1
        ORDER BY cost_usd DESC`,d)).map(e=>({roleClass:e.role_class,tokens:n(e.tokens),costUsd:n(e.cost_usd),runs:n(e.runs)}))}catch{h=[]}return{windowMs:c,byTrigger:p,triggerAttributionAvailable:m,byRoleClass:h}}var n,r,i,a;e((()=>{n=e=>{if(e==null)return 0;let t=typeof e==`string`?Number.parseFloat(e):Number(e);return Number.isFinite(t)?t:0},r=1440*60*1e3,i=`COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
                     + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)`,a=`CASE WHEN role = 'interactive' THEN 'interactive' ELSE 'fleet' END`}))();export{t as loadCoordTokenBreakdown};