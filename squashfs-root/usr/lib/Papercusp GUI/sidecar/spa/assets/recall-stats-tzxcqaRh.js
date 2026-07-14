import{n as e}from"./chunk-CMxvf4Kt.js";function t(e){let t=0;for(let n of e)typeof n.metadata?.entityType==`string`&&(t+=1);return t}async function n(e,n){try{let r=n.entries.map(e=>e.score).filter(e=>typeof e==`number`&&Number.isFinite(e)),i=r.length>0?Math.max(...r):null;await e`
      INSERT INTO harness_shared.memory_recall_stats
        (surface, hit_count, top_score, scores, fragment_count)
      VALUES (
        ${n.surface},
        ${n.entries.length},
        ${i},
        ${JSON.stringify(r)}::text::jsonb,
        ${t(n.entries)}
      )
    `}catch(e){s+=1;let t=Date.now();if(t-o>=a){let r=s-1;console.warn(`[memory-recall-stats] capture failed (surface='${n.surface}')`+(r>0?` — +${r} more since last warn`:``)+`; re-warns at most once/${a/6e4}min:`,e.message),o=t,s=0}}}async function r(e){let t=(await e`
    SELECT
      count(*)::int                                   AS recalls,
      count(*) FILTER (WHERE hit_count = 0)::int      AS zero_hits,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY top_score)
        FILTER (WHERE top_score IS NOT NULL)          AS p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY top_score)
        FILTER (WHERE top_score IS NOT NULL)          AS p90,
      coalesce(sum(fragment_count), 0)::int           AS fragment_hits
    FROM harness_shared.memory_recall_stats
    WHERE created_at >= now() - interval '7 days'
  `)[0]??{},n=Number(t.recalls??0),r=Number(t.zero_hits??0);return{recalls7d:n,zeroHit7d:r,zeroHitRate7d:n>0?r/n:0,topScoreP50:t.p50==null?null:Number(t.p50),topScoreP90:t.p90==null?null:Number(t.p90),fragmentHits7d:Number(t.fragment_hits??0)}}async function i(e){return(await e`
    SELECT
      surface,
      count(*)::int                                   AS recalls,
      count(*) FILTER (WHERE hit_count = 0)::int      AS zero_hits,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY top_score)
        FILTER (WHERE top_score IS NOT NULL)          AS p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY top_score)
        FILTER (WHERE top_score IS NOT NULL)          AS p90,
      coalesce(sum(fragment_count), 0)::int           AS fragment_hits
    FROM harness_shared.memory_recall_stats
    WHERE created_at >= now() - interval '7 days'
    GROUP BY surface
    ORDER BY count(*) DESC
  `).map(e=>{let t=Number(e.recalls??0),n=Number(e.zero_hits??0);return{surface:String(e.surface??`unknown`),recalls7d:t,zeroHit7d:n,zeroHitRate7d:t>0?n/t:0,topScoreP50:e.p50==null?null:Number(e.p50),topScoreP90:e.p90==null?null:Number(e.p90),fragmentHits7d:Number(e.fragment_hits??0)}})}var a,o,s,c=e((()=>{a=5*6e4,o=0,s=0}));export{n as a,i,c as n,r,t};