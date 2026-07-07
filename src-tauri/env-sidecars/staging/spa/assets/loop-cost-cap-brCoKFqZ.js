import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-DTtGQmae.js";import{l as r,s as i}from"./assignments-DaWmyaPK.js";function a(e){let t=e.capCents;return t==null||!Number.isFinite(t)||t<=0?{breach:!1}:{breach:e.spendCents>t}}async function o(e){try{let n=e.sql??t().sql,r=(await i()).get(e.targetOwnerId)?.sessionId;if(!r)return 0;let a=(await n`
      SELECT COALESCE(SUM(cost_usd), 0)::float8 AS usd
        FROM harness_shared.agent_usage_samples
       WHERE session_id = ${r}
         AND ts >= ${e.sinceMs}
    `)[0]?.usd??0;return Math.max(0,Math.round(a*100))}catch{return 0}}async function s(e,t,n){await e`
    UPDATE harness_shared.routines
       SET active = FALSE,
           next_fire_at = NULL,
           metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('loop_paused_reason', ${n}::text, 'loop_paused_at', now()::text),
           updated_at = now()
     WHERE id = ${t}
  `}async function c(e,n={}){let r=e.capCents;if(r==null||!Number.isFinite(r)||r<=0)return{breach:!1,spendCents:0,capCents:null};let i=e.sql??t().sql,c=n.readSpend??o,l=n.autoPause??s,u=await i`
    SELECT (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS armed_ms
      FROM harness_shared.routines
     WHERE id = ${e.routineId}
  `,d=Number(u[0]?.armed_ms??0),f=await c({sql:i,targetOwnerId:e.targetOwnerId,sinceMs:d}),{breach:p}=a({spendCents:f,capCents:r});return p&&await l(i,e.routineId,`cost-cap breached: ${f}¢ > ${r}¢ (cumulative since arm)`),{breach:p,spendCents:f,capCents:r}}var l=e((()=>{n(),r()}));export{c as n,l as r,s as t};