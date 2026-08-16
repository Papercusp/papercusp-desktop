import{n as O}from"./chunk-ChpBd9eV.js";import{st as p,t as L}from"./src-8fWtxfEz.js";import{a as $,i as I,o as f}from"./started-DlXryIUw.js";import{n as C,t as M}from"./tick-ledger-CBLP8LFj.js";function v(){const t=Number({}.PAPERCUSP_SIGNAL_ACCUM_LOOKBACK_SEC??604800);return Number.isFinite(t)?t:604800}function F(){const t=Number({}.PAPERCUSP_SIGNAL_ACCUM_SWEEP_SEC??120);return Number.isFinite(t)&&t>=0?t:120}function N(t,a,r){const n=a-Math.max(0,r)*1e3;return t==null||!Number.isFinite(t)?n:Math.max(t,n)}function R(t,a=b){let r=0;for(const n of h){const e=t[n];typeof e=="number"&&Number.isFinite(e)&&e>0&&(r+=e*a[n])}return r}function W(t,a,r){return t==null?!0:a-t>=r*1e3}function d(t,a){const r=a[0],n=r?Number(r.c??0):0,e=r?.hw??null,s=e==null?null:e instanceof Date?e:new Date(e);return{lane:t,newCount:Number.isFinite(n)&&n>0?Math.trunc(n):0,highWaterAt:s&&Number.isFinite(s.getTime())?s:null}}async function k(t,a,r){const n=r.getTime(),e=r.toISOString(),[s,l,m,o,_,c]=await Promise.all([t`
      SELECT count(*)::int AS c, max(created_at) AS hw
        FROM harness_shared.engineer_issues
       WHERE workspace_id = ${a}
         AND created_at > ${e}
         AND payload ? 'observation'`,t`
      SELECT count(*)::int AS c, max(created_at) AS hw
        FROM harness_shared.engineer_issues
       WHERE workspace_id = ${a}
         AND created_at > ${e}
         AND NOT payload ? 'observation'`,t`
      WITH graded AS (
        SELECT created_at,
               payload->'observation'->>'rubricRef' AS rubric_ref,
               payload->'observation'->'ratings'    AS ratings
          FROM harness_shared.engineer_issues
         WHERE workspace_id = ${a}
             AND created_at > ${new Date(n-T).toISOString()}
           AND payload->'observation' ? 'ratings'
         ORDER BY created_at DESC
         LIMIT ${D}
      ), expanded AS (
        SELECT g.created_at, g.rubric_ref, e.key AS criterion, e.value->>'rating' AS rating
          FROM graded g, jsonb_each(g.ratings) e
      ), with_prior AS (
        SELECT created_at, rating,
               lag(rating) OVER (PARTITION BY rubric_ref, criterion ORDER BY created_at) AS prior
          FROM expanded
      )
      SELECT count(*)::int AS c, max(created_at) AS hw
        FROM with_prior
       WHERE created_at > ${e}
         AND rating IS DISTINCT FROM prior`,t`
      SELECT count(*)::int AS c, max(to_timestamp(updated_ts / 1000.0)) AS hw
        FROM harness_shared.work_items
       WHERE workspace_id = ${a}
         AND status IN ('resolved', 'closed', 'passed')
         AND updated_ts > ${n}`,t`
      SELECT count(*)::int AS c, max(last_released_at) AS hw
        FROM harness_shared.work_items
       WHERE workspace_id = ${a}
         AND last_released_at > ${e}`,t`
      SELECT count(*)::int AS c, max(to_timestamp(updated_ts / 1000.0)) AS hw
        FROM harness_shared.work_items
       WHERE workspace_id = ${a}
         AND status IN ('blocked', 'deprecated', 'needs-human')
         AND updated_ts > ${n}`]);return[d("scorecard-rating-changes",m),d("observations",s),d("captures",l),d("reverts",_),d("deferrals",c),d("completions",o)]}async function y(t,a,r,n,e){for(const s of e)await t`
      INSERT INTO harness_shared.scout_signal_accumulator
        (workspace_id, install_slug, lane, new_count, high_water_at, watermark_at, updated_at)
      VALUES (${a}, ${r}, ${s.lane}, ${s.newCount},
              ${s.highWaterAt?s.highWaterAt.toISOString():null}, ${n.toISOString()}, now())
      ON CONFLICT (workspace_id, install_slug, lane) DO UPDATE
        SET new_count     = EXCLUDED.new_count,
            high_water_at = EXCLUDED.high_water_at,
            watermark_at  = EXCLUDED.watermark_at,
            updated_at    = now()`}async function j(t){const a=await(t.sql??p().sql)`
    SELECT lane, new_count, watermark_at, updated_at
      FROM harness_shared.scout_signal_accumulator
     WHERE workspace_id = ${t.workspaceId}
     ORDER BY updated_at DESC`,r={};let n=null;for(const e of a){const s=e.lane;if(!h.includes(s)||r[s]!==void 0)continue;r[s]=Math.max(0,Number(e.new_count)||0);const l=e.watermark_at==null?null:e.watermark_at instanceof Date?e.watermark_at:new Date(e.watermark_at);l&&Number.isFinite(l.getTime())&&(n==null||l>n)&&(n=l)}return{counts:r,watermarkAt:n}}async function X(t={}){const a=[],r=v();if(r<=0)return a;const n=t.now??Date.now();if(!W(A,n,F()))return a;A=n;try{const e=await $();if(e.length===0){const o=typeof f=="function"?f():[];if(o.length===0)return a;const{sql:_}=p();let c=0,w=0;for(const u of o){const S=await C({installSlugs:[],workspaceId:u}).catch(()=>null),g=await k(_,u,new Date(N(S,n,r)));c+=g.reduce((i,E)=>i+E.newCount,0),w+=R(Object.fromEntries(g.map(i=>[i.lane,i.newCount])))}if(c>0){const u=`${c} eligible signal(s) found in ${o.length} workspace(s), but no registered Blender scopes were evaluated`;return console.warn(`[signal-accumulator] ALERT: ${u}`),[{workspaceId:"*",installSlug:"*",outcome:"error",evaluatedWorkspaceCount:0,evaluatedScopeCount:0,eligibleBacklogCount:c,score:w,reason:u}]}return a}const{sql:s}=p(),l=new Set(e.map(({workspaceId:o})=>o)).size,m=e.length;for(const{workspaceId:o,installSlug:_}of e)try{const c=await C({installSlugs:[],workspaceId:o}).catch(()=>null),w=new Date(N(c,n,r)),u=await k(s,o,w);await y(s,o,_,w,u);const S=R(Object.fromEntries(u.map(i=>[i.lane,i.newCount]))),g=u.reduce((i,E)=>i+E.newCount,0);a.push({workspaceId:o,installSlug:_,outcome:"swept",evaluatedWorkspaceCount:l,evaluatedScopeCount:m,eligibleBacklogCount:g,score:S,reason:u.map(i=>`${i.lane}=${i.newCount}`).join(" ")})}catch(c){a.push({workspaceId:o,installSlug:_,outcome:"error",evaluatedWorkspaceCount:l,evaluatedScopeCount:m,eligibleBacklogCount:0,score:0,reason:c instanceof Error?c.message:String(c)})}}catch(e){console.warn(`[signal-accumulator] sweep failed: ${e instanceof Error?e.message:e}`)}return a}var h,b,D,T,A,P=O((()=>{L(),I(),M(),h=["scorecard-rating-changes","observations","captures","reverts","deferrals","completions"],b={"scorecard-rating-changes":3,observations:2,captures:1,reverts:3,deferrals:1,completions:.5},D=500,T=30*864e5,A=null}));P();export{b as DEFAULT_LANE_WEIGHTS,h as SIGNAL_LANES,j as readAccumulatorCounts,X as scoutSignalAccumulatorSweep,R as weightedSignalScore};
