import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CRqYcphb.js";import{r,t as i}from"./loop-cost-cap-Dejo-jxv.js";function a(e){let{armedAtMs:t,nowMs:n,fireCount:r,maxFires:i,maxDurationSec:a}=e;return a!=null&&a>0&&n-t>a*1e3?{breach:!0,reason:`max-duration ${Math.round((n-t)/1e3)}s > ${a}s (since arm)`}:i!=null&&i>0&&r>=i?{breach:!0,reason:`max-fires ${r} >= ${i}`}:{breach:!1}}async function o(e,n={}){let r=e.maxFires!=null&&e.maxFires>0,o=e.maxDurationSec!=null&&e.maxDurationSec>0;if(!r&&!o)return{breach:!1};let s=e.sql??t().sql,c=n.autoPause??i,l=e.nowMs??Date.now(),u=await s`
    SELECT (EXTRACT(EPOCH FROM COALESCE((metadata->>'armed_at')::timestamptz, created_at)) * 1000)::bigint AS armed_ms,
           COALESCE((metadata->>'fire_count')::int, 0)    AS fire_count
      FROM harness_shared.routines
     WHERE id = ${e.routineId}`,d=a({armedAtMs:Number(u[0]?.armed_ms??l),nowMs:l,fireCount:Number(u[0]?.fire_count??0),maxFires:e.maxFires,maxDurationSec:e.maxDurationSec});return d.breach&&await c(s,e.routineId,`dead-man guard: ${d.reason}`),d}async function s(e,n){let r=await(e??t().sql)`
    SELECT COALESCE((metadata->>'fire_count')::int, 0) AS fire_count
      FROM harness_shared.routines
     WHERE id = ${n}`;return Number(r[0]?.fire_count??0)}async function c(e,n){await(e??t().sql)`
    UPDATE harness_shared.routines
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('fire_count', COALESCE((metadata->>'fire_count')::int, 0) + 1)
     WHERE id = ${n}`}var l=e((()=>{n(),r()}));export{s as i,c as n,l as r,o as t};