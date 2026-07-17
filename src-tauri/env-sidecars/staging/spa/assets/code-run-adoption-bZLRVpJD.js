import{n as e}from"./chunk-CMxvf4Kt.js";import{T as t,t as n}from"./src-Dq5H0hqY.js";import{r}from"./policy-B8cePvDm.js";function i(e){let t=e.map((e,t)=>t).sort((t,n)=>e[t].at-e[n].at),n=Array(e.length),r=-1,i;for(let a of t){let t=e[a].at;(i===void 0||t-i>400)&&r++,n[a]=r,i=t}return n}var a=e((()=>{n(),r(),new Set([...t])}));function o(e){return e.toLowerCase().replace(/[^a-z0-9]/g,``)}function s(e){return e.maxSameToolTurns>=2||e.distinctTools>=3&&e.distinctTurns>=3}function c(e){let t=new Map;for(let n of e){let e=`${n.role}\x00${n.day}`,r=t.get(e);r||(r={role:n.role,day:n.day,spawns:0,opportunitySpawns:0,opportunitySpawnsUsingCodeRun:0,adoptionRate:null,codeRunSpawns:0},t.set(e,r)),r.spawns+=1,n.usedCodeRun&&(r.codeRunSpawns+=1),s(n)&&(r.opportunitySpawns+=1,n.usedCodeRun&&(r.opportunitySpawnsUsingCodeRun+=1))}let n=[...t.values()];for(let e of n)e.adoptionRate=e.opportunitySpawns>0?e.opportunitySpawnsUsingCodeRun/e.opportunitySpawns:null;return n.sort((e,t)=>e.role===t.role?e.day.localeCompare(t.day):e.role.localeCompare(t.role)),n}function l(e){let t=new Map;for(let n of e){let e=t.get(n.spawnId);e||(e={role:n.role,day:n.day,usedCodeRun:!1,workCalls:[]},t.set(n.spawnId,e));let r=o(n.toolName);b.has(r)&&(e.usedCodeRun=!0),!y.includes(r)&&!x.has(r)&&e.workCalls.push({toolName:n.toolName,at:n.invokedAt})}let n=[];for(let e of t.values()){let t=i(e.workCalls),r=new Set,a=new Map,o=new Map;e.workCalls.forEach((e,n)=>{r.add(t[n]),o.set(e.toolName,(o.get(e.toolName)??0)+1);let i=a.get(e.toolName);i||(i=new Set,a.set(e.toolName,i)),i.add(t[n])});let s=0;for(let e of a.values())e.size>s&&(s=e.size);let c=0;for(let e of o.values())e>c&&(c=e);n.push({role:e.role,day:e.day,workCalls:e.workCalls.length,distinctTools:o.size,maxSameTool:c,maxSameToolTurns:s,distinctTurns:r.size,usedCodeRun:e.usedCodeRun})}return n}function u(e){return c(l(e))}function d(e){let t=e==null?NaN:Math.trunc(e);return!Number.isFinite(t)||t<1?7:Math.min(t,90)}function f(e){return`
WITH calls AS (
  SELECT
    spawn_id,
    role,
    (invoked_at AT TIME ZONE 'UTC')::date::text AS day,
    tool_name,
    invoked_at,
    lower(regexp_replace(tool_name, '[^a-zA-Z0-9]', '', 'g')) AS norm
  FROM harness_shared.tool_invocations
  WHERE ${e}
    AND status = 'ok'
    -- P-006 (2026-07-03): agent traffic ONLY. The raw table is dominated by UI HTTP
    -- polling (the measuring-code-run-adoption doc's own denominator warning) and a
    -- NULL spawn_id would collapse every un-attributed call into one mega-spawn via
    -- GROUP BY. Without these two filters the fleet number graded polling, not agents.
    AND transport = 'mcp'
    AND spawn_id IS NOT NULL
),
per_spawn AS (
  SELECT
    spawn_id,
    max(role) AS role,
    max(day)  AS day,
    bool_or(norm IN ('coderun','recipesrun')) AS used_code_run
  FROM calls
  GROUP BY spawn_id
),
work_rows AS (
  SELECT spawn_id, tool_name, invoked_at
  FROM calls
  WHERE norm NOT IN (
    'coderun','codetools','recipesrun','recipessearch','recipeslist',
    'recipesget','recipesmerge','recipessweep','recipescandidates',
    -- POLLER_TOOL_NORMS (P-006): machine-cadence reads are not batchable LLM decisions.
    'activityrecent'
  )
),
gapped AS (
  -- ms since the PREVIOUS work call in this spawn (NULL for the first) — the raw signal
  -- "turned" below thresholds against TURN_GAP_MS to find turn boundaries.
  SELECT
    spawn_id, tool_name, invoked_at,
    EXTRACT(EPOCH FROM (invoked_at - LAG(invoked_at) OVER w)) * 1000 AS gap_ms
  FROM work_rows
  WINDOW w AS (PARTITION BY spawn_id ORDER BY invoked_at, tool_name)
),
turned AS (
  SELECT
    spawn_id, tool_name,
    SUM(CASE WHEN gap_ms IS NULL OR gap_ms > 400 THEN 1 ELSE 0 END)
      OVER (PARTITION BY spawn_id ORDER BY invoked_at, tool_name) AS turn_id
  FROM gapped
),
tool_turn_counts AS (
  SELECT spawn_id, tool_name, count(DISTINCT turn_id) AS turns_for_tool, count(*) AS raw_calls
  FROM turned
  GROUP BY spawn_id, tool_name
),
work_agg AS (
  SELECT
    spawn_id,
    COALESCE(sum(raw_calls), 0)::int      AS work_calls,
    count(*)::int                         AS distinct_tools,
    COALESCE(max(raw_calls), 0)::int      AS max_same_tool,
    COALESCE(max(turns_for_tool), 0)::int AS max_same_tool_turns
  FROM tool_turn_counts
  GROUP BY spawn_id
),
spawn_turns AS (
  SELECT spawn_id, count(DISTINCT turn_id)::int AS distinct_turns
  FROM turned
  GROUP BY spawn_id
)
SELECT
  ps.role,
  ps.day,
  COALESCE(wa.work_calls, 0)          AS work_calls,
  COALESCE(wa.distinct_tools, 0)      AS distinct_tools,
  COALESCE(wa.max_same_tool, 0)       AS max_same_tool,
  COALESCE(wa.max_same_tool_turns, 0) AS max_same_tool_turns,
  COALESCE(st.distinct_turns, 0)      AS distinct_turns,
  ps.used_code_run
FROM per_spawn ps
LEFT JOIN work_agg wa USING (spawn_id)
LEFT JOIN spawn_turns st USING (spawn_id)
`}function p(e){return`
SET LOCAL statement_timeout = '${C}ms';
${f(`invoked_at >= now() - interval '${d(e)} days'`)}
LIMIT ${w}
`}function m(){let e={}.PAPERCUSP_ADOPTION_CACHE_TTL_MS;if(!e)return 30*6e4;let t=Number(e);return Number.isFinite(t)&&t>0?t:30*6e4}function h(){D.clear(),O.clear()}async function g(e,t={}){let n=d(t.sinceDays),r=t.now??Date.now,i=D.get(n);if(i&&r()-i.at<E)return i.value;let a=O.get(n);if(a)return a;let o=(async()=>{let t=c((await e(p(n),[])).map(e=>({role:e.role,day:e.day,workCalls:Number(e.work_calls)||0,distinctTools:Number(e.distinct_tools)||0,maxSameTool:Number(e.max_same_tool)||0,maxSameToolTurns:Number(e.max_same_tool_turns)||0,distinctTurns:Number(e.distinct_turns)||0,usedCodeRun:e.used_code_run===!0})));return D.set(n,{at:r(),value:t}),t})();O.set(n,o);try{return await o}finally{O.get(n)===o&&O.delete(n)}}function _(e){let t=0,n=0,r=0,i=0;for(let a of e)t+=a.spawns,n+=a.opportunitySpawns,r+=a.opportunitySpawnsUsingCodeRun,i+=a.codeRunSpawns;return{spawns:t,opportunitySpawns:n,opportunitySpawnsUsingCodeRun:r,codeRunSpawns:i,adoptionRate:n>0?r/n:null}}function v(e){if(e.adoptionRate===null||e.opportunitySpawns<5)return{rating:`unknown`,evidence:`code:run adoption: only ${e.opportunitySpawns} batchable opportunity-spawns in window (< 5) — too small a sample to grade tool-utilization`};let t=Math.round(e.adoptionRate*100);return{rating:e.adoptionRate>=.6?`healthy`:e.adoptionRate>=.25?`degraded`:`broken`,evidence:`code:run adoption ${t}% — ${e.opportunitySpawnsUsingCodeRun}/${e.opportunitySpawns} batchable opportunity-spawns folded a multi-call flow into one code:run/recipes:run this window (${e.codeRunSpawns} spawns used code:run at all, ${e.spawns} spawns total).`}}var y,b,x,S,C,w,T,E,D,O,k,A,j,M=e((()=>{a(),y=[`coderun`,`codetools`,`recipesrun`,`recipessearch`,`recipeslist`,`recipesget`,`recipesmerge`,`recipessweep`,`recipescandidates`],b=new Set([`coderun`,`recipesrun`]),x=new Set([`activityrecent`]),S=90,C=3e4,w=2e5,T=f(`invoked_at >= now() - (($1)::int || ' days')::interval`),E=m(),D=new Map,O=new Map,k=5,A=.6,j=.25}));export{_,S as a,C as c,d,u as f,g,s as h,k as i,h as l,M as m,j as n,w as o,v as p,A as r,T as s,E as t,p as u,l as v,c as y};