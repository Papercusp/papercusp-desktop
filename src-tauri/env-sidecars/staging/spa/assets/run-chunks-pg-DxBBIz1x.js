import{n as e}from"./chunk-ChpBd9eV.js";async function h(n,s,a,r){const _=Date.now();try{await n.pg`
      INSERT INTO harness_shared.harness_run_chunks
        (workspace_id, harness_slug, run_id, seq, chunk_data, ts)
      VALUES (${n.workspaceId}, ${n.harnessSlug}, ${s}, ${a},
              ${r}, ${_})
      ON CONFLICT (workspace_id, harness_slug, run_id, seq) DO NOTHING
    `,await n.pg`
      SELECT pg_notify(${"run:"+s}, ${String(a)})
    `}catch{}}var i=e((()=>{}));i();export{h as appendChunkPg};
