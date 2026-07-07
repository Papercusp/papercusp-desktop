import{n as e}from"./chunk-CMxvf4Kt.js";async function t(e,t,n,r){let i=Date.now();try{await e.pg`
      INSERT INTO harness_shared.harness_run_chunks
        (workspace_id, harness_slug, run_id, seq, chunk_data, ts)
      VALUES (${e.workspaceId}, ${e.harnessSlug}, ${t}, ${n},
              ${r}, ${i})
      ON CONFLICT (workspace_id, harness_slug, run_id, seq) DO NOTHING
    `,await e.pg`
      SELECT pg_notify(${`run:`+t}, ${String(n)})
    `}catch{}}e((()=>{}))();export{t as appendChunkPg};