import{n as m,o as c}from"./chunk-ChpBd9eV.js";import{t as d}from"./__vite-browser-external-56mrcCg8.js";import{t as k}from"./src-DiJ46u-6.js";import{i as f}from"./sync-sse-VXiL_m-9.js";import{n as _,t as b}from"./db-i3q5vBYA.js";function w(e){return{runId:e.run_id,suite:e.suite,arm:e.arm,tasks:Number(e.tasks),resolved:Number(e.resolved),wallClockMs:Number(e.wall_clock_ms),costUsd:Number(e.cost_usd),tokensTotal:Number(e.tokens_total),tasksZeroHumanGate:Number(e.tasks_zero_human_gate),peakConcurrency:e.peak_concurrency==null?null:Number(e.peak_concurrency)}}async function y(e={}){const{sql:n,ws:a}=_(e);return(await n`
    SELECT * FROM harness_shared.benchmark_fleet_run
     WHERE workspace_id = ${a} ${e.runId?n`AND run_id = ${e.runId}`:n``}
     ORDER BY suite, arm, seed
  `).map(w)}async function M(e,n={}){const{sql:a,ws:r}=_(n),i=await a`
    SELECT arm FROM harness_shared.benchmark_fleet_run
     WHERE fleet_run_id = ${e} AND workspace_id = ${r} LIMIT 1
  `;if(i.length===0)return null;const u=await a`
    SELECT ts, kind, agent, task_id, detail FROM harness_shared.benchmark_coord_event
     WHERE fleet_run_id = ${e} AND workspace_id = ${r}
     ORDER BY seq
  `,o=new Set,l=u.map(t=>{t.agent&&o.add(t.agent);const s={kind:t.kind};return t.ts!=null&&(s.ts=Number(t.ts)),t.agent!=null&&(s.agent=t.agent),t.task_id!=null&&(s.taskId=t.task_id),t.detail!=null&&(s.detail=t.detail),s});return{arm:i[0].arm,agents:[...o],events:l}}var E,p=m((()=>{E=c(d(),1),k(),f(),b()}));p();export{M as getCoordTrace,y as listFleetRuns};
