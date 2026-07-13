import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CRqYcphb.js";import{i as r,o as i}from"./started-b2c19sz2.js";import{n as a,t as o}from"./tick-ledger-BaeWv5Lz.js";function s(){let e=Number({}.PAPERCUSP_SIGNAL_ACCUM_LOOKBACK_SEC??604800);return Number.isFinite(e)?e:604800}function c(){let e=Number({}.PAPERCUSP_SIGNAL_ACCUM_SWEEP_SEC??120);return Number.isFinite(e)&&e>=0?e:120}function l(e,t,n){let r=t-Math.max(0,n)*1e3;return e==null||!Number.isFinite(e)?r:Math.max(e,r)}function u(e,t=v){let n=0;for(let r of _){let i=e[r];typeof i==`number`&&Number.isFinite(i)&&i>0&&(n+=i*t[r])}return n}function d(e,t,n){return e==null?!0:t-e>=n*1e3}function f(e,t){let n=t[0],r=n?Number(n.c??0):0,i=n?.hw??null,a=i==null?null:i instanceof Date?i:new Date(i);return{lane:e,newCount:Number.isFinite(r)&&r>0?Math.trunc(r):0,highWaterAt:a&&Number.isFinite(a.getTime())?a:null}}async function p(e,t,n){let r=n.getTime(),i=n.toISOString(),[a,o,s,c,l,u]=await Promise.all([e`
      SELECT count(*)::int AS c, max(created_at) AS hw
        FROM harness_shared.engineer_issues
       WHERE workspace_id = ${t}
         AND created_at > ${i}
         AND payload ? 'observation'`,e`
      SELECT count(*)::int AS c, max(created_at) AS hw
        FROM harness_shared.engineer_issues
       WHERE workspace_id = ${t}
         AND created_at > ${i}
         AND NOT payload ? 'observation'`,e`
      WITH graded AS (
        SELECT created_at,
               payload->'observation'->>'rubricRef' AS rubric_ref,
               payload->'observation'->'ratings'    AS ratings
          FROM harness_shared.engineer_issues
         WHERE workspace_id = ${t}
             AND created_at > ${new Date(r-b).toISOString()}
           AND payload->'observation' ? 'ratings'
         ORDER BY created_at DESC
         LIMIT ${y}
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
       WHERE created_at > ${i}
         AND rating IS DISTINCT FROM prior`,e`
      SELECT count(*)::int AS c, max(to_timestamp(updated_ts / 1000.0)) AS hw
        FROM harness_shared.work_items
       WHERE workspace_id = ${t}
         AND status IN ('resolved', 'closed', 'passed')
         AND updated_ts > ${r}`,e`
      SELECT count(*)::int AS c, max(last_released_at) AS hw
        FROM harness_shared.work_items
       WHERE workspace_id = ${t}
         AND last_released_at > ${i}`,e`
      SELECT count(*)::int AS c, max(to_timestamp(updated_ts / 1000.0)) AS hw
        FROM harness_shared.work_items
       WHERE workspace_id = ${t}
         AND status IN ('blocked', 'deprecated', 'needs-human')
         AND updated_ts > ${r}`]);return[f(`scorecard-rating-changes`,s),f(`observations`,a),f(`captures`,o),f(`reverts`,l),f(`deferrals`,u),f(`completions`,c)]}async function m(e,t,n,r,i){for(let a of i)await e`
      INSERT INTO harness_shared.scout_signal_accumulator
        (workspace_id, install_slug, lane, new_count, high_water_at, watermark_at, updated_at)
      VALUES (${t}, ${n}, ${a.lane}, ${a.newCount},
              ${a.highWaterAt?a.highWaterAt.toISOString():null}, ${r.toISOString()}, now())
      ON CONFLICT (workspace_id, install_slug, lane) DO UPDATE
        SET new_count     = EXCLUDED.new_count,
            high_water_at = EXCLUDED.high_water_at,
            watermark_at  = EXCLUDED.watermark_at,
            updated_at    = now()`}async function h(e){let{sql:n}=t(),r=await n`
    SELECT lane, new_count, watermark_at, updated_at
      FROM harness_shared.scout_signal_accumulator
     WHERE workspace_id = ${e.workspaceId}
     ORDER BY updated_at DESC`,i={},a=null;for(let e of r){let t=e.lane;if(!_.includes(t)||i[t]!==void 0)continue;i[t]=Math.max(0,Number(e.new_count)||0);let n=e.watermark_at==null?null:e.watermark_at instanceof Date?e.watermark_at:new Date(e.watermark_at);n&&Number.isFinite(n.getTime())&&(a==null||n>a)&&(a=n)}return{counts:i,watermarkAt:a}}async function g(e={}){let n=[],r=s();if(r<=0)return n;let o=e.now??Date.now();if(!d(x,o,c()))return n;x=o;try{let e=await i();if(e.length===0)return n;let{sql:s}=t();for(let{workspaceId:t,installSlug:i}of e)try{let e=await a({installSlugs:[],workspaceId:t}).catch(()=>null),c=new Date(l(e,o,r)),d=await p(s,t,c);await m(s,t,i,c,d);let f=u(Object.fromEntries(d.map(e=>[e.lane,e.newCount])));n.push({workspaceId:t,installSlug:i,outcome:`swept`,score:f,reason:d.map(e=>`${e.lane}=${e.newCount}`).join(` `)})}catch(e){n.push({workspaceId:t,installSlug:i,outcome:`error`,score:0,reason:e instanceof Error?e.message:String(e)})}}catch(e){console.warn(`[signal-accumulator] sweep failed: ${e instanceof Error?e.message:e}`)}return n}var _,v,y,b,x;e((()=>{n(),r(),o(),_=[`scorecard-rating-changes`,`observations`,`captures`,`reverts`,`deferrals`,`completions`],v={"scorecard-rating-changes":3,observations:2,captures:1,reverts:3,deferrals:1,completions:.5},y=500,b=30*864e5,x=null}))();export{h as readAccumulatorCounts,g as scoutSignalAccumulatorSweep,u as weightedSignalScore};