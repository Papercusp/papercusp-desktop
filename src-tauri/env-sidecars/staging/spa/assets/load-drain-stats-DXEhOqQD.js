import{n as d}from"./chunk-ChpBd9eV.js";function u(n){if(n==null)return 0;if(typeof n=="number")return Number.isFinite(n)?n:0;const s=Number.parseInt(n,10);return Number.isFinite(s)?s:0}async function _(n){const s=n.nowMs??Date.now(),e=new Map;let r;try{r=await n.runQuery(`SELECT workspace_id, harness_slug,
              COUNT(*) AS undrained,
              MIN(ts)  AS oldest_ts
         FROM harness_shared.substrate_outbox
        WHERE drained_at IS NULL
          AND quarantined_at IS NULL
        GROUP BY workspace_id, harness_slug`,[])}catch{return e}for(const t of r){const a=u(t.undrained);if(a<=0)continue;let o=null;if(t.oldest_ts!=null){const i=u(t.oldest_ts);i>0&&(o=Math.max(0,s-i))}e.set(`${t.workspace_id}::${t.harness_slug}`,{undrainedCount:a,oldestUndrainedAgeMs:o})}return e}var c=d((()=>{}));export{_ as n,c as t};
