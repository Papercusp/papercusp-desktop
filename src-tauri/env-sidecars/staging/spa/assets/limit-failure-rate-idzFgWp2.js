import{n as s}from"./chunk-ChpBd9eV.js";function n(r){const o=[...r].sort((e,t)=>t.errs-e.errs||e.toolName.localeCompare(t.toolName));return{totalErrs:o.reduce((e,t)=>e+t.errs,0),byTool:o}}async function m(r,o={}){return n((await r(a,[o.sinceDays??14])).map(e=>({toolName:e.tool_name,errs:Number(e.errs)||0,lastSeen:e.last_seen,sample:e.sample})))}function E(r){const o=r.totalErrs<10?"healthy":r.totalErrs<100?"degraded":"broken",e=r.byTool[0],t=e?` (worst: ${e.toolName} ×${e.errs})`:"";return{rating:o,evidence:`${r.totalErrs} tool-arg limit-rejection failures in window across ${r.byTool.length} tool(s)${t}.`}}var a,i,_,c=s((()=>{a=`
SELECT tool_name, count(*) AS errs, max(invoked_at) AS last_seen,
       (array_agg(error_message ORDER BY invoked_at DESC))[1] AS sample
FROM harness_shared.tool_invocations
WHERE status <> 'ok' AND invoked_at > now() - (($1)::int || ' days')::interval
  AND (error_message ILIKE '%must contain at most%' OR error_message ILIKE '%Too big%'
       OR error_message ILIKE '%expected string to have <=%' OR error_code ILIKE '%too_big%')
GROUP BY tool_name ORDER BY errs DESC
`,i=10,_=100}));export{c as a,E as i,i as n,m as o,a as r,n as s,_ as t};
