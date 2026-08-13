import{n as r}from"./chunk-ChpBd9eV.js";import{st as n,t as i}from"./src-BmBNODK0.js";import{i as o,n as d,t as s}from"./src-rhu3PqlJ.js";import{a as u,o as c}from"./durable-BsxedNjo.js";async function l(e){const{sql:a}=n();return(await a`
    INSERT INTO harness_shared.event_reactions
      (dedup_id, workspace_id, rule_id, fire, trigger_tool, cause_root_run_id, depth, status)
    VALUES (
      ${e.dedupId}, ${e.workspaceId}, ${e.ruleId}, ${e.fire},
      ${e.triggerTool??null}, ${e.causeRootRunId??null}, ${e.depth}, 'fired'
    )
    ON CONFLICT (dedup_id) DO NOTHING
    RETURNING dedup_id
  `).length>0}async function _(e){const{sql:a}=n();await a`DELETE FROM harness_shared.event_reactions WHERE dedup_id = ${e}`}async function p(e,a){const{sql:t}=n();await t`
    UPDATE harness_shared.event_reactions
       SET status = 'failed', error_message = ${a}
     WHERE dedup_id = ${e}
  `}var I=r((()=>{i()}));async function m(e){await d(e,{store:{claim:l,release:_,markFailed:p},fire:a=>u({fire:a.fire,args:a.args,parentCtx:{...a.parent},cause:a.cause,capability:a.capability}),log:a=>console.warn(`[events] ${a}`)})}var v=r((()=>{s(),c(),I()}));function k(e){return{workspaceId:e.workspaceId??e.principal?.workspaceId,harnessSlug:e.harnessSlug,role:e.role,featureId:e.featureId??null,chunkId:e.chunkId??null,spawnId:e.spawnId,uiClientId:e.uiClientId??null}}function T(e){return o({rule:e.rule,event:e.event,cause:e.cause,rootRunId:e.event.ctx.runId})}var N=r((()=>{s()}));export{v as a,m as i,N as n,I as o,k as r,T as t};
