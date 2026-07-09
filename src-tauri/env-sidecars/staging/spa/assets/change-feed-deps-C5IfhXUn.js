import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-BbbWoCsk.js";async function r(e,t){try{return await e()}catch(e){return console.warn(`[change-feed] reader "${t}" failed:`,e instanceof Error?e.message:e),[]}}async function i(e){let[t,n,i]=await Promise.all([r(()=>e.workItemCompletions(),`workItemCompletions`),r(()=>e.gymProposals(),`gymProposals`),r(()=>e.planRuns(),`planRuns`)]);return a([...t,...n,...i]).sort((e,t)=>e.ts<t.ts?1:e.ts>t.ts?-1:0)}function a(e){let t=new Set,n=[];for(let r of e)t.has(r.id)||(t.add(r.id),n.push(r));return n}var o=e((()=>{}));function s(e){let t=typeof e==`number`?e:Number(e??0);return new Date(Number.isFinite(t)?t:0).toISOString()}async function c(){let{sql:e}=t();return(await e`
    SELECT feature_id, harness_slug, title, status, updated_ts, created_by_github_user_id::text
      FROM harness_shared.work_items
     WHERE status = ANY(${[...f]}::text[])
       AND terminal_owner IS NOT NULL AND terminal_owner <> ''
       AND terminal_completion_ref IS NOT NULL AND terminal_completion_ref <> ''
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT 500`).map(e=>({id:`wi:${e.feature_id}`,kind:`completion`,title:e.title||`Completed: ${e.feature_id}`,detail:`Status: ${e.status}`,harness:e.harness_slug??void 0,workItemId:e.feature_id,ref:`wi:${e.feature_id}`,ts:s(e.updated_ts),userRequested:e.created_by_github_user_id!=null}))}async function l(){let{sql:e}=t(),n=await e`
    SELECT id, harness_slug, role, status, decided_at
      FROM harness_shared.gym_proposals
     WHERE status IN ('accepted', 'rejected', 'superseded')
       AND decided_at IS NOT NULL
     ORDER BY decided_at DESC
     LIMIT 500`,r={accepted:`Accepted`,rejected:`Rejected`,superseded:`Superseded`};return n.map(e=>({id:`gym:${e.id}`,kind:`proposal`,title:`${r[e.status]??e.status} prompt for ${e.role}`,detail:`Status: ${e.status}`,harness:e.harness_slug??void 0,ref:`gym:${e.id}`,ts:s(e.decided_at),userRequested:!1}))}async function u(){let{sql:e}=t();return(await e`
    SELECT plan_slug, title, harness_slug, op_updated_at
      FROM harness_shared.harness_plans
     WHERE op_status = 'done'
       AND op_updated_at IS NOT NULL
     ORDER BY op_updated_at DESC
     LIMIT 500`).map(e=>({id:`plan:${e.plan_slug}`,kind:`plan-run`,title:`Plan completed: ${e.title||e.plan_slug}`,harness:e.harness_slug||void 0,ref:`plan:${e.plan_slug}`,ts:new Date(e.op_updated_at).toISOString(),userRequested:!1}))}function d(){return{async workItemCompletions(){return c()},async gymProposals(){return l()},async planRuns(){return u()}}}var f,p=e((()=>{n(),f=[`done`,`passed`,`resolved`,`closed`]}));export{o as i,p as n,i as r,d as t};