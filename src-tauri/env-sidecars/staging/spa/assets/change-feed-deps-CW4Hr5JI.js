import{n as u}from"./chunk-ChpBd9eV.js";import{st as o,t as c}from"./src-8fWtxfEz.js";async function i(t,e){try{return await t()}catch(a){return console.warn(`[change-feed] reader "${e}" failed:`,a instanceof Error?a.message:a),[]}}async function E(t){const[e,a,s]=await Promise.all([i(()=>t.workItemCompletions(),"workItemCompletions"),i(()=>t.gymProposals(),"gymProposals"),i(()=>t.planRuns(),"planRuns")]);return p([...e,...a,...s]).sort((n,r)=>n.ts<r.ts?1:n.ts>r.ts?-1:0)}function p(t){const e=new Set,a=[];for(const s of t)e.has(s.id)||(e.add(s.id),a.push(s));return a}function S(t,e={}){const a=e.limit??100;let s=[...t];return e.userRequestedOnly&&(s=s.filter(n=>n.userRequested===!0)),s.map((n,r)=>({r:n,i:r})).sort((n,r)=>(n.r.userRequested??!1)!==(r.r.userRequested??!1)?n.r.userRequested?-1:1:n.r.ts!==r.r.ts?n.r.ts<r.r.ts?1:-1:n.i-r.i).map(({r:n})=>n).slice(0,a)}var y=u((()=>{}));function d(t){const e=typeof t=="number"?t:Number(t??0);return new Date(Number.isFinite(e)?e:0).toISOString()}async function _(){const{sql:t}=o();return(await t`
    SELECT feature_id, harness_slug, title, status, updated_ts, created_by_github_user_id::text
      FROM harness_shared.work_items
     WHERE status = ANY(${[...l]}::text[])
       AND terminal_owner IS NOT NULL AND terminal_owner <> ''
       AND terminal_completion_ref IS NOT NULL AND terminal_completion_ref <> ''
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT 500`).map(e=>({id:`wi:${e.feature_id}`,kind:"completion",title:e.title||`Completed: ${e.feature_id}`,detail:`Status: ${e.status}`,harness:e.harness_slug??void 0,workItemId:e.feature_id,ref:`wi:${e.feature_id}`,ts:d(e.updated_ts),userRequested:e.created_by_github_user_id!=null}))}async function m(){const{sql:t}=o(),e=await t`
    SELECT id, harness_slug, role, status, decided_at
      FROM harness_shared.gym_proposals
     WHERE status IN ('accepted', 'rejected', 'superseded')
       AND decided_at IS NOT NULL
     ORDER BY decided_at DESC
     LIMIT 500`,a={accepted:"Accepted",rejected:"Rejected",superseded:"Superseded"};return e.map(s=>({id:`gym:${s.id}`,kind:"proposal",title:`${a[s.status]??s.status} prompt for ${s.role}`,detail:`Status: ${s.status}`,harness:s.harness_slug??void 0,ref:`gym:${s.id}`,ts:d(s.decided_at),userRequested:!1}))}async function f(){const{sql:t}=o();return(await t`
    SELECT plan_slug, title, harness_slug, op_updated_at
      FROM harness_shared.harness_plans
     WHERE op_status = 'done'
       AND op_updated_at IS NOT NULL
     ORDER BY op_updated_at DESC
     LIMIT 500`).map(e=>({id:`plan:${e.plan_slug}`,kind:"plan-run",title:`Plan completed: ${e.title||e.plan_slug}`,harness:e.harness_slug||void 0,ref:`plan:${e.plan_slug}`,ts:new Date(e.op_updated_at).toISOString(),userRequested:!1}))}function I(){return{async workItemCompletions(){return _()},async gymProposals(){return m()},async planRuns(){return f()}}}var l,w=u((()=>{c(),l=["done","passed","resolved","closed"]}));export{E as a,p as i,I as n,y as o,w as r,S as s,l as t};
