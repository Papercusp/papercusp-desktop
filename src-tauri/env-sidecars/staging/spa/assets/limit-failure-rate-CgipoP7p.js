import{n as e}from"./chunk-CMxvf4Kt.js";function t(e){let t=[...e].sort((e,t)=>t.errs-e.errs||e.toolName.localeCompare(t.toolName));return{totalErrs:t.reduce((e,t)=>e+t.errs,0),byTool:t}}async function n(e,n={}){return t((await e(i,[n.sinceDays??14])).map(e=>({toolName:e.tool_name,errs:Number(e.errs)||0,lastSeen:e.last_seen,sample:e.sample})))}function r(e){let t=e.totalErrs<10?`healthy`:e.totalErrs<100?`degraded`:`broken`,n=e.byTool[0],r=n?` (worst: ${n.toolName} ×${n.errs})`:``;return{rating:t,evidence:`${e.totalErrs} tool-arg limit-rejection failures in window across ${e.byTool.length} tool(s)${r}.`}}var i,a,o;e((()=>{i=`
SELECT tool_name, count(*) AS errs, max(invoked_at) AS last_seen,
       (array_agg(error_message ORDER BY invoked_at DESC))[1] AS sample
FROM harness_shared.tool_invocations
WHERE status <> 'ok' AND invoked_at > now() - (($1)::int || ' days')::interval
  AND (error_message ILIKE '%must contain at most%' OR error_message ILIKE '%Too big%'
       OR error_message ILIKE '%expected string to have <=%' OR error_code ILIKE '%too_big%')
GROUP BY tool_name ORDER BY errs DESC
`,a=10,o=100}))();export{o as LIMIT_FAILURE_DEGRADED_BELOW,a as LIMIT_FAILURE_HEALTHY_BELOW,i as LIMIT_FAILURE_RATE_SQL,r as gradeLimitFailureRate,n as readLimitFailureRate,t as rollupLimitFailures};