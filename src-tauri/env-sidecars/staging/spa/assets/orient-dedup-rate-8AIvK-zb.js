import{n as e}from"./chunk-CMxvf4Kt.js";function t(e){let t=0,n=0;for(let r of e)r.oriented&&(t+=1,r.redundant&&(n+=1));return{orientedSpawns:t,alsoRedundantSpawns:n,pctRedundant:t>0?Math.round(n/t*1e3)/10:null}}async function n(e,n={}){return t((await e(a,[n.sinceHours??24])).map(e=>({spawnId:e.spawn_id,oriented:e.oriented===!0,redundant:e.redundant===!0})))}function r(e){return e.pctRedundant===null||e.orientedSpawns<5?{rating:`unknown`,evidence:`only ${e.orientedSpawns} coord:orient spawn(s) in window (< 5) — too small a sample to grade orient-dedup.`}:{rating:e.pctRedundant<25?`healthy`:e.pctRedundant<60?`degraded`:`broken`,evidence:`${e.pctRedundant}% of coord:orient spawns (${e.alsoRedundantSpawns}/${e.orientedSpawns}) also re-called a subsumed tool (${i.join(`, `)}) this window.`}}var i,a,o,s,c;e((()=>{i=[`coord:plan-events`,`memory:search`,`coord:inbox`,`coord:declare-intent`],a=`
WITH oriented AS (
  SELECT spawn_id, min(invoked_at) AS first_orient_at
  FROM harness_shared.tool_invocations
  WHERE transport='mcp'
    AND tool_name='coord:orient'
    AND invoked_at > now() - (($1)::int || ' hours')::interval
    AND spawn_id IS NOT NULL
  GROUP BY spawn_id
),
s AS (
  SELECT o.spawn_id,
         true AS oriented,
         bool_or(t.tool_name IN ('coord:plan-events','memory:search','coord:inbox','coord:declare-intent')) AS redundant
  FROM oriented o
  LEFT JOIN harness_shared.tool_invocations t
    ON t.spawn_id = o.spawn_id
   AND t.transport = 'mcp'
   AND t.invoked_at > o.first_orient_at
   AND t.invoked_at > now() - (($1)::int || ' hours')::interval
  GROUP BY o.spawn_id
)
SELECT spawn_id, oriented, coalesce(redundant, false) AS redundant FROM s
`,o=5,s=25,c=60}))();export{c as ORIENT_DEDUP_DEGRADED_BELOW,s as ORIENT_DEDUP_HEALTHY_BELOW,o as ORIENT_DEDUP_MIN_SAMPLE,a as ORIENT_DEDUP_RATE_SQL,i as ORIENT_SUBSUMED_TOOLS,r as gradeOrientDedupRate,n as readOrientDedupRate,t as rollupOrientDedup};