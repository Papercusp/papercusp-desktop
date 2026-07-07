import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,r as n,t as r}from"./dbos-browser-CrwG_udJ.js";import{q as i,t as a}from"./src-DTtGQmae.js";import{a as o,i as s,n as c,o as l}from"./durable-B2uvgZAf.js";import{i as u,n as d,t as f}from"./src-CdvH5tWp.js";import{n as p,t as m}from"./queue-concurrency-MJ_-_-Ak.js";async function h(e){let{sql:t}=i();return(await t`
    INSERT INTO harness_shared.event_reactions
      (dedup_id, workspace_id, rule_id, fire, trigger_tool, cause_root_run_id, depth, status)
    VALUES (
      ${e.dedupId}, ${e.workspaceId}, ${e.ruleId}, ${e.fire},
      ${e.triggerTool??null}, ${e.causeRootRunId??null}, ${e.depth}, 'fired'
    )
    ON CONFLICT (dedup_id) DO NOTHING
    RETURNING dedup_id
  `).length>0}async function g(e){let{sql:t}=i();await t`DELETE FROM harness_shared.event_reactions WHERE dedup_id = ${e}`}async function _(e,t){let{sql:n}=i();await n`
    UPDATE harness_shared.event_reactions
       SET status = 'failed', error_message = ${t}
     WHERE dedup_id = ${e}
  `}var v=e((()=>{a()}));async function y(e){await d(e,{store:{claim:h,release:g,markFailed:_},fire:e=>o({fire:e.fire,args:e.args,parentCtx:{...e.parent},cause:e.cause,capability:e.capability}),log:e=>console.warn(`[events] ${e}`)})}var b=e((()=>{f(),l(),v()}));function x(e){return{workspaceId:e.workspaceId??e.principal?.workspaceId,harnessSlug:e.harnessSlug,role:e.role,featureId:e.featureId??null,chunkId:e.chunkId??null,spawnId:e.spawnId,uiClientId:e.uiClientId??null}}function S(e){return u({rule:e.rule,event:e.event,cause:e.cause,rootRunId:e.event.ctx.runId})}var C=e((()=>{f()}));async function w(e){await r.runStep(()=>y(e),{name:`react:${e.fire}`,retriesAllowed:!0,maxAttempts:3,intervalSeconds:2,backoffRate:2})}async function T(e){let t=S(e),n={fire:e.fire,args:e.args,parent:x(e.event.ctx),cause:e.cause,ruleId:e.rule.id,triggerTool:e.event.tool,dedupId:t,capability:e.rule.capability};await r.startWorkflow(D,{workflowID:`reaction:${t}`,queueName:O.name,enqueueOptions:{deduplicationID:t}})(n)}function E(){s(T)}var D,O;e((()=>{n(),m(),b(),c(),C(),D=r.registerWorkflow(w,{name:`eventReaction`,maxRecoveryAttempts:5}),O=new t(`event-reactions`,{concurrency:p(4)})}))();export{E as wireDurableReactions};