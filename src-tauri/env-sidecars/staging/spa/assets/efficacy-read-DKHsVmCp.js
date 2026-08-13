import{n as l}from"./chunk-ChpBd9eV.js";async function v(e,r){const t=(await e`
    SELECT
      count(*) FILTER (WHERE outcome IS NOT NULL)::int AS matured,
      count(*) FILTER (WHERE outcome = true)::int      AS survived,
      count(*)::int                                    AS total
      FROM harness_shared.calibration_predictions
     WHERE workspace_id = ${r}
       AND domain = 'fix-survival'
       AND signal_origin = 'organic'
  `)[0]??{matured:0,survived:0,total:0},n=Number(t.matured),a=Number(t.total);return n>0?{value:Number(t.survived)/n,sample:n,state:"ok",detail:`${t.survived}/${n} matured fix-survival bets held (${a} placed)`}:{value:null,sample:0,state:a>0?"warming":"none",detail:a>0?`${a} bets placed, none matured yet (~14d horizon)`:"no fix-survival bets yet"}}async function m(e,r){const t=(await e`
    SELECT
      count(*) FILTER (WHERE payload->'ideaLifecycle'->>'state' = 'verified')::int AS verified,
      count(*) FILTER (WHERE payload->'ideaLifecycle'->>'state' = 'recurred')::int AS recurred
      FROM harness_shared.engineer_issues
     WHERE workspace_id = ${r}
       AND payload->'ideaLifecycle'->>'state' IN ('verified', 'recurred')
  `)[0]??{verified:0,recurred:0},n=Number(t.verified),a=Number(t.recurred),i=n+a;return i>0?{value:n/i,sample:i,state:"ok",detail:`${n} verified / ${a} recurred (of ${i} that reached a verdict)`}:{value:null,sample:0,state:"warming",detail:"no fixes have reached a verify/recur verdict yet (~14d quiet window)"}}function f(e,r){const t=e.filter(i=>i.meanComposite!=null);if(t.length===0)return{value:null,sample:0,state:e.length>0?"warming":"none",detail:e.length>0?`${e.length} generation(s) run, none judged yet`:"no benchmark generations yet (the IQ-battery is owner-budget-gated)"};const n=t[0],a=n.meanComposite;return{value:a-r,sample:t.length,state:"ok",detail:`gen ${n.codeSha.slice(0,8)} composite ${a.toFixed(2)} vs gen-0 ${r.toFixed(2)}`}}function p(e){const r=e.latest;if(r&&r.fpAt5!=null){const t=e.fpAt5Delta,n=t==null?"":t<=0?` (↓${Math.abs(t).toFixed(2)})`:` (↑${t.toFixed(2)})`;return{value:r.fpAt5,sample:e.runCount,state:"ok",detail:`FP@5 ${r.fpAt5.toFixed(2)}${n} over ${e.runCount} bench run(s) @ floor ${r.floorCosine}/${r.floorLex}`}}return{value:null,sample:e.runCount,state:e.runCount>0?"warming":"none",detail:e.runCount>0?"bench ran but no hard-negative score yet":"memory not benchmarked yet (weekly cadence)"}}var u,o,c,d=l((()=>{u={championId:"gen0-93b50cb39",composite:5.95},o={value:null,sample:0,state:"none"},c={autoFixSurvival:o,championDelta:o,recurrenceDecay:o,memoryFpAt5:o,gen0Baseline:{...u}}}));d();export{c as EMPTY_EFFICACY,u as GEN0_BASELINE,f as championDeltaMetric,p as memoryFpAt5Metric,v as readAutoFixSurvival,m as readRecurrenceDecay};
