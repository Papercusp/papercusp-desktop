import{n as _}from"./chunk-ChpBd9eV.js";import{st as t,t as o}from"./src-BmBNODK0.js";import{i as $,t as A}from"./pot-membership-_CBaMRYQ.js";import{n as h,r as g}from"./arm-plan-schedule-BlrS1xpJ.js";async function m(s){const e=(await(s.sql??t().sql)`
    SELECT COALESCE(SUM(aus.cost_usd), 0)::float8 AS cost_usd
      FROM harness_shared.harness_features_consolidated wi
      JOIN harness_shared.spawned_agents sa
        ON sa.harness_slug = wi.harness_slug AND sa.feature_id = wi.feature_id
      JOIN harness_shared.agent_usage_samples aus
        ON aus.harness_slug = sa.harness_slug AND aus.run_id = sa.run_id
     WHERE wi.harness_slug = ${s.harnessSlug}
       AND wi.payload -> 'plan_run' ->> 'runId' = ${String(s.runId)}
  `)[0]?.cost_usd??0;return Math.round(e*100)}async function C(s,e,l){const n=(await s`
    SELECT (schedule ->> 'costCapCents')::int AS cap
      FROM harness_shared.harness_plans
     WHERE harness_slug = ${e} AND plan_slug = ${l}`)[0]?.cap;return n!=null&&Number.isFinite(n)&&n>0?n:null}async function D(s){const e=s.sql??t().sql,l=await e`
    SELECT workspace_id, schedule_active FROM harness_shared.harness_plans
     WHERE harness_slug = ${s.harnessSlug} AND plan_slug = ${s.planSlug}`;if(!l[0]||!l[0].schedule_active)return{paused:!1,costCents:0,capCents:null};const n=await C(e,s.harnessSlug,s.planSlug);if(n==null)return{paused:!1,costCents:0,capCents:null};const a=await m({sql:e,harnessSlug:s.harnessSlug,runId:s.runId});return a<=n?{paused:!1,costCents:a,capCents:n}:(await h({sql:e,workspaceId:l[0].workspace_id,harnessSlug:s.harnessSlug,templateSlug:s.planSlug}),console.warn(`[plan-run] auto-paused schedule '${s.planSlug}' (${s.harnessSlug}) — run #${s.runId} cost ${a}¢ exceeded cap ${n}¢`),{paused:!0,costCents:a,capCents:n})}var N=_((()=>{o(),g()}));async function R(s={}){const e=s.sql??t().sql,l=await e`
    SELECT id, harness_slug, plan_slug, workspace_id, instance_plan_slug
      FROM harness_shared.plan_runs
     WHERE run_type = 'scheduled' AND status = 'running' ${s.harnessSlug?e`AND harness_slug = ${s.harnessSlug}`:e``}
  `,n=[];for(const a of l){const u=await e`
      SELECT status FROM harness_shared.harness_features_consolidated
       WHERE harness_slug = ${a.harness_slug}
         AND payload -> 'plan_run' ->> 'runId' = ${String(a.id)}
    `;if(u.length>0&&!u.every(r=>p.includes(r.status)))continue;const d=u.filter(r=>S.includes(r.status)).length,E=u.filter(r=>f.includes(r.status)).length,i=u.length===0||E===0?"success":d===0?"failed":"partial",w=i==="failed"?"failed":"done",c=Date.now();if(a.instance_plan_slug){const r=await $(a.harness_slug,a.workspace_id);await e`
        UPDATE harness_shared.harness_plans
           SET status = 'superseded'
         WHERE workspace_id = ${a.workspace_id}
           AND harness_slug = ${r}
           AND plan_slug = ${a.instance_plan_slug}
           AND template_slug = ${a.plan_slug}
           AND status = 'active'
      `}await e`
      UPDATE harness_shared.plan_runs
         SET status = ${w}, outcome = ${i}, finished_at = ${c}, updated_at = ${c}
       WHERE id = ${a.id}
    `,n.push({runId:a.id,harnessSlug:a.harness_slug,planSlug:a.plan_slug,outcome:i})}return{reconciled:n.length,settled:n}}async function I(s){const e=s.sql??t().sql,l=s.k??3,n=await e`
    SELECT workspace_id, schedule_active FROM harness_shared.harness_plans
     WHERE harness_slug = ${s.harnessSlug} AND plan_slug = ${s.planSlug}`;if(!n[0]||!n[0].schedule_active)return{paused:!1,failures:0};const a=await e`
    SELECT outcome FROM harness_shared.plan_runs
     WHERE harness_slug = ${s.harnessSlug} AND plan_slug = ${s.planSlug}
       AND run_type = 'scheduled' AND status IN ('done', 'failed')
     ORDER BY launched_at DESC
     LIMIT ${l}`,u=a.filter(d=>d.outcome==="failed").length;return a.length>=l&&u===l?(await h({sql:e,workspaceId:n[0].workspace_id,harnessSlug:s.harnessSlug,templateSlug:s.planSlug}),console.warn(`[plan-run] auto-paused schedule '${s.planSlug}' (${s.harnessSlug}) — ${l} consecutive failed runs`),{paused:!0,failures:u}):{paused:!1,failures:u}}async function M(s={}){const e=s.sql??t().sql,{settled:l}=await R({sql:e,harnessSlug:s.harnessSlug}),n=[];for(const a of l){if((await D({sql:e,harnessSlug:a.harnessSlug,planSlug:a.planSlug,runId:a.runId})).paused){n.push(a.planSlug);continue}a.outcome==="failed"&&(await I({sql:e,harnessSlug:a.harnessSlug,planSlug:a.planSlug,k:s.failureStreakK})).paused&&n.push(a.planSlug)}return{reconciled:l.length,paused:n}}var p,S,f,q,O=_((()=>{o(),g(),N(),A(),p=["passed","done","resolved","closed","deprecated","dropped","failed"],S=["passed","done","resolved","closed"],f=["failed","dropped","deprecated"],q=3}));O();export{M as reconcileAndGovern};
