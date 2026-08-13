import{n as E}from"./chunk-ChpBd9eV.js";import{n as _,t as r}from"./empty-mapping-hint-Pc-6wVF7.js";function d(t){const n=[...t].sort((o,s)=>s.emptyRuns-o.emptyRuns||(o.ownerId??"").localeCompare(s.ownerId??"")),e=n.reduce((o,s)=>o+s.emptyRuns,0),a=n.reduce((o,s)=>o+s.totalRuns,0);return{totalEmptyRuns:e,totalRuns:a,pctEmpty:a>=20?Math.round(e/a*100):null,byOwner:n}}async function l(t,n={}){return d((await t(u,[n.sinceDays??7])).map(e=>({ownerId:e.owner_id,emptyRuns:Number(e.empty_runs)||0,totalRuns:Number(e.total_runs)||0,lastSeen:e.last_seen})))}function w(t){if(t.pctEmpty===null)return{rating:"unknown",evidence:`Only ${t.totalRuns} code:run call(s) in window (need 20) — too few to grade.`};const n=t.pctEmpty<=2?"healthy":t.pctEmpty<10?"degraded":"broken",e=t.byOwner[0],a=e?.ownerId?` (worst: ${e.ownerId.slice(0,13)} ×${e.emptyRuns})`:"";return{rating:n,evidence:`${t.pctEmpty}% of code:run calls returned ok-but-blank rows (${t.totalEmptyRuns}/${t.totalRuns}) across ${t.byOwner.length} agent(s)${a}. These are MIS-MAPPED RESPONSE SHAPES, not empty result sets — the caller read keys the payload does not have.`}}var R,u,m,c,p=E((()=>{_(),R=20,u=`
SELECT coord_owner_id AS owner_id,
       count(*) FILTER (WHERE metadata_json ? '${r}') AS empty_runs,
       count(*) AS total_runs,
       max(invoked_at) FILTER (WHERE metadata_json ? '${r}') AS last_seen
FROM harness_shared.tool_invocations
WHERE tool_name = 'code:run'
  AND invoked_at > now() - (($1)::int || ' days')::interval
GROUP BY coord_owner_id
HAVING count(*) FILTER (WHERE metadata_json ? '${r}') > 0
ORDER BY empty_runs DESC
`,m=2,c=10}));p();export{c as EMPTY_RESULT_DEGRADED_BELOW,m as EMPTY_RESULT_HEALTHY_AT_OR_BELOW,R as EMPTY_RESULT_MIN_RUNS,u as EMPTY_RESULT_RATE_SQL,w as gradeEmptyResultRate,l as readEmptyResultRate,d as rollupEmptyResults};
