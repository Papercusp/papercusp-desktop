import{n as w}from"./chunk-ChpBd9eV.js";async function O(s){try{return(await s(`SELECT model_id, input_per_mtok, output_per_mtok, cache_read_per_mtok,
              cache_creation_per_mtok, effective_date::text AS effective_date, source
         FROM harness_shared.model_pricing
        ORDER BY input_per_mtok DESC, model_id ASC`,[])).map(t=>({modelId:t.model_id,inputPerMtok:e(t.input_per_mtok),outputPerMtok:e(t.output_per_mtok),cacheReadPerMtok:e(t.cache_read_per_mtok),cacheCreationPerMtok:e(t.cache_creation_per_mtok),effectiveDate:t.effective_date,source:t.source}))}catch{return[]}}async function R(s){const{workspace_id:t,harness_slug:r,runQuery:c}=s,l=s.windowMs??7*k,d=Date.now()-l,_=r?" AND harness_slug = $2":"",i=r?[t,r,d]:[t,d],E=r?"$3":"$2";let n=[],u=!1;try{n=(await c(`SELECT COALESCE(NULLIF(turn_trigger, ''), 'unattributed') AS trigger,
              COALESCE(SUM(${S}), 0)                    AS tokens,
              COALESCE(SUM(cost_usd), 0)                          AS cost_usd,
              COUNT(*)                                            AS runs
         FROM harness_shared.agent_usage_samples
        WHERE workspace_id = $1${_} AND ts >= ${E}
        GROUP BY 1
        ORDER BY cost_usd DESC`,i)).map(o=>({trigger:o.trigger??"unattributed",tokens:e(o.tokens),costUsd:e(o.cost_usd),runs:e(o.runs)})),u=n.some(o=>o.trigger!=="unattributed")}catch{n=[],u=!1}let a=[];try{a=(await c(`SELECT ${m}             AS role_class,
              COALESCE(SUM(${S}), 0)    AS tokens,
              COALESCE(SUM(cost_usd), 0)          AS cost_usd,
              COUNT(*)                            AS runs
         FROM harness_shared.agent_usage_samples
        WHERE workspace_id = $1${_} AND ts >= ${E}
        GROUP BY 1
        ORDER BY cost_usd DESC`,i)).map(o=>({roleClass:o.role_class,tokens:e(o.tokens),costUsd:e(o.cost_usd),runs:e(o.runs)}))}catch{a=[]}return{windowMs:l,byTrigger:n,triggerAttributionAvailable:u,byRoleClass:a}}async function h(s){const{workspace_id:t,runQuery:r}=s,c=s.windowMs??k,l=new Date(Date.now()-c).toISOString();try{const[d,_]=await Promise.all([r(`SELECT tool_name,
                COUNT(*)               AS calls,
                COUNT(DISTINCT spawn_id) AS distinct_callers
           FROM harness_shared.tool_invocations
          WHERE workspace_id = $1 AND invoked_at >= $2 AND tool_name LIKE 'coord:%'
          GROUP BY tool_name
          ORDER BY calls DESC
          LIMIT 25`,[t,l]),r(`SELECT COUNT(*) AS total_rows,
                COUNT(*) FILTER (WHERE tool_name = ANY($3)) AS poll_rows
           FROM harness_shared.tool_invocations
          WHERE workspace_id = $1 AND invoked_at >= $2`,[t,l,C])]),i=d.map(a=>({toolName:a.tool_name,calls:e(a.calls),distinctCallers:e(a.distinct_callers)})),E=i.filter(a=>C.includes(a.toolName)).reduce((a,o)=>a+o.calls,0),n=e(_[0]?.total_rows),u=e(_[0]?.poll_rows);return{windowMs:c,tools:i,wakePollCalls:E,wakePollRowSharePct:n>0?Math.round(1e3*u/n)/10:0}}catch{return{windowMs:c,tools:[],wakePollCalls:0,wakePollRowSharePct:0}}}var e,k,S,m,C,p=w((()=>{e=s=>{if(s==null)return 0;const t=typeof s=="string"?Number.parseFloat(s):Number(s);return Number.isFinite(t)?t:0},k=1440*60*1e3,S=`COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
                     + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)`,m="CASE WHEN role = 'interactive' THEN 'interactive' ELSE 'fleet' END",C=["coord:wake-queue","coord:wake-mode"]}));p();export{h as loadCoordPollVolume,R as loadCoordTokenBreakdown,O as loadModelPricingBook};
