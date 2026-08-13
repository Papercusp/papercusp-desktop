import{n as w}from"./chunk-ChpBd9eV.js";import{st as d,t as g}from"./src-BmBNODK0.js";import{i as f,s as E}from"./escalations-CSuTxsbD.js";function m(e,t={}){const s=t.threshold??3,r=e.map((i,u)=>({e:i,i:u})).sort((i,u)=>i.e.ts-u.e.ts||i.i-u.i).map(i=>i.e),a=new Set;let n=0,c;for(const i of r)a.add(i.writer),c!==void 0&&i.writer!==c&&(n+=1),c=i.writer;const o=a.size;return{distinctWriters:o,churnCount:n,steerCount:r.length,writers:[...a].sort(),trip:o>=2&&n>=s}}function S(e){return e==="__local__"?"this Swarm":e==="__remote_unknown__"?"an unattributed remote Swarm":`peer ${e.slice(0,12)}…`}async function $(e){const t=e.now??Date.now(),s=e.windowMs??9e5,r=e.threshold??3,a=e.cooldownMs??9e5,n=e.sql??d().sql,c=t-s,o=m((await n`
    SELECT writer, ts, feature_order
      FROM harness_shared.steering_churn_events
     WHERE workspace_id = ${e.workspaceId}
       AND harness_slug = ${e.harnessSlug}
       AND feature_id = ${e.featureId}
       AND ts >= ${c}
     ORDER BY ts ASC, id ASC`).map(u=>({writer:u.writer,ts:Number(u.ts),featureOrder:u.feature_order})),{threshold:r});if(!o.trip)return{result:o,escalated:!1};const i=t-a;return(await n`
    INSERT INTO harness_shared.steering_churn_escalations
      (workspace_id, harness_slug, feature_id, last_escalated_ts, churn_count)
    VALUES (${e.workspaceId}, ${e.harnessSlug}, ${e.featureId}, ${t}, ${o.churnCount})
    ON CONFLICT (workspace_id, harness_slug, feature_id) DO UPDATE
      SET last_escalated_ts = EXCLUDED.last_escalated_ts,
          churn_count = EXCLUDED.churn_count
      WHERE steering_churn_escalations.last_escalated_ts <= ${i}
    RETURNING last_escalated_ts`).length===0?{result:o,escalated:!1}:(await(e.escalate??h)({workspaceId:e.workspaceId,harnessSlug:e.harnessSlug,featureId:e.featureId,result:o,windowMs:s}),{result:o,escalated:!0})}async function k(e={}){const t=e.now??Date.now(),s=e.windowMs??9e5,r=e.sql??d().sql,a=await r`
    SELECT workspace_id, harness_slug, feature_id
      FROM harness_shared.steering_churn_events
     WHERE ts >= ${t-s}
     GROUP BY workspace_id, harness_slug, feature_id
    HAVING count(DISTINCT writer) >= 2`;let n=0;for(const c of a)(await $({workspaceId:c.workspace_id,harnessSlug:c.harness_slug,featureId:c.feature_id,now:t,windowMs:s,threshold:e.threshold,cooldownMs:e.cooldownMs,sql:r,escalate:e.escalate})).escalated&&(n+=1);return{checked:a.length,escalated:n}}async function O(e={}){const t=e.now??Date.now(),s=e.retentionMs??6048e5;return(await(e.sql??d().sql)`DELETE FROM harness_shared.steering_churn_events WHERE ts < ${t-s}`).count??0}var _,I,N,l,h,C,p=w((()=>{g(),f(),_=15*6e4,I=3,N=_,l={ownerId:"steering-churn-monitor",ownerLabel:"system · steering-churn",source:"principal",workspaceId:null,userId:null},h=async({workspaceId:e,harnessSlug:t,featureId:s,result:r,windowMs:a})=>{const n=Math.round(a/6e4);await E(l,{severity:"advisory",summary:`Steering churn: ${t}/${s} re-steered by ${r.distinctWriters} writers (${r.churnCount} flips) in ${n}m — multi-Mug LWW thrash`,body:`The backlog item ${s} (harness ${t}, workspace ${e}) had its priority (feature_order) re-steered ${r.steerCount}× by ${r.distinctWriters} different writers within ${n} minutes, flipping writer ${r.churnCount} times: ${r.writers.map(S).join(", ")}.

This is the multi-Mug steering tripwire (D-004 @ hive-network-surface-2026-06-11): concurrent steering is unarbitrated last-write-wins on feature_order, and this item is ping-ponging between Queens. If this is sustained, it is the evidence that gates building the single-steerer lease (P-011, revisit condition a). Investigate which Swarms are contending this item; consider pinning it (work_items:co_locate) or building the lease.`,meta:{subjectSignature:`steering-churn:${e}:${t}:${s}`}})},C=10080*6e4}));export{h as a,O as c,$ as i,k as l,C as n,m as o,_ as r,p as s,N as t};
