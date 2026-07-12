const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/src-q56SuDEp.js","assets/src-CgbVJkBN.js","assets/chunk-CMxvf4Kt.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-BUBAcz5Q.js","assets/__vite-browser-external-CM3Eme-n.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{a as r}from"./types-ClYUlh9L.js";import{t as i}from"./src-DkOfe68-.js";import{a,c as o}from"./server-B4lw7rK4.js";import{a as s,r as c}from"./store-B7yk0XO6.js";import{n as l,t as u}from"./registrants-CrwYJnPJ.js";import{a as d,c as f,i as p,o as m,r as h,s as g}from"./battery-CyfCGtWx.js";var _,v=e((()=>{g(),_=class{sql;workspaceId;constructor(e,t){this.sql=e,this.workspaceId=t}async startRun(e){await this.sql`
      INSERT INTO harness_shared.replay_runs
        (workspace_id, run_id, battery_id, variant_id, variant_label, case_ref, turn_index, repeat, status, signal_origin)
      VALUES (
        ${this.workspaceId}, ${e.runId}, ${e.batteryId}, ${e.variant.variantId}, ${e.variant.label},
        ${f(e.replayCase)},
        ${e.replayCase.kind===`historical`?e.replayCase.turnIndex:null},
        ${e.repeat}, 'started', ${m}
      )
      ON CONFLICT (workspace_id, run_id) DO UPDATE SET
        battery_id = EXCLUDED.battery_id,
        status     = 'started',
        updated_at = now()
    `}async finishRun(e,t){await this.sql`
      UPDATE harness_shared.replay_runs SET
        divergence = ${t.divergence==null?null:JSON.stringify(t.divergence)}::text::jsonb,
        cost_usd   = ${t.costUsd},
        elapsed_ms = ${Math.round(t.elapsedMs)},
        updated_at = now()
      WHERE workspace_id = ${this.workspaceId} AND run_id = ${e}
    `}async recordScore(e,t){await this.sql`
      UPDATE harness_shared.replay_runs SET
        status          = 'scored',
        d1              = ${t.d1},
        d2              = ${t.d2},
        d3              = ${t.d3},
        composite       = ${t.composite},
        judge_rationale = ${t.rationale},
        rubric_hash     = ${t.rubricHash},
        cost_usd        = cost_usd + ${t.costUsd},
        updated_at      = now()
      WHERE workspace_id = ${this.workspaceId} AND run_id = ${e}
    `}async markFailed(e,t){await this.sql`
      INSERT INTO harness_shared.replay_runs
        (workspace_id, run_id, battery_id, variant_id, case_ref, repeat, status, signal_origin, error, elapsed_ms)
      VALUES (${this.workspaceId}, ${e}, '', '', '', 0, ${t.status}, ${m}, ${t.error}, ${Math.round(t.elapsedMs)})
      ON CONFLICT (workspace_id, run_id) DO UPDATE SET
        status     = EXCLUDED.status,
        error      = EXCLUDED.error,
        elapsed_ms = EXCLUDED.elapsed_ms,
        updated_at = now()
    `}}}));function y(e){return{...S,...e}}async function b(e,t){let n=y(t);try{return await n.enabled()?await n.preflight({workspaceId:e.workspaceId,loopId:d}):{allow:!1,reason:`replay-dark`,remainingUsd:null}}catch(e){return n.log(`preflight failed — refusing (fail-closed): ${e instanceof Error?e.message:e}`),{allow:!1,reason:`governor-error`,remainingUsd:null}}}async function x(e,t,n){let r=y(n),i=await b({workspaceId:e.workspaceId},n);if(!i.allow)return{verdict:i,result:null};let a=await r.getSql(),o=t.store??new _(a,e.workspaceId),s=[e.config.maxSpendUsd,i.remainingUsd??void 0].filter(e=>e!==void 0),c=await p({...e.config,...s.length>0?{maxSpendUsd:Math.min(...s)}:{}},{...t,store:o});if(c.totalCostUsd>0)try{await r.recordSpend(a,{workspaceId:e.workspaceId,loopId:d,costUsd:c.totalCostUsd,signalOrigin:m,runRef:c.batteryId,note:`replay battery`,accumulate:!0})}catch(e){r.log(`spend ledgering failed for ${c.batteryId}: ${e instanceof Error?e.message:e}`)}return{verdict:i,result:c}}var S,C=e((()=>{i(),o(),u(),c(),h(),v(),g(),t(),S={enabled:()=>a(r.REPLAY_HARNESS,`replay-harness`),getSql:async()=>{let{getOrgPg:e}=await n(async()=>{let{getOrgPg:e}=await import(`./src-q56SuDEp.js`);return{getOrgPg:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8]));return e().sql},preflight:l,recordSpend:s,log:e=>console.log(`[replay-harness] ${e}`)}})),w,T,E=e((()=>{w=`frontier:transfer-harness`,T=`replay`}));export{x as a,C as i,T as n,v as o,E as r,w as t};