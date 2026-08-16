import{n as S}from"./chunk-ChpBd9eV.js";import{t as y}from"./src-By4QS-w9.js";import{t as g}from"./role-config-B_m8jODy.js";import{i as L}from"./policy-fRcQo1qW.js";function h(n){const a=n.map((t,r)=>r).sort((t,r)=>n[t].at-n[r].at),s=new Array(n.length);let o=-1,e;for(const t of a){const r=n[t].at;(e===void 0||r-e>400)&&o++,s[t]=o,e=r}return s}var M,I,U=S((()=>{y(),L(),M=400,I=new Set([...g])}));function k(n){return n.toLowerCase().replace(/[^a-z0-9]/g,"")}function P(n){return n.maxSameToolTurns>=2||n.distinctTools>=3&&n.distinctTurns>=3}function m(n){const a=new Map;for(const o of n){const e=`${o.role}\0${o.day}`;let t=a.get(e);t||(t={role:o.role,day:o.day,spawns:0,opportunitySpawns:0,opportunitySpawnsUsingCodeRun:0,adoptionRate:null,codeRunSpawns:0},a.set(e,t)),t.spawns+=1,o.usedCodeRun&&(t.codeRunSpawns+=1),P(o)&&(t.opportunitySpawns+=1,o.usedCodeRun&&(t.opportunitySpawnsUsingCodeRun+=1))}const s=[...a.values()];for(const o of s)o.adoptionRate=o.opportunitySpawns>0?o.opportunitySpawnsUsingCodeRun/o.opportunitySpawns:null;return s.sort((o,e)=>o.role===e.role?o.day.localeCompare(e.day):o.role.localeCompare(e.role)),s}function D(n){const a=new Map;for(const o of n){let e=a.get(o.spawnId);e||(e={role:o.role,day:o.day,usedCodeRun:!1,workCalls:[]},a.set(o.spawnId,e));const t=k(o.toolName);E.has(t)&&(e.usedCodeRun=!0),!O.includes(t)&&!C.has(t)&&e.workCalls.push({toolName:o.toolName,at:o.invokedAt})}const s=[];for(const o of a.values()){const e=h(o.workCalls),t=new Set,r=new Map,d=new Map;o.workCalls.forEach((u,w)=>{t.add(e[w]),d.set(u.toolName,(d.get(u.toolName)??0)+1);let p=r.get(u.toolName);p||(p=new Set,r.set(u.toolName,p)),p.add(e[w])});let i=0;for(const u of r.values())u.size>i&&(i=u.size);let _=0;for(const u of d.values())u>_&&(_=u);s.push({role:o.role,day:o.day,workCalls:o.workCalls.length,distinctTools:d.size,maxSameTool:_,maxSameToolTurns:i,distinctTurns:t.size,usedCodeRun:o.usedCodeRun})}return s}function V(n){return m(D(n))}function A(n){const a=n==null?NaN:Math.trunc(n);return!Number.isFinite(a)||a<1?7:Math.min(a,90)}function T(n){return`
WITH calls AS (
  SELECT
    spawn_id,
    role,
    (invoked_at AT TIME ZONE 'UTC')::date::text AS day,
    tool_name,
    invoked_at,
    lower(regexp_replace(tool_name, '[^a-zA-Z0-9]', '', 'g')) AS norm
  FROM harness_shared.tool_invocations
  WHERE ${n}
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
`}function v(n){return`
SET LOCAL statement_timeout = '${R}ms';
${T(`invoked_at >= now() - interval '${A(n)} days'`)}
LIMIT ${f}
`}function b(){const n={}.PAPERCUSP_ADOPTION_CACHE_TTL_MS;if(!n)return 30*6e4;const a=Number(n);return Number.isFinite(a)&&a>0?a:30*6e4}function J(){c.clear(),l.clear()}async function X(n,a={}){const s=A(a.sinceDays),o=a.now??Date.now,e=c.get(s);if(e&&o()-e.at<N)return e.value;const t=l.get(s);if(t)return t;const r=(async()=>{const d=m((await n(v(s),[])).map(i=>({role:i.role,day:i.day,workCalls:Number(i.work_calls)||0,distinctTools:Number(i.distinct_tools)||0,maxSameTool:Number(i.max_same_tool)||0,maxSameToolTurns:Number(i.max_same_tool_turns)||0,distinctTurns:Number(i.distinct_turns)||0,usedCodeRun:i.used_code_run===!0})));return c.set(s,{at:o(),value:d}),d})();l.set(s,r);try{return await r}finally{l.get(s)===r&&l.delete(s)}}function Z(n){let a=0,s=0,o=0,e=0;for(const t of n)a+=t.spawns,s+=t.opportunitySpawns,o+=t.opportunitySpawnsUsingCodeRun,e+=t.codeRunSpawns;return{spawns:a,opportunitySpawns:s,opportunitySpawnsUsingCodeRun:o,codeRunSpawns:e,adoptionRate:s>0?o/s:null}}function K(n){if(n.adoptionRate===null||n.opportunitySpawns<5)return{rating:"unknown",evidence:`code:run adoption: only ${n.opportunitySpawns} batchable opportunity-spawns in window (< 5) — too small a sample to grade tool-utilization`};const a=Math.round(n.adoptionRate*100);return{rating:n.adoptionRate>=.6?"healthy":n.adoptionRate>=.25?"degraded":"broken",evidence:`code:run adoption ${a}% — ${n.opportunitySpawnsUsingCodeRun}/${n.opportunitySpawns} batchable opportunity-spawns folded a multi-call flow into one code:run/recipes:run this window (${n.codeRunSpawns} spawns used code:run at all, ${n.spawns} spawns total).`}}var O,E,C,x,R,f,F,N,c,l,B,$,H,j=S((()=>{U(),O=["coderun","codetools","recipesrun","recipessearch","recipeslist","recipesget","recipesmerge","recipessweep","recipescandidates"],E=new Set(["coderun","recipesrun"]),C=new Set(["activityrecent"]),x=90,R=3e4,f=2e5,F=T("invoked_at >= now() - (($1)::int || ' days')::interval"),N=b(),c=new Map,l=new Map,B=5,$=.6,H=.25}));export{Z as _,x as a,R as c,A as d,V as f,X as g,P as h,B as i,J as l,j as m,H as n,f as o,K as p,$ as r,F as s,N as t,v as u,D as v,m as y};
