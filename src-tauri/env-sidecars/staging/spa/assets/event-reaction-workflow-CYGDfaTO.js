import{n as e}from"./chunk-CMxvf4Kt.js";import{a as t,i as n,n as r,o as i,r as a,t as o}from"./idempotent-register-workflow-ND-3s1Dv.js";import{J as s,t as c}from"./src-CRqYcphb.js";import{a as l,i as u,n as d,o as f}from"./durable-DNsrIGcG.js";import{i as p,n as m,t as h}from"./src-DS6stHeO.js";import{n as g,t as _}from"./queue-concurrency-CKZXScZF.js";async function v(e){let{sql:t}=s();return(await t`
    INSERT INTO harness_shared.event_reactions
      (dedup_id, workspace_id, rule_id, fire, trigger_tool, cause_root_run_id, depth, status)
    VALUES (
      ${e.dedupId}, ${e.workspaceId}, ${e.ruleId}, ${e.fire},
      ${e.triggerTool??null}, ${e.causeRootRunId??null}, ${e.depth}, 'fired'
    )
    ON CONFLICT (dedup_id) DO NOTHING
    RETURNING dedup_id
  `).length>0}async function y(e){let{sql:t}=s();await t`DELETE FROM harness_shared.event_reactions WHERE dedup_id = ${e}`}async function b(e,t){let{sql:n}=s();await n`
    UPDATE harness_shared.event_reactions
       SET status = 'failed', error_message = ${t}
     WHERE dedup_id = ${e}
  `}var x=e((()=>{c()}));async function S(e){await m(e,{store:{claim:v,release:y,markFailed:b},fire:e=>l({fire:e.fire,args:e.args,parentCtx:{...e.parent},cause:e.cause,capability:e.capability}),log:e=>console.warn(`[events] ${e}`)})}var C=e((()=>{h(),f(),x()}));function w(e){return{workspaceId:e.workspaceId??e.principal?.workspaceId,harnessSlug:e.harnessSlug,role:e.role,featureId:e.featureId??null,chunkId:e.chunkId??null,spawnId:e.spawnId,uiClientId:e.uiClientId??null}}function T(e){return p({rule:e.rule,event:e.event,cause:e.cause,rootRunId:e.event.ctx.runId})}var E=e((()=>{h()}));async function D(e){await n.runStep(()=>S(e),{name:`react:${e.fire}`,retriesAllowed:!0,maxAttempts:3,intervalSeconds:2,backoffRate:2})}async function O(e){let t=T(e),r={fire:e.fire,args:e.args,parent:w(e.event.ctx),cause:e.cause,ruleId:e.rule.id,triggerTool:e.event.tool,dedupId:t,capability:e.rule.capability};await n.startWorkflow(A,{workflowID:`reaction:${t}`,queueName:j.name,enqueueOptions:{deduplicationID:t}})(r)}function k(){u(O)}var A,j;e((()=>{i(),a(),_(),C(),d(),E(),A=o(`eventReaction`,()=>n.registerWorkflow(D,{name:`eventReaction`,maxRecoveryAttempts:5})),j=r(`event-reactions`,()=>new t(`event-reactions`,{concurrency:g(4)}))}))();export{k as wireDurableReactions};