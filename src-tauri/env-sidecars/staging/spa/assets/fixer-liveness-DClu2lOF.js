import{n as l}from"./chunk-ChpBd9eV.js";import{i as o,n as c}from"./liveness-CJbX_ngm.js";function f(e){return typeof e=="string"&&/(?:produced no turn|before producing a turn|before (?:the agent|it) produced a turn)/i.test(e)}function u(e){const a=typeof e.candidate=="string"?e.candidate.slice(0,12):null,n=(e.failingTests??[]).filter(i=>typeof i=="string").slice(0,20),t=e.errorMessage.slice(-1600),s=/timedOut=true|timed out before/i.test(e.errorMessage);return JSON.stringify({kind:"release-fixer-no-turn",harness_slug:e.installSlug,workspace_id:e.workspaceId,spawnId:e.spawnId,candidate:a,failingTests:n,timedOut:s,emitted_at:e.nowMs??Date.now(),detail:`release-fixer ${e.spawnId} produced no turn${s?" before the invoke timeout expired":""}; the release gate remains red and this launch did not provide a diagnosis. Inspect the launcher termination record plus account/gateway telemetry, then allow the liveness-aware dispatcher to send a fresh fixer after the cause is understood.`,errorMessage:t})}async function _(e,a){try{const n=await e`
      SELECT escalation FROM harness_shared.harness_escalations
        WHERE harness_slug = ${a.installSlug} AND phase = ${r}
        LIMIT 1
    `;return await e`
      INSERT INTO harness_shared.harness_escalations (harness_slug, phase, escalation, mtime_ms, workspace_id)
      VALUES (${a.installSlug}, ${r}, ${u(a)}, ${a.nowMs??Date.now()}, ${a.workspaceId})
      ON CONFLICT (harness_slug, phase)
      DO UPDATE SET escalation = EXCLUDED.escalation, mtime_ms = EXCLUDED.mtime_ms
    `,!n[0]?.escalation}catch(n){return console.warn(`[release-fixer] no-turn escalation write failed (${a.installSlug}/${a.spawnId}): ${n instanceof Error?n.message:String(n)}`),!1}}async function g(e,a){if(!a)return null;const n=Math.max(1,Math.round(c/1e3));try{return(await e.unsafe(`SELECT 1 FROM harness_shared.spawned_agents
        WHERE spawn_id = $1 AND status IN ('running','restarting')
          AND heartbeat_at IS NOT NULL AND (now() - heartbeat_at) < make_interval(secs => $2)
        LIMIT 1`,[a,n])).length>0}catch{return null}}var r,m=l((()=>{o(),r="green-checkpoint-release-fixer-no-turn"}));export{g as a,_ as i,m as n,f as r,r as t};
