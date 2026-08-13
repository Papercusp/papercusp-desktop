import{n as u}from"./chunk-ChpBd9eV.js";import{i as _,s as c}from"./core-DRHbIRj9.js";function r(e){return{workspaceId:s(e.workspace_id),loopId:s(e.loop_id),potSlug:d(e.pot_slug),displayName:s(e.display_name),budgetKind:s(e.budget_kind),budgetUsd:p(e.budget_usd),spentUsd:Number(e.spent_usd??0),priority:Number(e.priority??100),enabled:e.enabled===!0||e.enabled==="t",enforcement:s(e.enforcement),meta:e.meta??null,registeredAt:a(e.registered_at),updatedAt:a(e.updated_at)}}function g(e){return{id:s(e.id),workspaceId:s(e.workspace_id),loopId:s(e.loop_id),potSlug:d(e.pot_slug),costUsd:Number(e.cost_usd),signalOrigin:s(e.signal_origin),runRef:d(e.run_ref),note:d(e.note),createdAt:a(e.created_at)}}async function b(e,o){const n=await i(e,{workspaceId:o.workspaceId,loopId:o.loopId}),t={workspaceId:o.workspaceId,loopId:o.loopId,potSlug:o.potSlug!==void 0?o.potSlug:n?.potSlug??null,displayName:o.displayName??n?.displayName??o.loopId,budgetKind:o.budgetKind??n?.budgetKind??"lifetime",budgetUsd:o.budgetUsd!==void 0?o.budgetUsd:n?.budgetUsd??null,spentUsd:o.spentUsd??n?.spentUsd??0,priority:o.priority??n?.priority??100,enabled:o.enabled??n?.enabled??!0,enforcement:o.enforcement??n?.enforcement??"governor",meta:o.meta!==void 0?o.meta:n?.meta??null};return r((await e`
    INSERT INTO harness_shared.learning_governor_loops
      (workspace_id, loop_id, pot_slug, display_name, budget_kind, budget_usd, spent_usd, priority, enabled, enforcement, meta)
    VALUES (${t.workspaceId}, ${t.loopId}, ${t.potSlug}, ${t.displayName}, ${t.budgetKind}, ${t.budgetUsd},
      ${t.spentUsd}, ${t.priority}, ${t.enabled}, ${t.enforcement}, ${t.meta})
    ON CONFLICT (workspace_id, loop_id) DO UPDATE SET
      pot_slug = EXCLUDED.pot_slug,
      display_name = EXCLUDED.display_name, budget_kind = EXCLUDED.budget_kind, budget_usd = EXCLUDED.budget_usd,
      spent_usd = EXCLUDED.spent_usd, priority = EXCLUDED.priority, enabled = EXCLUDED.enabled,
      enforcement = EXCLUDED.enforcement, meta = EXCLUDED.meta, updated_at = now()
    RETURNING *`)[0])}async function i(e,o){const n=await e`
    SELECT * FROM harness_shared.learning_governor_loops
     WHERE workspace_id = ${o.workspaceId} AND loop_id = ${o.loopId} LIMIT 1`;return n.length?r(n[0]):null}async function U(e,o){return(await e`
    SELECT * FROM harness_shared.learning_governor_loops
     WHERE workspace_id = ${o.workspaceId}
     ORDER BY priority ASC, loop_id ASC`).map(r)}async function N(e,o){return{deleted:(await e`
    DELETE FROM harness_shared.learning_governor_loops
     WHERE workspace_id = ${o.workspaceId} AND loop_id = ${o.loopId}
     RETURNING loop_id`).length>0}}async function D(e,o){return _(await i(e,{workspaceId:o.workspaceId,loopId:o.loopId}),o.floorUsd??.5)}async function f(e,o){if(!Number.isFinite(o.costUsd)||o.costUsd<0)throw new Error(`learning-governor: costUsd must be a non-negative finite number, got ${o.costUsd}`);const n=async t=>{const l=await t`
      INSERT INTO harness_shared.learning_spend_events
        (workspace_id, loop_id, pot_slug, cost_usd, signal_origin, run_ref, note)
      VALUES (${o.workspaceId}, ${o.loopId}, ${o.potSlug??null}, ${o.costUsd}, ${o.signalOrigin??"organic"},
        ${o.runRef??null}, ${o.note??null})
      RETURNING *`;return o.accumulate!==!1&&await t`
        UPDATE harness_shared.learning_governor_loops
           SET spent_usd = spent_usd + ${o.costUsd}, updated_at = now()
         WHERE workspace_id = ${o.workspaceId} AND loop_id = ${o.loopId}`,g(l[0])};return typeof e.begin=="function"?await e.begin(n):n(e)}async function L(e,o){const n=(await e`
    SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total, COUNT(DISTINCT loop_id)::int AS loops
      FROM harness_shared.learning_spend_events
     WHERE workspace_id = ${o.workspaceId}
       AND loop_id LIKE ${"blender:%"}
       AND created_at >= ${new Date(o.sinceMs)}`)[0]??{};return{totalUsd:Number(n.total??0),loopCount:Number(n.loops??0)}}var s,d,p,a,S=u((()=>{c(),s=e=>String(e),d=e=>e==null?null:String(e),p=e=>e==null?null:Number(e),a=e=>new Date(e).getTime()}));export{U as a,L as c,S as i,i as n,f as o,D as r,b as s,N as t};
