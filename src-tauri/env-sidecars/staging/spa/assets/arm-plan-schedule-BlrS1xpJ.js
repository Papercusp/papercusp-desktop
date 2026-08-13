import{n as t}from"./chunk-ChpBd9eV.js";import{st as r,t as c}from"./src-BmBNODK0.js";import{n,r as d,t as o}from"./materialize-plan-schedule-g9TowFEm.js";async function m(e){if(!e.schedule&&!e.scheduledAt)return{ok:!1,reason:"not_scheduled"};const s=e.sql??r().sql,{workspaceId:a}=e;await s`
    UPDATE harness_shared.harness_plans
       SET schedule_active = true, updated_at = now()
     WHERE workspace_id = ${a} AND harness_slug = ${e.harnessSlug}
       AND plan_slug = ${e.templateSlug}
  `;const l=await d({sql:s,workspaceId:a,harnessSlug:e.harnessSlug,templateSlug:e.templateSlug,schedule:e.schedule??void 0,scheduledAt:e.scheduledAt?new Date(e.scheduledAt):void 0,concurrency:e.concurrency,active:!0});return{ok:!0,routineId:l.id,nextFireAt:l.nextFireAt}}async function g(e){const s=e.sql??r().sql,{workspaceId:a}=e;return await s`
    UPDATE harness_shared.harness_plans
       SET schedule_active = false, updated_at = now()
     WHERE workspace_id = ${a} AND harness_slug = ${e.harnessSlug}
       AND plan_slug = ${e.templateSlug}
  `,await o(e.harnessSlug,e.templateSlug,{sql:s}),{ok:!0}}var S=t((()=>{c(),n()}));export{g as n,S as r,m as t};
