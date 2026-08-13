import{n as $}from"./chunk-ChpBd9eV.js";function b(e,a){const t={executionPath:a,outcomeKind:e.kind,chunksCommitted:null,replanStrikes:null,escalatedChunkId:null,detail:null,resumed:e.resumed??null,totalReplans:e.totalReplans??null,chunksCommittedSoFar:e.chunksCommittedSoFar??null,totalChunksPlanned:e.totalChunksPlanned??null,abortReason:e.kind==="aborted"?e.abortReason??null:null};switch(e.kind){case"completed":return{...t,chunksCommitted:e.chunksCommitted};case"planning_failed":return{...t,detail:c(e.error)};case"escalated":return{...t,replanStrikes:e.strikes,escalatedChunkId:e.chunk.id,detail:c(e.reason)};case"aborted":return{...t,detail:c(e.reason)}}}async function P(e,a){try{const t=b(a.outcome,a.executionPath),s=a.atMs??Date.now();return await e.pg`
      INSERT INTO harness_shared.worker_chunk_loop_outcomes
        (workspace_id, harness_slug, feature_id, execution_path, outcome_kind,
         chunks_committed, replan_strikes, escalated_chunk_id, detail, created_ts,
         resumed, abort_reason, total_replans, chunks_committed_so_far, total_chunks_planned)
      VALUES
        (${e.workspaceId}, ${e.harnessSlug}, ${a.featureId}, ${t.executionPath},
         ${t.outcomeKind}, ${t.chunksCommitted}, ${t.replanStrikes},
         ${t.escalatedChunkId}, ${t.detail}, ${s},
         ${t.resumed}, ${t.abortReason}, ${t.totalReplans}, ${t.chunksCommittedSoFar},
         ${t.totalChunksPlanned})
    `,!0}catch(t){return a.log?.(`worker-chunk outcome persist failed (non-fatal): ${t instanceof Error?t.message:String(t)}`),!1}}async function g(e,a={}){const t=a.sinceMs??0,s=Math.max(1,Math.min(a.limit??5e3,2e4)),o=a.harnessSlug??null;return(await e.pg`
    SELECT execution_path, outcome_kind, chunks_committed, replan_strikes,
           escalated_chunk_id, detail, resumed, abort_reason, total_replans,
           chunks_committed_so_far, total_chunks_planned
    FROM harness_shared.worker_chunk_loop_outcomes
    WHERE workspace_id = ${e.workspaceId}
      AND created_ts >= ${t}
      AND (${o}::text IS NULL OR harness_slug = ${o})
    ORDER BY created_ts DESC
    LIMIT ${s}
  `).map(l=>({executionPath:l.execution_path,outcomeKind:l.outcome_kind,chunksCommitted:l.chunks_committed,replanStrikes:l.replan_strikes,escalatedChunkId:l.escalated_chunk_id,detail:l.detail,resumed:l.resumed??null,abortReason:l.abort_reason??null,totalReplans:l.total_replans??null,chunksCommittedSoFar:l.chunks_committed_so_far??null,totalChunksPlanned:l.total_chunks_planned??null}))}function f(e,a){const t=S();let s=0,o=0,l=0,d=0,m=0,p=0,u=0,_=0,i=0,C=0,R=0,k=0;for(const n of a)t[n.outcomeKind]=(t[n.outcomeKind]??0)+1,n.outcomeKind==="escalated"&&n.replanStrikes!=null&&(s+=n.replanStrikes,o+=1),n.outcomeKind==="completed"&&n.chunksCommitted!=null&&(l+=n.chunksCommitted,d+=1),n.outcomeKind==="aborted"&&n.abortReason==="lock_contention"&&(m+=1),n.totalReplans!=null&&(p+=n.totalReplans,u+=1,n.totalReplans>0&&(_+=1)),n.resumed&&(i+=1,n.outcomeKind==="completed"&&(C+=1)),n.chunksCommittedSoFar!=null&&n.totalChunksPlanned!=null&&n.totalChunksPlanned>0&&(R+=n.chunksCommittedSoFar,k+=n.totalChunksPlanned);const r=a.length;return{path:e,total:r,completionRate:r===0?null:t.completed/r,distribution:t,avgReplanStrikes:o===0?null:s/o,avgChunksCommitted:d===0?null:l/d,lockContentionCount:m,lockContentionRate:r===0?null:m/r,avgTotalReplans:u===0?null:p/u,replanRate:u===0?null:_/u,resumedCount:i,resumedCompletionRate:i===0?null:C/i,perChunkDurability:k===0?null:R/k}}function E(e){const a=f("subprocess",e.filter(o=>o.executionPath==="subprocess")),t=f("op",e.filter(o=>o.executionPath==="op")),s=a.completionRate==null||t.completionRate==null?null:t.completionRate-a.completionRate;return{byPath:{subprocess:a,op:t},completionRateDelta:s}}var h,c,S,w=$((()=>{h=2e3,c=e=>e==null?null:e.length<=h?e:`${e.slice(0,h)}…`,S=()=>({completed:0,planning_failed:0,escalated:0,aborted:0})}));export{E as a,P as i,b as n,g as r,w as t};
