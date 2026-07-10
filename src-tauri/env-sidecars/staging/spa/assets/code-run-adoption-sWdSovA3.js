import{n as e}from"./chunk-CMxvf4Kt.js";import{T as t,t as n}from"./src-S3d7NQq1.js";import{r}from"./policy-PFY5nnRS.js";var i=e((()=>{n(),r(),new Set([...t])}));function a(e){return e.toLowerCase().replace(/[^a-z0-9]/g,``)}function o(e){return e.maxSameTool>=2||e.distinctTools>=3}function s(e){let t=new Map;for(let n of e){let e=`${n.role}\x00${n.day}`,r=t.get(e);r||(r={role:n.role,day:n.day,spawns:0,opportunitySpawns:0,opportunitySpawnsUsingCodeRun:0,adoptionRate:null,codeRunSpawns:0},t.set(e,r)),r.spawns+=1,n.usedCodeRun&&(r.codeRunSpawns+=1),o(n)&&(r.opportunitySpawns+=1,n.usedCodeRun&&(r.opportunitySpawnsUsingCodeRun+=1))}let n=[...t.values()];for(let e of n)e.adoptionRate=e.opportunitySpawns>0?e.opportunitySpawnsUsingCodeRun/e.opportunitySpawns:null;return n.sort((e,t)=>e.role===t.role?e.day.localeCompare(t.day):e.role.localeCompare(t.role)),n}function c(e){let t=new Map;for(let n of e){let e=t.get(n.spawnId);e||(e={role:n.role,day:n.day,usedCodeRun:!1,workToolCounts:new Map},t.set(n.spawnId,e));let r=a(n.toolName);h.has(r)&&(e.usedCodeRun=!0),!m.includes(r)&&!g.has(r)&&e.workToolCounts.set(n.toolName,(e.workToolCounts.get(n.toolName)??0)+1)}let n=[];for(let e of t.values()){let t=0,r=0;for(let n of e.workToolCounts.values())t+=n,n>r&&(r=n);n.push({role:e.role,day:e.day,workCalls:t,distinctTools:e.workToolCounts.size,maxSameTool:r,usedCodeRun:e.usedCodeRun})}return n}function l(e){return s(c(e))}function u(){y.clear(),b.clear()}async function d(e,t={}){let n=t.sinceDays??7,r=t.now??Date.now,i=y.get(n);if(i&&r()-i.at<3e5)return i.value;let a=b.get(n);if(a)return a;let o=(async()=>{let t=s((await e(_,[n])).map(e=>({role:e.role,day:e.day,workCalls:Number(e.work_calls)||0,distinctTools:Number(e.distinct_tools)||0,maxSameTool:Number(e.max_same_tool)||0,usedCodeRun:e.used_code_run===!0})));return y.set(n,{at:r(),value:t}),t})();b.set(n,o);try{return await o}finally{b.get(n)===o&&b.delete(n)}}function f(e){let t=0,n=0,r=0,i=0;for(let a of e)t+=a.spawns,n+=a.opportunitySpawns,r+=a.opportunitySpawnsUsingCodeRun,i+=a.codeRunSpawns;return{spawns:t,opportunitySpawns:n,opportunitySpawnsUsingCodeRun:r,codeRunSpawns:i,adoptionRate:n>0?r/n:null}}function p(e){if(e.adoptionRate===null||e.opportunitySpawns<5)return{rating:`unknown`,evidence:`code:run adoption: only ${e.opportunitySpawns} batchable opportunity-spawns in window (< 5) — too small a sample to grade tool-utilization`};let t=Math.round(e.adoptionRate*100);return{rating:e.adoptionRate>=.6?`healthy`:e.adoptionRate>=.25?`degraded`:`broken`,evidence:`code:run adoption ${t}% — ${e.opportunitySpawnsUsingCodeRun}/${e.opportunitySpawns} batchable opportunity-spawns folded a multi-call flow into one code:run/recipes:run this window (${e.codeRunSpawns} spawns used code:run at all, ${e.spawns} spawns total).`}}var m,h,g,_,v,y,b,x,S,C,w=e((()=>{i(),m=[`coderun`,`codetools`,`recipesrun`,`recipessearch`,`recipeslist`,`recipesget`,`recipesmerge`,`recipessweep`,`recipescandidates`],h=new Set([`coderun`,`recipesrun`]),g=new Set([`activityrecent`]),_=`
WITH calls AS (
  SELECT
    spawn_id,
    role,
    (invoked_at AT TIME ZONE 'UTC')::date::text AS day,
    tool_name,
    lower(regexp_replace(tool_name, '[^a-zA-Z0-9]', '', 'g')) AS norm
  FROM harness_shared.tool_invocations
  WHERE invoked_at >= now() - (($1)::int || ' days')::interval
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
work_tool_counts AS (
  SELECT spawn_id, tool_name, count(*) AS cnt
  FROM calls
  WHERE norm NOT IN (
    'coderun','codetools','recipesrun','recipessearch','recipeslist',
    'recipesget','recipesmerge','recipessweep','recipescandidates',
    -- POLLER_TOOL_NORMS (P-006): machine-cadence reads are not batchable LLM decisions.
    'activityrecent'
  )
  GROUP BY spawn_id, tool_name
),
work_agg AS (
  SELECT
    spawn_id,
    COALESCE(sum(cnt), 0)::int  AS work_calls,
    count(*)::int               AS distinct_tools,
    COALESCE(max(cnt), 0)::int  AS max_same_tool
  FROM work_tool_counts
  GROUP BY spawn_id
)
SELECT
  ps.role,
  ps.day,
  COALESCE(wa.work_calls, 0)     AS work_calls,
  COALESCE(wa.distinct_tools, 0) AS distinct_tools,
  COALESCE(wa.max_same_tool, 0)  AS max_same_tool,
  ps.used_code_run
FROM per_spawn ps
LEFT JOIN work_agg wa USING (spawn_id)
`,v=5*6e4,y=new Map,b=new Map,x=5,S=.6,C=.25}));export{_ as a,p as c,d,f,x as i,w as l,s as m,C as n,u as o,c as p,S as r,l as s,v as t,o as u};