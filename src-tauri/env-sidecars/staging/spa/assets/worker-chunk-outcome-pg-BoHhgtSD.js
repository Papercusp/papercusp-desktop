import{n as e}from"./chunk-CMxvf4Kt.js";function t(e,t){let n={executionPath:t,outcomeKind:e.kind,chunksCommitted:null,replanStrikes:null,escalatedChunkId:null,detail:null,resumed:e.resumed??null,totalReplans:e.totalReplans??null,chunksCommittedSoFar:e.chunksCommittedSoFar??null,totalChunksPlanned:e.totalChunksPlanned??null,abortReason:e.kind===`aborted`?e.abortReason??null:null};switch(e.kind){case`completed`:return{...n,chunksCommitted:e.chunksCommitted};case`planning_failed`:return{...n,detail:i(e.error)};case`escalated`:return{...n,replanStrikes:e.strikes,escalatedChunkId:e.chunk.id,detail:i(e.reason)};case`aborted`:return{...n,detail:i(e.reason)}}}async function n(e,n){try{let r=t(n.outcome,n.executionPath),i=n.atMs??Date.now();return await e.pg`
      INSERT INTO harness_shared.worker_chunk_loop_outcomes
        (workspace_id, harness_slug, feature_id, execution_path, outcome_kind,
         chunks_committed, replan_strikes, escalated_chunk_id, detail, created_ts,
         resumed, abort_reason, total_replans, chunks_committed_so_far, total_chunks_planned)
      VALUES
        (${e.workspaceId}, ${e.harnessSlug}, ${n.featureId}, ${r.executionPath},
         ${r.outcomeKind}, ${r.chunksCommitted}, ${r.replanStrikes},
         ${r.escalatedChunkId}, ${r.detail}, ${i},
         ${r.resumed}, ${r.abortReason}, ${r.totalReplans}, ${r.chunksCommittedSoFar},
         ${r.totalChunksPlanned})
    `,!0}catch(e){return n.log?.(`worker-chunk outcome persist failed (non-fatal): ${e instanceof Error?e.message:String(e)}`),!1}}var r,i,a=e((()=>{r=2e3,i=e=>e==null?null:e.length<=r?e:`${e.slice(0,r)}…`}));export{t as n,n as r,a as t};