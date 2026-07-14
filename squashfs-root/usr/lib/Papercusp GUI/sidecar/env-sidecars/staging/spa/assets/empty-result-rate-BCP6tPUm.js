import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./empty-mapping-hint-CAWEv3oD.js";function r(e){let t=[...e].sort((e,t)=>t.emptyRuns-e.emptyRuns||(e.ownerId??``).localeCompare(t.ownerId??``)),n=t.reduce((e,t)=>e+t.emptyRuns,0),r=t.reduce((e,t)=>e+t.totalRuns,0);return{totalEmptyRuns:n,totalRuns:r,pctEmpty:r>=20?Math.round(n/r*100):null,byOwner:t}}async function i(e,t={}){return r((await e(s,[t.sinceDays??7])).map(e=>({ownerId:e.owner_id,emptyRuns:Number(e.empty_runs)||0,totalRuns:Number(e.total_runs)||0,lastSeen:e.last_seen})))}function a(e){if(e.pctEmpty===null)return{rating:`unknown`,evidence:`Only ${e.totalRuns} code:run call(s) in window (need 20) — too few to grade.`};let t=e.pctEmpty<=2?`healthy`:e.pctEmpty<10?`degraded`:`broken`,n=e.byOwner[0],r=n?.ownerId?` (worst: ${n.ownerId.slice(0,13)} ×${n.emptyRuns})`:``;return{rating:t,evidence:`${e.pctEmpty}% of code:run calls returned ok-but-blank rows (${e.totalEmptyRuns}/${e.totalRuns}) across ${e.byOwner.length} agent(s)${r}. These are MIS-MAPPED RESPONSE SHAPES, not empty result sets — the caller read keys the payload does not have.`}}var o,s,c,l;e((()=>{t(),o=20,s=`
SELECT coord_owner_id AS owner_id,
       count(*) FILTER (WHERE metadata_json ? '${n}') AS empty_runs,
       count(*) AS total_runs,
       max(invoked_at) FILTER (WHERE metadata_json ? '${n}') AS last_seen
FROM harness_shared.tool_invocations
WHERE tool_name = 'code:run'
  AND invoked_at > now() - (($1)::int || ' days')::interval
GROUP BY coord_owner_id
HAVING count(*) FILTER (WHERE metadata_json ? '${n}') > 0
ORDER BY empty_runs DESC
`,c=2,l=10}))();export{l as EMPTY_RESULT_DEGRADED_BELOW,c as EMPTY_RESULT_HEALTHY_AT_OR_BELOW,o as EMPTY_RESULT_MIN_RUNS,s as EMPTY_RESULT_RATE_SQL,a as gradeEmptyResultRate,i as readEmptyResultRate,r as rollupEmptyResults};