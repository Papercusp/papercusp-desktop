import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CgbVJkBN.js";function r(){let e={}.PAPERCUSP_IMPROVEMENT_DISPATCH_OVERDUE_MS;if(e==null||e.trim()===``)return 72e5;let t=Number.parseInt(e.trim(),10);return!Number.isFinite(t)||String(t)!==e.trim()||t<6e4?(console.warn(`[dispatch-ledger] PAPERCUSP_IMPROVEMENT_DISPATCH_OVERDUE_MS="${e}" invalid — using 7200000`),72e5):t}async function i(e){try{let{sql:n}=t();return(await n`
      INSERT INTO harness_shared.improvement_dispatches
        (workspace_id, item_id, attempt, runner_harness, pot_slug)
      VALUES (${e.workspaceId}, ${e.itemId}, ${e.attempt}, ${e.runnerHarness}, ${e.potSlug??null})
      RETURNING id`)[0]?.id??null}catch(t){return console.warn(`[dispatch-ledger] FAILED to record dispatch of ${e.itemId} — the lane is flying blind for this row:`,t instanceof Error?t.message:t),null}}async function a(e,n){try{let{sql:r}=t();n.ok?await r`
        UPDATE harness_shared.improvement_dispatches
           SET fire_result = 'ok', spawned_run_id = ${n.spawnedRunId??null}
         WHERE id = ${e}`:await r`
        UPDATE harness_shared.improvement_dispatches
           SET fire_result = 'error', fire_error = ${n.error},
               outcome = 'fire-failed', resolved_at = now(), resolved_by = 'system'
         WHERE id = ${e}`}catch(t){console.warn(`[dispatch-ledger] FAILED to record fire result on ${e}:`,t instanceof Error?t.message:t)}}async function o(e,n){let{sql:r}=t();return(await r`
    UPDATE harness_shared.improvement_dispatches
       SET outcome = ${n.outcome}, resolved_at = now(), resolved_by = ${n.by??`improvement-runner`}
     WHERE item_id = ${e} AND outcome IS NULL
     RETURNING id`).length}async function s(e,n=`orphaned-dispatch-collector`,r){let{sql:i}=t();return(await i`
    UPDATE harness_shared.improvement_dispatches
       SET outcome = 'orphaned', resolved_at = now(), resolved_by = ${n},
           fire_error = COALESCE(${r??null}, fire_error)
     WHERE id = ${e} AND outcome IS NULL
     RETURNING id`).length>0}async function c(e,n={}){let{sql:r}=t(),i=await r`
    SELECT id, workspace_id, item_id, attempt, runner_harness, fired_at,
           fire_result, fire_error, spawned_run_id, outcome, resolved_at, resolved_by
      FROM harness_shared.improvement_dispatches
     WHERE workspace_id = ${e}
     ORDER BY fired_at DESC
     LIMIT ${Math.min(Math.max(1,n.limit??200),1e3)}`,a=e=>e==null?null:e instanceof Date?e.toISOString():new Date(e).toISOString();return i.map(e=>({id:e.id,workspaceId:e.workspace_id,itemId:e.item_id,attempt:Number(e.attempt)||1,runnerHarness:e.runner_harness,firedAt:a(e.fired_at),fireResult:e.fire_result===`ok`||e.fire_result===`error`?e.fire_result:`pending`,fireError:e.fire_error,spawnedRunId:e.spawned_run_id,outcome:e.outcome??null,resolvedAt:a(e.resolved_at),resolvedBy:e.resolved_by}))}function l(e,t={}){let n=t.nowMs??Date.now(),i=t.overdueAfterMs??r(),a=n-10080*60*1e3,o={total:e.length,fired7d:0,firing:0,inProgress:0,overdue:0,fireFailed:0,orphaned:0,resolved:{fixed:0,couldNotFix:0,needsHuman:0},fixed7d:0,lastDispatchAt:null,lastOutcomeAt:null};for(let t of e){let e=Date.parse(t.firedAt);if(!Number.isNaN(e)&&e>=a&&e<=n&&(o.fired7d+=1),(o.lastDispatchAt===null||t.firedAt>o.lastDispatchAt)&&(o.lastDispatchAt=t.firedAt),t.resolvedAt&&(o.lastOutcomeAt===null||t.resolvedAt>o.lastOutcomeAt)&&(o.lastOutcomeAt=t.resolvedAt),t.outcome===`fixed`){o.resolved.fixed+=1;let e=t.resolvedAt?Date.parse(t.resolvedAt):NaN;!Number.isNaN(e)&&e>=a&&e<=n&&(o.fixed7d+=1)}else t.outcome===`could-not-fix`?o.resolved.couldNotFix+=1:t.outcome===`needs-human`?o.resolved.needsHuman+=1:t.outcome===`fire-failed`?o.fireFailed+=1:t.outcome===`orphaned`?o.orphaned+=1:(Number.isNaN(e)?1/0:n-e)>i?o.overdue+=1:t.fireResult===`pending`?o.firing+=1:o.inProgress+=1}return o}var u=e((()=>{n()}));export{s as a,a as c,u as i,l as n,c as o,r,i as s,o as t};