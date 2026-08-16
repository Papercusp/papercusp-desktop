import{n as c}from"./chunk-ChpBd9eV.js";import{st as d,t as u}from"./src-8fWtxfEz.js";function f(){const r={}.PAPERCUSP_IMPROVEMENT_DISPATCH_OVERDUE_MS;if(r==null||r.trim()==="")return 72e5;const t=Number.parseInt(r.trim(),10);return!Number.isFinite(t)||String(t)!==r.trim()||t<6e4?(console.warn(`[dispatch-ledger] PAPERCUSP_IMPROVEMENT_DISPATCH_OVERDUE_MS="${r}" invalid — using 7200000`),72e5):t}async function h(r){try{const{sql:t}=d();return(await t`
      INSERT INTO harness_shared.improvement_dispatches
        (workspace_id, item_id, attempt, runner_harness, pot_slug)
      VALUES (${r.workspaceId}, ${r.itemId}, ${r.attempt}, ${r.runnerHarness}, ${r.potSlug??null})
      RETURNING id`)[0]?.id??null}catch(t){return console.warn(`[dispatch-ledger] FAILED to record dispatch of ${r.itemId} — the lane is flying blind for this row:`,t instanceof Error?t.message:t),null}}async function E(r,t){try{const{sql:s}=d();t.ok?await s`
        UPDATE harness_shared.improvement_dispatches
           SET fire_result = 'ok', spawned_run_id = ${t.spawnedRunId??null}
         WHERE id = ${r}`:await s`
        UPDATE harness_shared.improvement_dispatches
           SET fire_result = 'error', fire_error = ${t.error},
               outcome = 'fire-failed', resolved_at = now(), resolved_by = 'system'
         WHERE id = ${r}`}catch(s){console.warn(`[dispatch-ledger] FAILED to record fire result on ${r}:`,s instanceof Error?s.message:s)}}async function A(r,t){const{sql:s}=d();return(await s`
    UPDATE harness_shared.improvement_dispatches
       SET outcome = ${t.outcome}, resolved_at = now(), resolved_by = ${t.by??"improvement-runner"}
     WHERE item_id = ${r} AND outcome IS NULL
     RETURNING id`).length}async function v(r,t="orphaned-dispatch-collector",s){const{sql:o}=d();return(await o`
    UPDATE harness_shared.improvement_dispatches
       SET outcome = 'orphaned', resolved_at = now(), resolved_by = ${t},
           fire_error = COALESCE(${s??null}, fire_error)
     WHERE id = ${r} AND outcome IS NULL
     RETURNING id`).length>0}async function N(r,t={}){const{sql:s}=d(),o=await s`
    SELECT id, workspace_id, item_id, attempt, runner_harness, fired_at,
           fire_result, fire_error, spawned_run_id, outcome, resolved_at, resolved_by
      FROM harness_shared.improvement_dispatches
     WHERE workspace_id = ${r}
     ORDER BY fired_at DESC
     LIMIT ${Math.min(Math.max(1,t.limit??200),1e3)}`,n=e=>e==null?null:e instanceof Date?e.toISOString():new Date(e).toISOString();return o.map(e=>({id:e.id,workspaceId:e.workspace_id,itemId:e.item_id,attempt:Number(e.attempt)||1,runnerHarness:e.runner_harness,firedAt:n(e.fired_at),fireResult:e.fire_result==="ok"||e.fire_result==="error"?e.fire_result:"pending",fireError:e.fire_error,spawnedRunId:e.spawned_run_id,outcome:e.outcome??null,resolvedAt:n(e.resolved_at),resolvedBy:e.resolved_by}))}function w(r,t={}){const s=t.nowMs??Date.now(),o=t.overdueAfterMs??f(),n=s-10080*60*1e3,e={total:r.length,fired7d:0,firing:0,inProgress:0,overdue:0,fireFailed:0,orphaned:0,resolved:{fixed:0,couldNotFix:0,needsHuman:0},fixed7d:0,lastDispatchAt:null,lastOutcomeAt:null};for(const i of r){const a=Date.parse(i.firedAt);if(!Number.isNaN(a)&&a>=n&&a<=s&&(e.fired7d+=1),(e.lastDispatchAt===null||i.firedAt>e.lastDispatchAt)&&(e.lastDispatchAt=i.firedAt),i.resolvedAt&&(e.lastOutcomeAt===null||i.resolvedAt>e.lastOutcomeAt)&&(e.lastOutcomeAt=i.resolvedAt),i.outcome==="fixed"){e.resolved.fixed+=1;const l=i.resolvedAt?Date.parse(i.resolvedAt):NaN;!Number.isNaN(l)&&l>=n&&l<=s&&(e.fixed7d+=1)}else i.outcome==="could-not-fix"?e.resolved.couldNotFix+=1:i.outcome==="needs-human"?e.resolved.needsHuman+=1:i.outcome==="fire-failed"?e.fireFailed+=1:i.outcome==="orphaned"?e.orphaned+=1:(Number.isNaN(a)?Number.POSITIVE_INFINITY:s-a)>o?e.overdue+=1:i.fireResult==="pending"?e.firing+=1:e.inProgress+=1}return e}var I=c((()=>{u()}));export{v as a,E as c,I as i,w as n,N as o,f as r,h as s,A as t};
