import{n as _}from"./chunk-ChpBd9eV.js";import{st as t,t as h}from"./src-8fWtxfEz.js";import{i as $,t as A}from"./pot-membership-D8k_NGoV.js";import{n as o,r as g}from"./arm-plan-schedule-Cu88afrQ.js";import{l as N,n as D}from"./runs-BxPIbJMK.js";async function R(s){const a=(await(s.sql??t().sql)`
    SELECT COALESCE(SUM(aus.cost_usd), 0)::float8 AS cost_usd
      FROM harness_shared.harness_features_consolidated wi
      JOIN harness_shared.spawned_agents sa
        ON sa.harness_slug = wi.harness_slug AND sa.feature_id = wi.feature_id
      JOIN harness_shared.agent_usage_samples aus
        ON aus.harness_slug = sa.harness_slug AND aus.run_id = sa.run_id
     WHERE wi.harness_slug = ${s.harnessSlug}
       AND wi.payload -> 'plan_run' ->> 'runId' = ${String(s.runId)}
  `)[0]?.cost_usd??0;return Math.round(a*100)}async function m(s,a,l){const e=(await s`
    SELECT (schedule ->> 'costCapCents')::int AS cap
      FROM harness_shared.harness_plans
     WHERE harness_slug = ${a} AND plan_slug = ${l}`)[0]?.cap;return e!=null&&Number.isFinite(e)&&e>0?e:null}async function C(s){const a=s.sql??t().sql,l=await a`
    SELECT workspace_id, schedule_active FROM harness_shared.harness_plans
     WHERE harness_slug = ${s.harnessSlug} AND plan_slug = ${s.planSlug}`;if(!l[0]||!l[0].schedule_active)return{paused:!1,costCents:0,capCents:null};const e=await m(a,s.harnessSlug,s.planSlug);if(e==null)return{paused:!1,costCents:0,capCents:null};const n=await R({sql:a,harnessSlug:s.harnessSlug,runId:s.runId});return n<=e?{paused:!1,costCents:n,capCents:e}:(await o({sql:a,workspaceId:l[0].workspace_id,harnessSlug:s.harnessSlug,templateSlug:s.planSlug}),console.warn(`[plan-run] auto-paused schedule '${s.planSlug}' (${s.harnessSlug}) — run #${s.runId} cost ${n}¢ exceeded cap ${e}¢`),{paused:!0,costCents:n,capCents:e})}var I=_((()=>{h(),g()}));async function q(s={}){const a=s.sql??t().sql,l=await a`
    SELECT id, harness_slug, plan_slug, workspace_id, instance_plan_slug
      FROM harness_shared.plan_runs
     WHERE run_type = 'scheduled' AND status = 'running' ${s.harnessSlug?a`AND harness_slug = ${s.harnessSlug}`:a``}
  `,e=[];for(const n of l){const u=await a`
      SELECT status FROM harness_shared.harness_features_consolidated
       WHERE harness_slug = ${n.harness_slug}
         AND payload -> 'plan_run' ->> 'runId' = ${String(n.id)}
    `;if(u.length>0&&!u.every(r=>p.includes(r.status)))continue;const d=u.filter(r=>S.includes(r.status)).length,E=u.filter(r=>f.includes(r.status)).length,i=u.length===0||E===0?"success":d===0?"failed":"partial",w=i==="failed"?"failed":"done",c=Date.now();if(n.instance_plan_slug){const r=await $(n.harness_slug,n.workspace_id);await a`
        UPDATE harness_shared.harness_plans
           SET status = 'superseded'
         WHERE workspace_id = ${n.workspace_id}
           AND harness_slug = ${r}
           AND plan_slug = ${n.instance_plan_slug}
           AND template_slug = ${n.plan_slug}
           AND status = 'active'
      `}await a`
      UPDATE harness_shared.plan_runs
         SET status = ${w}, outcome = ${i}, finished_at = ${c}, updated_at = ${c}
       WHERE id = ${n.id}
    `,e.push({runId:n.id,harnessSlug:n.harness_slug,planSlug:n.plan_slug,outcome:i})}return{reconciled:e.length,settled:e}}async function O(s={}){const a=s.sql??t().sql,l=s.now??Date.now(),e=s.harnessSlug?a`AND harness_slug = ${s.harnessSlug}`:a``;return{failed:(await a`
    UPDATE harness_shared.plan_runs
       SET status = 'failed', updated_at = ${l}
     WHERE run_type = 'scheduled'
       AND status = 'running'
       AND updated_at < ${l-D} ${e}
    RETURNING id
  `).length}}async function T(s){const a=s.sql??t().sql,l=s.k??3,e=await a`
    SELECT workspace_id, schedule_active FROM harness_shared.harness_plans
     WHERE harness_slug = ${s.harnessSlug} AND plan_slug = ${s.planSlug}`;if(!e[0]||!e[0].schedule_active)return{paused:!1,failures:0};const n=await a`
    SELECT outcome FROM harness_shared.plan_runs
     WHERE harness_slug = ${s.harnessSlug} AND plan_slug = ${s.planSlug}
       AND run_type = 'scheduled' AND status IN ('done', 'failed')
     ORDER BY launched_at DESC
     LIMIT ${l}`,u=n.filter(d=>d.outcome==="failed").length;return n.length>=l&&u===l?(await o({sql:a,workspaceId:e[0].workspace_id,harnessSlug:s.harnessSlug,templateSlug:s.planSlug}),console.warn(`[plan-run] auto-paused schedule '${s.planSlug}' (${s.harnessSlug}) — ${l} consecutive failed runs`),{paused:!0,failures:u}):{paused:!1,failures:u}}async function W(s={}){const a=s.sql??t().sql,{settled:l}=await q({sql:a,harnessSlug:s.harnessSlug}),e=[];for(const u of l){if((await C({sql:a,harnessSlug:u.harnessSlug,planSlug:u.planSlug,runId:u.runId})).paused){e.push(u.planSlug);continue}u.outcome==="failed"&&(await T({sql:a,harnessSlug:u.harnessSlug,planSlug:u.planSlug,k:s.failureStreakK})).paused&&e.push(u.planSlug)}const n=await O({sql:a,harnessSlug:s.harnessSlug});return{reconciled:l.length,paused:e,orphaned:n.failed}}var p,S,f,k,L=_((()=>{h(),g(),I(),A(),N(),p=["passed","done","resolved","closed","deprecated","dropped","failed"],S=["passed","done","resolved","closed"],f=["failed","dropped","deprecated"],k=3}));L();export{W as reconcileAndGovern};
