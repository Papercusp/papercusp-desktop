import{n as e}from"./chunk-ChpBd9eV.js";import{Q as i,t as o}from"./src-BmBNODK0.js";import{k as _,t as p}from"./src-DgKPQFfC.js";function f(a,t){return(a==="started"||a==="paused")&&_(t)?"done":a}async function h(a,t,s){const n=new Date().toISOString();return{cleared:(await i(a,async r=>r`
      UPDATE harness_shared.harness_plans
         SET op_status = 'done', op_updated_at = ${n}
       WHERE workspace_id = ${a}
         AND harness_slug  = ${t}
         AND plan_slug     = ${s}
         AND op_status IN ('started', 'paused')
      RETURNING plan_slug
    `)).length>0}}var N=e((()=>{o(),p()}));export{N as n,f as r,h as t};
