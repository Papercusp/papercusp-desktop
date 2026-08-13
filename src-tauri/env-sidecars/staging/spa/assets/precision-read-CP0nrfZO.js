import{n as i}from"./chunk-ChpBd9eV.js";function e(n){return n==null?null:Number(n)}function u(n){return{ranAt:n.ran_at instanceof Date?n.ran_at.toISOString():String(n.ran_at??""),backend:String(n.backend??"hybrid"),fpAt5:e(n.fp_at_5),rAt10:e(n.r_at_10),pAt5:e(n.p_at_5),mrr:e(n.mrr),medianTopScore:e(n.median_top_score),floorCosine:Number(n.floor_cosine??0),floorLex:Number(n.floor_lex??0),corpusN:Number(n.corpus_n??0),goldN:Number(n.gold_n??0),latencyP50Ms:e(n.latency_p50_ms),notes:n.notes==null||String(n.notes)===""?null:String(n.notes)}}async function f(n,r,o=8){const t=(await n`
    SELECT ran_at, backend, fp_at_5, r_at_10, p_at_5, mrr, median_top_score,
           floor_cosine, floor_lex, corpus_n, gold_n, latency_p50_ms, notes
      FROM harness_shared.memory_precision_bench
     WHERE workspace_id = ${r}
     ORDER BY ran_at DESC
     LIMIT ${Math.max(1,o)}
  `).map(u),s=t[0]??null,a=t[1]??null,l=s?.fpAt5!=null&&a?.fpAt5!=null?s.fpAt5-a.fpAt5:null;let _=t.length;try{const c=await n`
      SELECT count(*)::int AS n FROM harness_shared.memory_precision_bench
       WHERE workspace_id = ${r}
    `;_=Number(c[0]?.n??t.length)}catch{}return{latest:s,trend:t,fpAt5Delta:l,runCount:_}}async function m(n,r,o){const t=await n`
    INSERT INTO harness_shared.memory_precision_bench
      (workspace_id, backend, corpus_version, gold_version, corpus_n, gold_n,
       floor_cosine, floor_lex, fp_at_5, r_at_10, p_at_5, mrr, median_top_score,
       latency_p50_ms, by_class, cost_usd, notes)
    VALUES
      (${r}, ${o.backend}, ${o.corpusVersion}, ${o.goldVersion}, ${o.corpusN}, ${o.goldN},
       ${o.floorCosine}, ${o.floorLex}, ${o.fpAt5}, ${o.rAt10}, ${o.pAt5}, ${o.mrr}, ${o.medianTopScore},
       ${o.latencyP50Ms}, ${JSON.stringify(o.byClass)}::text::jsonb, ${o.costUsd??null}, ${o.notes??null})
    RETURNING id
  `;return Number(t[0]?.id??0)}var p,$=i((()=>{p={latest:null,trend:[],fpAt5Delta:null,runCount:0}}));export{m as i,$ as n,f as r,p as t};
