import{n as c}from"./chunk-ChpBd9eV.js";function _(e,t=15){const a=e.reduce((o,r)=>o+r.calls,0);return{windowMin:t,failing:e.filter(o=>o.calls>=5&&o.fails>0).map(o=>({...o,failPct:Math.round(o.fails/o.calls*100)})).filter(o=>o.failPct>=30).sort((o,r)=>r.failPct-o.failPct||r.fails-o.fails||o.toolName.localeCompare(r.toolName)),toolsSeen:e.length,totalCalls:a}}async function N(e,t){const a=t.windowMin??15;return _((await e(l,[t.workspaceId,a])).map(o=>({toolName:o.tool_name,calls:Number(o.calls)||0,fails:Number(o.fails)||0,lastErrorCode:o.last_error_code,lastErrorMessage:o.last_error_message})),a)}function R(e){if(e.totalCalls===0)return{rating:"unknown",evidence:`No tool calls in the last ${e.windowMin}m — nothing to grade.`,brokenTools:[]};const t=e.failing.filter(o=>o.failPct>=60),a=e.failing.filter(o=>o.failPct<60);if(t.length>0){const o=t[0],r=o.lastErrorCode?` [${o.lastErrorCode}]`:"",s=o.lastErrorMessage?`: ${o.lastErrorMessage.slice(0,120)}`:"",i=t.length>1?` (+${t.length-1} other tool(s) also failing)`:"";return{rating:"broken",evidence:`${o.toolName} is failing ${o.failPct}% of calls (${o.fails}/${o.calls}) over ${e.windowMin}m${i}${r}${s}`,brokenTools:t.map(n=>n.toolName)}}if(a.length>0){const o=a[0];return{rating:"degraded",evidence:`${o.toolName} failing ${o.failPct}% of calls (${o.fails}/${o.calls}) over ${e.windowMin}m — below the 60% outage cutoff.`,brokenTools:[]}}return{rating:"healthy",evidence:`No tool failing above 30% across ${e.totalCalls} call(s)/${e.windowMin}m (${e.toolsSeen} tools).`,brokenTools:[]}}var f,d,u,E,l,g=c((()=>{f=5,d=60,u=30,E=15,l=`
SELECT tool_name,
       count(*) FILTER (WHERE status IN ('ok','error','timeout')) AS calls,
       count(*) FILTER (WHERE status IN ('error','timeout'))      AS fails,
       (array_agg(error_code ORDER BY invoked_at DESC)
          FILTER (WHERE status IN ('error','timeout') AND error_code IS NOT NULL))[1]    AS last_error_code,
       (array_agg(error_message ORDER BY invoked_at DESC)
          FILTER (WHERE status IN ('error','timeout') AND error_message IS NOT NULL))[1] AS last_error_message
FROM harness_shared.tool_invocations
WHERE workspace_id = $1
  AND invoked_at > now() - (($2)::int || ' minutes')::interval
GROUP BY tool_name
HAVING count(*) FILTER (WHERE status IN ('ok','error','timeout')) > 0
`}));g();export{R as gradeToolFailures,N as readToolFailureRate};
