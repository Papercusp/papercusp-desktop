import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{r,t as i}from"./_repo-paths-D8jrjjgF.js";import{t as a}from"./insights-index-ByqUbucz.js";import{i as o,n as s,r as c}from"./recall-stats-tzxcqaRh.js";async function l(e){let t=(await e`
    SELECT
      (SELECT count(*)::int FROM harness_shared.memory_canonical
        WHERE NOT (payload ? 'entityType'))                       AS total_memories,
      (SELECT count(*)::int FROM harness_shared.memory_canonical
        WHERE payload ? 'entityType')                             AS entity_rows,
      (SELECT count(*)::int FROM harness_shared.memory_feedback
        WHERE created_at >= now() - interval '30 days')           AS feedback_30d
  `)[0]??{},n={recalls7d:0,zeroHit7d:0,zeroHitRate7d:0,topScoreP50:null,topScoreP90:null,fragmentHits7d:0},r=!0;try{n=await c(e)}catch(e){r=!1,console.warn(`[memory-health] recall-stats read failed (migration 240 applied?):`,e.message)}let i=[];try{i=await o(e)}catch{}return{...n,recallBySurface:i,recallTelemetryOk:r,totalMemories:Number(t.total_memories??0),entityRows:Number(t.entity_rows??0),feedback30d:Number(t.feedback_30d??0)}}var u;e((()=>{n(),u=t(n(),1),a(),s(),r(),u.join(i,`agent-insights`)}))();export{l as readMemoryHealth};