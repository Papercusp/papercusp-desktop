import{n as r}from"./chunk-ChpBd9eV.js";function i(n){let t=0,e=0;for(const a of n)a.oriented&&(t+=1,a.redundant&&(e+=1));return{orientedSpawns:t,alsoRedundantSpawns:e,pctRedundant:t>0?Math.round(e/t*1e3)/10:null}}async function c(n,t={}){return i((await n(d,[t.sinceHours??24])).map(e=>({spawnId:e.spawn_id,oriented:e.oriented===!0,redundant:e.redundant===!0})))}function w(n){return n.pctRedundant===null||n.orientedSpawns<5?{rating:"unknown",evidence:`only ${n.orientedSpawns} coord:orient spawn(s) in window (< 5) — too small a sample to grade orient-dedup.`}:{rating:n.pctRedundant<25?"healthy":n.pctRedundant<60?"degraded":"broken",evidence:`${n.pctRedundant}% of coord:orient spawns (${n.alsoRedundantSpawns}/${n.orientedSpawns}) also re-called a subsumed tool (${o.join(", ")}) this window.`}}var o,d,s,_,p,E=r((()=>{o=["coord:plan-events","memory:search","coord:inbox","coord:declare-intent"],d=`
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
`,s=5,_=25,p=60}));export{o as a,c,d as i,i as l,_ as n,w as o,s as r,E as s,p as t};
