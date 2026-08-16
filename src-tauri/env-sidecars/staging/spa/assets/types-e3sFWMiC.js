const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/src-DVvNgMXY.js","assets/src-8fWtxfEz.js","assets/chunk-ChpBd9eV.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js"])))=>i.map(i=>d[i]);
import{n as d}from"./chunk-ChpBd9eV.js";import{n as h,t as $}from"./preload-helper-CcgcQsTF.js";import{s as f}from"./types-DoRTXl1W.js";import{t as m}from"./src-DduH0PES.js";import{l as E,o as I}from"./server-BXcXKvn3.js";import{i as v,o as S}from"./store-Dz4TrzNu.js";import{n as k,t as R}from"./registrants-LxmlzyLx.js";import{a as c,c as D,i as U,o,r as O,s as _}from"./battery-_GfJLTGI.js";var u,T=d((()=>{_(),u=class{sql;workspaceId;constructor(a,r){this.sql=a,this.workspaceId=r}async startRun(a){await this.sql`
      INSERT INTO harness_shared.replay_runs
        (workspace_id, run_id, battery_id, variant_id, variant_label, case_ref, turn_index, repeat, status, signal_origin)
      VALUES (
        ${this.workspaceId}, ${a.runId}, ${a.batteryId}, ${a.variant.variantId}, ${a.variant.label},
        ${D(a.replayCase)},
        ${a.replayCase.kind==="historical"?a.replayCase.turnIndex:null},
        ${a.repeat}, 'started', ${o}
      )
      ON CONFLICT (workspace_id, run_id) DO UPDATE SET
        battery_id = EXCLUDED.battery_id,
        status     = 'started',
        updated_at = now()
    `}async finishRun(a,r){await this.sql`
      UPDATE harness_shared.replay_runs SET
        divergence = ${r.divergence==null?null:JSON.stringify(r.divergence)}::text::jsonb,
        cost_usd   = ${r.costUsd},
        elapsed_ms = ${Math.round(r.elapsedMs)},
        updated_at = now()
      WHERE workspace_id = ${this.workspaceId} AND run_id = ${a}
    `}async recordScore(a,r){await this.sql`
      UPDATE harness_shared.replay_runs SET
        status          = 'scored',
        d1              = ${r.d1},
        d2              = ${r.d2},
        d3              = ${r.d3},
        composite       = ${r.composite},
        judge_rationale = ${r.rationale},
        rubric_hash     = ${r.rubricHash},
        cost_usd        = cost_usd + ${r.costUsd},
        updated_at      = now()
      WHERE workspace_id = ${this.workspaceId} AND run_id = ${a}
    `}async markFailed(a,r){await this.sql`
      INSERT INTO harness_shared.replay_runs
        (workspace_id, run_id, battery_id, variant_id, case_ref, repeat, status, signal_origin, error, elapsed_ms)
      VALUES (${this.workspaceId}, ${a}, '', '', '', 0, ${r.status}, ${o}, ${r.error}, ${Math.round(r.elapsedMs)})
      ON CONFLICT (workspace_id, run_id) DO UPDATE SET
        status     = EXCLUDED.status,
        error      = EXCLUDED.error,
        elapsed_ms = EXCLUDED.elapsed_ms,
        updated_at = now()
    `}}}));function g(a){return{...y,...a}}async function b(a,r){const s=g(r);try{return await s.enabled()?await s.preflight({workspaceId:a.workspaceId,loopId:c}):{allow:!1,reason:"replay-dark",remainingUsd:null}}catch(e){return s.log(`preflight failed — refusing (fail-closed): ${e instanceof Error?e.message:e}`),{allow:!1,reason:"governor-error",remainingUsd:null}}}async function X(a,r,s){const e=g(s),i=await b({workspaceId:a.workspaceId},s);if(!i.allow)return{verdict:i,result:null};const l=await e.getSql(),w=r.store??new u(l,a.workspaceId),p=[a.config.maxSpendUsd,i.remainingUsd??void 0].filter(n=>n!==void 0),t=await U({...a.config,...p.length>0?{maxSpendUsd:Math.min(...p)}:{}},{...r,store:w});if(t.totalCostUsd>0)try{await e.recordSpend(l,{workspaceId:a.workspaceId,loopId:c,costUsd:t.totalCostUsd,signalOrigin:o,runRef:t.batteryId,note:"replay battery",accumulate:!0})}catch(n){e.log(`spend ledgering failed for ${t.batteryId}: ${n instanceof Error?n.message:n}`)}return{verdict:i,result:t}}var y,V=d((()=>{m(),E(),R(),v(),O(),T(),_(),h(),y={enabled:()=>I(f.REPLAY_HARNESS,"replay-harness"),getSql:async()=>{const{getOrgPg:a}=await $(async()=>{const{getOrgPg:r}=await import("./src-DVvNgMXY.js");return{getOrgPg:r}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10]));return a().sql},preflight:k,recordSpend:S,log:a=>console.log(`[replay-harness] ${a}`)}})),A,L,Y=d((()=>{A="frontier:transfer-harness",L="replay"}));export{X as a,V as i,L as n,T as o,Y as r,A as t};
