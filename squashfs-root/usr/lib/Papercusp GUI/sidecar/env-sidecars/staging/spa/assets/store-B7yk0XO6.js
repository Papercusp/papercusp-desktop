import{n as e}from"./chunk-CMxvf4Kt.js";function t(e){return e.budgetUsd===null?null:e.budgetKind===`per-cycle`?e.budgetUsd:e.budgetUsd-e.spentUsd}function n(e,n=s){if(!e)return{allow:!1,reason:`unregistered`,remainingUsd:null};if(!e.enabled)return{allow:!1,reason:`disabled`,remainingUsd:t(e)};if(e.budgetUsd===null)return{allow:!1,reason:`unbudgeted`,remainingUsd:null};let r=t(e);return e.budgetKind===`per-cycle`?{allow:!0,remainingUsd:r}:r<=n?{allow:!1,reason:`exhausted`,remainingUsd:r}:{allow:!0,remainingUsd:r}}function r(e){return`gym:${e}`}function i(e){return`blender:${e}`}function a(e){return{workspaceId:e.workspaceId,loopId:r(e.harnessSlug),displayName:`Gym autoloop (${e.harnessSlug})`,budgetKind:`lifetime`,budgetUsd:e.budgetUsd,spentUsd:e.spentUsd,priority:50,enabled:e.enabled,enforcement:`native`}}function o(e){return{workspaceId:e.workspaceId,loopId:i(e.harnessSlug),displayName:`Scout cadence (${e.harnessSlug})`,budgetKind:`per-cycle`,budgetUsd:e.perCycleBudgetUsd,priority:60,enabled:!0,enforcement:`native`}}var s,c=e((()=>{s=.5}));function l(e){return{workspaceId:_(e.workspace_id),loopId:_(e.loop_id),displayName:_(e.display_name),budgetKind:_(e.budget_kind),budgetUsd:y(e.budget_usd),spentUsd:Number(e.spent_usd??0),priority:Number(e.priority??100),enabled:e.enabled===!0||e.enabled===`t`,enforcement:_(e.enforcement),meta:e.meta??null,registeredAt:b(e.registered_at),updatedAt:b(e.updated_at)}}function u(e){return{id:_(e.id),workspaceId:_(e.workspace_id),loopId:_(e.loop_id),costUsd:Number(e.cost_usd),signalOrigin:_(e.signal_origin),runRef:v(e.run_ref),note:v(e.note),createdAt:b(e.created_at)}}async function d(e,t){let n=await f(e,{workspaceId:t.workspaceId,loopId:t.loopId}),r={workspaceId:t.workspaceId,loopId:t.loopId,displayName:t.displayName??n?.displayName??t.loopId,budgetKind:t.budgetKind??n?.budgetKind??`lifetime`,budgetUsd:t.budgetUsd===void 0?n?.budgetUsd??null:t.budgetUsd,spentUsd:t.spentUsd??n?.spentUsd??0,priority:t.priority??n?.priority??100,enabled:t.enabled??n?.enabled??!0,enforcement:t.enforcement??n?.enforcement??`governor`,meta:t.meta===void 0?n?.meta??null:t.meta};return l((await e`
    INSERT INTO harness_shared.learning_governor_loops
      (workspace_id, loop_id, display_name, budget_kind, budget_usd, spent_usd, priority, enabled, enforcement, meta)
    VALUES (${r.workspaceId}, ${r.loopId}, ${r.displayName}, ${r.budgetKind}, ${r.budgetUsd},
      ${r.spentUsd}, ${r.priority}, ${r.enabled}, ${r.enforcement}, ${r.meta})
    ON CONFLICT (workspace_id, loop_id) DO UPDATE SET
      display_name = EXCLUDED.display_name, budget_kind = EXCLUDED.budget_kind, budget_usd = EXCLUDED.budget_usd,
      spent_usd = EXCLUDED.spent_usd, priority = EXCLUDED.priority, enabled = EXCLUDED.enabled,
      enforcement = EXCLUDED.enforcement, meta = EXCLUDED.meta, updated_at = now()
    RETURNING *`)[0])}async function f(e,t){let n=await e`
    SELECT * FROM harness_shared.learning_governor_loops
     WHERE workspace_id = ${t.workspaceId} AND loop_id = ${t.loopId} LIMIT 1`;return n.length?l(n[0]):null}async function p(e,t){return(await e`
    SELECT * FROM harness_shared.learning_governor_loops
     WHERE workspace_id = ${t.workspaceId}
     ORDER BY priority ASC, loop_id ASC`).map(l)}async function m(e,t){return{deleted:(await e`
    DELETE FROM harness_shared.learning_governor_loops
     WHERE workspace_id = ${t.workspaceId} AND loop_id = ${t.loopId}
     RETURNING loop_id`).length>0}}async function h(e,t){return n(await f(e,{workspaceId:t.workspaceId,loopId:t.loopId}),t.floorUsd??.5)}async function g(e,t){if(!Number.isFinite(t.costUsd)||t.costUsd<0)throw Error(`learning-governor: costUsd must be a non-negative finite number, got ${t.costUsd}`);let n=async e=>{let n=await e`
      INSERT INTO harness_shared.learning_spend_events
        (workspace_id, loop_id, cost_usd, signal_origin, run_ref, note)
      VALUES (${t.workspaceId}, ${t.loopId}, ${t.costUsd}, ${t.signalOrigin??`organic`},
        ${t.runRef??null}, ${t.note??null})
      RETURNING *`;return t.accumulate!==!1&&await e`
        UPDATE harness_shared.learning_governor_loops
           SET spent_usd = spent_usd + ${t.costUsd}, updated_at = now()
         WHERE workspace_id = ${t.workspaceId} AND loop_id = ${t.loopId}`,u(n[0])};return typeof e.begin==`function`?await e.begin(n):n(e)}var _,v,y,b,x=e((()=>{c(),_=e=>String(e),v=e=>e==null?null:String(e),y=e=>e==null?null:Number(e),b=e=>new Date(e).getTime()}));export{g as a,n as c,c as d,i as f,p as i,r as l,h as n,d as o,o as p,x as r,s,m as t,a as u};