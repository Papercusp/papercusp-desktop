import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-BvZp-r10.js";import{n as r,s as i}from"./workspace-registry-Bu1Yy540.js";import{n as a,t as o}from"./materialize-plan-schedule-DXSDbslQ.js";async function s(e){let n=e.sql??t().sql;return await n`
    UPDATE harness_shared.harness_plans
       SET schedule_active = false, updated_at = now()
     WHERE workspace_id = ${e.workspaceId??r()} AND harness_slug = ${e.harnessSlug}
       AND plan_slug = ${e.templateSlug}
  `,await o(e.harnessSlug,e.templateSlug,{sql:n}),{ok:!0}}var c=e((()=>{n(),i(),a()}));async function l(e){let n=(await(e.sql??t().sql)`
    SELECT COALESCE(SUM(aus.cost_usd), 0)::float8 AS cost_usd
      FROM harness_shared.harness_features_consolidated wi
      JOIN harness_shared.spawned_agents sa
        ON sa.harness_slug = wi.harness_slug AND sa.feature_id = wi.feature_id
      JOIN harness_shared.agent_usage_samples aus
        ON aus.harness_slug = sa.harness_slug AND aus.run_id = sa.run_id
     WHERE wi.harness_slug = ${e.harnessSlug}
       AND wi.payload -> 'plan_run' ->> 'runId' = ${String(e.runId)}
  `)[0]?.cost_usd??0;return Math.round(n*100)}async function u(e,t,n){let r=(await e`
    SELECT (schedule ->> 'costCapCents')::int AS cap
      FROM harness_shared.harness_plans
     WHERE harness_slug = ${t} AND plan_slug = ${n}`)[0]?.cap;return r!=null&&Number.isFinite(r)&&r>0?r:null}async function d(e){let n=e.sql??t().sql,r=await n`
    SELECT workspace_id, schedule_active FROM harness_shared.harness_plans
     WHERE harness_slug = ${e.harnessSlug} AND plan_slug = ${e.planSlug}`;if(!r[0]||!r[0].schedule_active)return{paused:!1,costCents:0,capCents:null};let i=await u(n,e.harnessSlug,e.planSlug);if(i==null)return{paused:!1,costCents:0,capCents:null};let a=await l({sql:n,harnessSlug:e.harnessSlug,runId:e.runId});return a<=i?{paused:!1,costCents:a,capCents:i}:(await s({sql:n,workspaceId:r[0].workspace_id,harnessSlug:e.harnessSlug,templateSlug:e.planSlug}),console.warn(`[plan-run] auto-paused schedule '${e.planSlug}' (${e.harnessSlug}) — run #${e.runId} cost ${a}¢ exceeded cap ${i}¢`),{paused:!0,costCents:a,capCents:i})}var f=e((()=>{n(),c()}));async function p(e={}){let n=e.sql??t().sql,r=await n`
    SELECT id, harness_slug, plan_slug
      FROM harness_shared.plan_runs
     WHERE run_type = 'scheduled' AND status = 'running' ${e.harnessSlug?n`AND harness_slug = ${e.harnessSlug}`:n``}
  `,i=[];for(let e of r){let t=await n`
      SELECT status FROM harness_shared.harness_features_consolidated
       WHERE harness_slug = ${e.harness_slug}
         AND payload -> 'plan_run' ->> 'runId' = ${String(e.id)}
    `;if(t.length>0&&!t.every(e=>g.includes(e.status)))continue;let r=t.filter(e=>_.includes(e.status)).length,a=t.filter(e=>v.includes(e.status)).length,o=t.length===0||a===0?`success`:r===0?`failed`:`partial`,s=o===`failed`?`failed`:`done`,c=Date.now();await n`
      UPDATE harness_shared.plan_runs
         SET status = ${s}, outcome = ${o}, finished_at = ${c}, updated_at = ${c}
       WHERE id = ${e.id}
    `,i.push({runId:e.id,harnessSlug:e.harness_slug,planSlug:e.plan_slug,outcome:o})}return{reconciled:i.length,settled:i}}async function m(e){let n=e.sql??t().sql,r=e.k??3,i=await n`
    SELECT workspace_id, schedule_active FROM harness_shared.harness_plans
     WHERE harness_slug = ${e.harnessSlug} AND plan_slug = ${e.planSlug}`;if(!i[0]||!i[0].schedule_active)return{paused:!1,failures:0};let a=await n`
    SELECT outcome FROM harness_shared.plan_runs
     WHERE harness_slug = ${e.harnessSlug} AND plan_slug = ${e.planSlug}
       AND run_type = 'scheduled' AND status IN ('done', 'failed')
     ORDER BY launched_at DESC
     LIMIT ${r}`,o=a.filter(e=>e.outcome===`failed`).length;return a.length>=r&&o===r?(await s({sql:n,workspaceId:i[0].workspace_id,harnessSlug:e.harnessSlug,templateSlug:e.planSlug}),console.warn(`[plan-run] auto-paused schedule '${e.planSlug}' (${e.harnessSlug}) — ${r} consecutive failed runs`),{paused:!0,failures:o}):{paused:!1,failures:o}}async function h(e={}){let n=e.sql??t().sql,{settled:r}=await p({sql:n,harnessSlug:e.harnessSlug}),i=[];for(let t of r){if((await d({sql:n,harnessSlug:t.harnessSlug,planSlug:t.planSlug,runId:t.runId})).paused){i.push(t.planSlug);continue}t.outcome===`failed`&&(await m({sql:n,harnessSlug:t.harnessSlug,planSlug:t.planSlug,k:e.failureStreakK})).paused&&i.push(t.planSlug)}return{reconciled:r.length,paused:i}}var g,_,v;e((()=>{n(),c(),f(),g=[`passed`,`done`,`resolved`,`closed`,`deprecated`,`dropped`,`failed`],_=[`passed`,`done`,`resolved`,`closed`],v=[`failed`,`dropped`,`deprecated`]}))();export{h as reconcileAndGovern};