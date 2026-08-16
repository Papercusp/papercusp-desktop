const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/report-builder-pg-CjRfnoB9.js","assets/chunk-ChpBd9eV.js","assets/preload-helper-CcgcQsTF.js","assets/__vite-browser-external-56mrcCg8.js"])))=>i.map(i=>d[i]);
import{n as S,o as C}from"./chunk-ChpBd9eV.js";import{n as M,t as B}from"./preload-helper-CcgcQsTF.js";import{t as R}from"./__vite-browser-external-56mrcCg8.js";import{a as $,t as b}from"./src-DiJ46u-6.js";import{a as k,i as X}from"./sync-sse-VXiL_m-9.js";import{n as d,t as x}from"./db-i3q5vBYA.js";function F(e){return e==null?!0:!v.has(e)}var v,P=S((()=>{v=new Set(["error","timeout","infra-failed"])}));function w(){return(0,p.join)((0,y.homedir)(),".papercusp","bench-results")}function L(e){return/^[A-Za-z0-9._-]+$/.test(e)&&e!=="."&&e!==".."}function O(e){let n;try{n=(0,E.readdirSync)(e)}catch{return null}const t=n.filter(s=>s.endsWith(".json")&&s!=="package.json"&&!s.startsWith("."));return t.length===1?t[0].replace(/\.json$/,""):null}function W(e=w()){let n;try{n=(0,E.readdirSync)(e)}catch{return[]}const t=[];for(const s of n){if(!L(s))continue;const r=(0,p.join)(e,s);let a=0;try{const o=(0,E.statSync)(r);if(!o.isDirectory())continue;a=o.mtimeMs}catch{continue}t.push({id:s,arm:O(r),mtimeMs:a})}return t.sort((s,r)=>r.mtimeMs-s.mtimeMs)}function H(e,n){const t=(0,p.join)(e,`grade-${n}`,"out","eval_results.json");if(!(0,E.existsSync)(t))return null;try{const s=JSON.parse((0,E.readFileSync)(t,"utf8"));return!s||typeof s!="object"?null:s}catch{return null}}function q(e,n){return e.map(t=>({...t,resolved:n&&t.instanceId in n?n[t.instanceId]:null}))}function A(e,n){let t=0,s=0,r=0;for(const c of n){if(!F(c.stopReason)||c.generationError!=null&&c.generationError!==""){r+=1;continue}c.resolved!=null&&(t+=1,c.resolved&&(s+=1))}const a=n.reduce((c,_)=>c+(_.costUsd??0),0),o=n.reduce((c,_)=>c+(_.tokensIn??0),0),i=n.reduce((c,_)=>c+(_.tokensOut??0),0);return{arm:e.arm,gradedCount:t,resolvedCount:s,infraExcluded:r,taskCount:n.length,resolvedPct:t>0?s/t:null,costUsd:e.totals?.costUsd??a,tokensIn:e.totals?.tokensIn??o,tokensOut:e.totals?.tokensOut??i,wallMs:e.wallMs??0,peakConcurrentBees:e.peakConcurrentBees??0,nonEmptyDiffs:e.nonEmptyDiffs??n.filter(c=>(c.diffBytes??0)>0).length,coordEventCount:e.coordEvents?.length??0,recovered:e.recovered??!1}}function j(e,n=w()){if(!L(e))return null;const t=(0,p.join)(n,e),s=O(t);if(!s)return null;const r=(0,p.join)(t,`${s}.json`);if(!(0,E.existsSync)(r))return null;let a;try{a=JSON.parse((0,E.readFileSync)(r,"utf8"))}catch{return null}const o=H(t,s),i=q(a.perTask??[],o),c=A(a,i),_=$(a.coordEvents??[],i.length);return{id:e,run:a,perTask:i,summary:c,coordRates:_}}var E,y,p,J=S((()=>{E=C(R(),1),y=C(R(),1),p=C(R(),1),b(),P()}));async function z(e,n={}){const{sql:t,ws:s}=d(n),r=e.status??"running",a=e.source??"ui",o=e.suite??"swe-bench-pro";await t`
    INSERT INTO harness_shared.bench_runs
      (id, workspace_id, arm, task_set_id, suite, model, status, source, config,
       pot_slug, task_count, recovered, started_at, created_at, updated_at)
    VALUES
      (${e.id}, ${s}, ${e.arm}, ${e.taskSetId}, ${o}, ${e.model}, ${r}, ${a},
       ${m(e.config??null)}::text::jsonb, ${e.potSlug??null}, ${e.taskCount??null},
       ${e.recovered??!1},
       ${r==="running"?t`now()`:t`null`}, now(), now())
    ON CONFLICT (id) DO UPDATE SET
      arm = EXCLUDED.arm, task_set_id = EXCLUDED.task_set_id, suite = EXCLUDED.suite,
      model = EXCLUDED.model, status = EXCLUDED.status, source = EXCLUDED.source,
      config = EXCLUDED.config, pot_slug = EXCLUDED.pot_slug, task_count = EXCLUDED.task_count,
      recovered = EXCLUDED.recovered, updated_at = now()
  `,await f(e.id)}async function ue(e,n,t={}){const{sql:s,ws:r}=d(t);await s`
    UPDATE harness_shared.bench_runs SET pot_slug = ${n}, updated_at = now()
     WHERE id = ${e} AND workspace_id = ${r}
  `,await f(e)}async function G(e,n,t={}){const{sql:s,ws:r}=d(t);await s`
    INSERT INTO harness_shared.bench_run_tasks
      (run_id, workspace_id, instance_id, task_status, resolved, bee_id, disposition,
       stop_reason, generation_error, tokens_in, tokens_out, cost_usd, turns,
       wall_clock_ms, diff_bytes, arm_meta, created_at, updated_at)
    VALUES
      (${e}, ${r}, ${n.instanceId}, ${n.taskStatus??"todo"}, ${n.resolved??null},
       ${n.cupId??null}, ${n.disposition??null}, ${n.stopReason??null},
       ${n.generationError??null}, ${n.tokensIn??null}, ${n.tokensOut??null},
       ${n.costUsd??null}, ${n.turns??null}, ${n.wallClockMs??null},
       ${n.diffBytes??null}, ${m(n.armMeta??null)}::text::jsonb, now(), now())
    ON CONFLICT (run_id, instance_id) DO UPDATE SET
      task_status = EXCLUDED.task_status,
      resolved = COALESCE(EXCLUDED.resolved, harness_shared.bench_run_tasks.resolved),
      bee_id = COALESCE(EXCLUDED.bee_id, harness_shared.bench_run_tasks.bee_id),
      disposition = COALESCE(EXCLUDED.disposition, harness_shared.bench_run_tasks.disposition),
      stop_reason = COALESCE(EXCLUDED.stop_reason, harness_shared.bench_run_tasks.stop_reason),
      generation_error = EXCLUDED.generation_error,
      tokens_in = COALESCE(EXCLUDED.tokens_in, harness_shared.bench_run_tasks.tokens_in),
      tokens_out = COALESCE(EXCLUDED.tokens_out, harness_shared.bench_run_tasks.tokens_out),
      cost_usd = COALESCE(EXCLUDED.cost_usd, harness_shared.bench_run_tasks.cost_usd),
      turns = COALESCE(EXCLUDED.turns, harness_shared.bench_run_tasks.turns),
      wall_clock_ms = COALESCE(EXCLUDED.wall_clock_ms, harness_shared.bench_run_tasks.wall_clock_ms),
      diff_bytes = COALESCE(EXCLUDED.diff_bytes, harness_shared.bench_run_tasks.diff_bytes),
      arm_meta = COALESCE(EXCLUDED.arm_meta, harness_shared.bench_run_tasks.arm_meta),
      updated_at = now()
  `,await f(e)}function ie(e){const n=e.attempt,t=n.diff?Buffer.byteLength(n.diff,"utf8"):0;return{instanceId:n.instanceId,taskStatus:"collected",cupId:e.cupId,disposition:e.disposition,stopReason:n.stopReason,generationError:n.generationError??null,tokensIn:n.tokensIn,tokensOut:n.tokensOut,costUsd:n.costUsd,turns:n.turns,wallClockMs:n.wallClockMs,diffBytes:t,armMeta:n.armMeta??null}}async function ce(e,n,t={}){if(n.length===0)return{inserted:0};const{sql:s,ws:r}=d(t),a=await s`
    SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM harness_shared.bench_run_events
     WHERE run_id = ${e} AND workspace_id = ${r}
  `,o=Number(a[0]?.next??0);return await s`INSERT INTO harness_shared.bench_run_events ${s(n.map((i,c)=>N(e,r,o+c,i)),"run_id","workspace_id","seq","ts","kind","agent","task_id","payload")}`,await f(e),{inserted:n.length}}async function V(e,n,t={}){const{sql:s,ws:r}=d(t);await s.begin(async a=>{await a`DELETE FROM harness_shared.bench_run_events WHERE run_id = ${e} AND workspace_id = ${r}`,n.length>0&&await a`INSERT INTO harness_shared.bench_run_events ${a(n.map((o,i)=>N(e,r,i,o)),"run_id","workspace_id","seq","ts","kind","agent","task_id","payload")}`}),await f(e)}function N(e,n,t,s){return{run_id:e,workspace_id:n,seq:t,ts:s.ts??null,kind:s.kind,agent:s.agent??null,task_id:s.taskId??null,payload:s.detail!=null?JSON.stringify({detail:s.detail}):null}}async function de(e,n,t={},s={}){const{sql:r,ws:a}=d(s),o=t.finished??(n==="done"||n==="error"||n==="cancelled");await r`
    UPDATE harness_shared.bench_runs SET
      status = ${n},
      run_error = ${t.runError??null},
      finished_at = ${o?r`now()`:r`finished_at`},
      updated_at = now()
     WHERE id = ${e} AND workspace_id = ${a}
  `,await f(e)}async function I(e,n={}){const{sql:t,ws:s}=d(n);await t`
    UPDATE harness_shared.bench_runs r SET
      task_count = agg.task_count,
      graded_count = agg.graded_count,
      resolved_count = agg.resolved_count,
      infra_excluded = agg.infra_excluded,
      non_empty_diffs = agg.non_empty_diffs,
      cost_usd = agg.cost_usd,
      tokens_in = agg.tokens_in,
      tokens_out = agg.tokens_out,
      updated_at = now()
    FROM (
      SELECT
        count(*)::int AS task_count,
        -- A row is NON-SCORED (excluded — external/transient/infra) when its stop_reason is one of the
        -- locked non-scored reasons OR it carries a generation_error. These never count as a fail.
        count(*) FILTER (
          WHERE (stop_reason IS NULL OR stop_reason NOT IN ('error', 'timeout', 'infra-failed'))
            AND generation_error IS NULL
            AND resolved IS NOT NULL
        )::int AS graded_count,
        count(*) FILTER (
          WHERE (stop_reason IS NULL OR stop_reason NOT IN ('error', 'timeout', 'infra-failed'))
            AND generation_error IS NULL
            AND resolved IS TRUE
        )::int AS resolved_count,
        count(*) FILTER (
          WHERE stop_reason IN ('error', 'timeout', 'infra-failed') OR generation_error IS NOT NULL
        )::int AS infra_excluded,
        count(*) FILTER (WHERE diff_bytes > 0)::int AS non_empty_diffs,
        COALESCE(sum(cost_usd), 0) AS cost_usd,
        COALESCE(sum(tokens_in), 0)::bigint AS tokens_in,
        COALESCE(sum(tokens_out), 0)::bigint AS tokens_out
      FROM harness_shared.bench_run_tasks
      WHERE run_id = ${e} AND workspace_id = ${s}
    ) agg
    WHERE r.id = ${e} AND r.workspace_id = ${s}
  `,await f(e)}async function le(e,n,t={}){const{sql:s,ws:r}=d(t),a=Object.entries(n);a.length>0&&await s.begin(async o=>{for(const[i,c]of a)await o`
          UPDATE harness_shared.bench_run_tasks
             SET resolved = ${c}, task_status = 'graded', updated_at = now()
           WHERE run_id = ${e} AND workspace_id = ${r} AND instance_id = ${i}
        `}),await I(e,t)}async function _e(e,n,t={}){const{sql:s,ws:r}=d(t),a=n.runError?"error":"done";await s`
    UPDATE harness_shared.bench_runs SET
      peak_concurrent_bees = COALESCE(${n.peakConcurrentBees??null}, peak_concurrent_bees),
      wall_ms = COALESCE(${n.wallMs??null}, wall_ms),
      started_at = COALESCE(started_at, ${n.startedAtIso??null}),
      status = ${a},
      run_error = ${n.runError??null},
      finished_at = now(),
      updated_at = now()
     WHERE id = ${e} AND workspace_id = ${r}
  `,await I(e,t);try{const{emitReport:o}=await B(async()=>{const{emitReport:i}=await import("./report-builder-pg-CjRfnoB9.js");return{emitReport:i}},__vite__mapDeps([0,1,2,3]));await o(e,{workspace:t.workspaceId})}catch{}}async function Ee(e={}){const{sql:n,ws:t}=d(e);return(await n`
    SELECT * FROM harness_shared.bench_runs
     WHERE workspace_id = ${t}
     ORDER BY created_at DESC
     LIMIT 500
  `).map(T)}async function fe(e,n={}){const{sql:t,ws:s}=d(n),r=(await t`
    SELECT * FROM harness_shared.bench_runs WHERE id = ${e} AND workspace_id = ${s} LIMIT 1
  `)[0];if(!r)return null;const a=await t`
    SELECT * FROM harness_shared.bench_run_tasks
     WHERE run_id = ${e} AND workspace_id = ${s}
     ORDER BY instance_id ASC
  `,o=await t`
    SELECT * FROM harness_shared.bench_run_events
     WHERE run_id = ${e} AND workspace_id = ${s}
     ORDER BY seq ASC
  `,i=a.map(u=>({instanceId:u.instance_id,cupId:u.bee_id??void 0,disposition:u.disposition??void 0,stopReason:u.stop_reason??void 0,generationError:u.generation_error,tokensIn:l(u.tokens_in),tokensOut:l(u.tokens_out),costUsd:l(u.cost_usd),turns:l(u.turns),wallClockMs:l(u.wall_clock_ms),diffBytes:l(u.diff_bytes),armMeta:D(u.arm_meta)??void 0,resolved:u.resolved})),c=o.map(u=>({ts:u.ts==null?void 0:Number(u.ts),kind:u.kind,agent:u.agent??void 0,taskId:u.task_id??null,detail:D(u.payload)?.detail})),_=i.reduce((u,h)=>u+(h.costUsd||0),0),g={arm:r.arm,runId:r.id,runError:r.run_error,startedAt:r.started_at??void 0,wallMs:l(r.wall_ms)??0,peakConcurrentBees:r.peak_concurrent_bees??0,taskCount:i.length,nonEmptyDiffs:i.filter(u=>(u.diffBytes??0)>0).length,totals:{costUsd:l(r.cost_usd)??_,tokensIn:l(r.tokens_in)??i.reduce((u,h)=>u+(h.tokensIn||0),0),tokensOut:l(r.tokens_out)??i.reduce((u,h)=>u+(h.tokensOut||0),0)},perTask:i,coordEvents:c,recovered:r.recovered},U=A(g,i);return{...T(r),config:D(r.config),summary:U,run:g,perTask:i,coordRates:$(c,i.length)}}async function pe(e,n={}){const{sql:t,ws:s}=d(n),r=await t`
    DELETE FROM harness_shared.bench_runs WHERE id = ${e} AND workspace_id = ${s} RETURNING id
  `;return r.length>0&&(await k("evals.benchRuns",{}),await k("evals.benchRun",{runId:e})),{deleted:r.length>0}}async function Y(e,n={}){const t=j(e,n.baseDir??w());if(!t)return{runId:e,imported:!1};const{run:s,perTask:r,summary:a}=t;await z({id:e,arm:s.arm??"unknown",taskSetId:K(r.length),model:"opus",source:"import",status:"done",recovered:!!s.recovered,taskCount:r.length,config:{imported:!0,runId:s.runId??null}},n);for(const o of r)o.instanceId!=null&&await G(e,{instanceId:o.instanceId,taskStatus:o.resolved==null?"collected":"graded",resolved:o.resolved,cupId:o.cupId??null,disposition:o.disposition??null,stopReason:o.stopReason??null,generationError:o.generationError??null,tokensIn:o.tokensIn??null,tokensOut:o.tokensOut??null,costUsd:o.costUsd??null,turns:o.turns??null,wallClockMs:o.wallClockMs??null,diffBytes:o.diffBytes??null,armMeta:o.armMeta??null},n);return await V(e,s.coordEvents??[],n),await Z(e,s,a,n),{runId:e,imported:!0}}async function Z(e,n,t,s={}){const{sql:r,ws:a}=d(s);await r`
    UPDATE harness_shared.bench_runs SET
      status = 'done',
      task_count = ${t.taskCount},
      graded_count = ${t.gradedCount},
      resolved_count = ${t.resolvedCount},
      infra_excluded = ${t.infraExcluded},
      non_empty_diffs = ${t.nonEmptyDiffs},
      cost_usd = ${t.costUsd},
      tokens_in = ${t.tokensIn},
      tokens_out = ${t.tokensOut},
      wall_ms = ${t.wallMs},
      peak_concurrent_bees = ${t.peakConcurrentBees},
      summary = ${m(t)}::text::jsonb,
      started_at = COALESCE(${n.startedAt??null}, started_at),
      finished_at = now(),
      updated_at = now()
     WHERE id = ${e} AND workspace_id = ${a}
  `,await f(e)}async function he(e={}){const n=e.baseDir??w(),t=[],s=[];for(const r of W(n))try{((await Y(r.id,e)).imported?t:s).push(r.id)}catch(a){s.push(r.id),console.warn(`[bench-import] skipped malformed preserved run ${r.id}: ${a instanceof Error?a.message:a}`)}return{imported:t,skipped:s}}async function f(e){await k("evals.benchRuns",{}),await k("evals.benchRun",{runId:e}),await k("evals.benchRunLive",{runId:e})}function K(e){return e===11?"11-task-pilot":`custom:${e}-task`}function D(e){if(e==null)return null;if(typeof e=="string")try{return JSON.parse(e)}catch{return null}return e}function T(e){const n=e.resolved_count==null?null:Number(e.resolved_count),t=e.graded_count==null?null:Number(e.graded_count),s=n!=null&&t!=null&&t>0?n/t:null;return{id:e.id,arm:e.arm,taskSetId:e.task_set_id,suite:e.suite,model:e.model,status:e.status,source:e.source,taskCount:e.task_count==null?null:Number(e.task_count),gradedCount:t,resolvedCount:n,infraExcluded:e.infra_excluded==null?null:Number(e.infra_excluded),resolvedPct:s,nonEmptyDiffs:e.non_empty_diffs==null?null:Number(e.non_empty_diffs),costUsd:e.cost_usd==null?null:Number(e.cost_usd),wallMs:e.wall_ms==null?null:Number(e.wall_ms),recovered:!!e.recovered,runError:e.run_error,potSlug:e.pot_slug,fleetRunId:e.fleet_run_id,startedAt:e.started_at,finishedAt:e.finished_at,createdAt:e.created_at,updatedAt:e.updated_at}}var m,l,Q=S((()=>{b(),X(),x(),J(),M(),m=e=>e==null?null:JSON.stringify(e),l=e=>e==null?void 0:typeof e=="number"?e:Number(e)}));Q();export{ce as appendBenchRunEvents,le as applyGradeMap,pe as deleteBenchRun,fe as getBenchRunDetail,he as importAllPreservedRuns,Y as importPreservedRunToStore,Ee as listBenchRuns,_e as recordRunCompletion,I as rollupBenchRunMetrics,V as setBenchRunEvents,ue as setBenchRunHive,de as setBenchRunStatus,ie as taskRowFromFleetResult,z as upsertBenchRun,G as upsertBenchRunTask};
