import{n as t}from"./chunk-ChpBd9eV.js";function n(s,r){(async()=>{try{await s`
        INSERT INTO harness_shared.prompt_compositions
          (workspace_id, harness_slug, feature_id, role, run_id, ts_ms,
           total_chars, substrate_chars, history_chars,
           role_prompt_chars, memory_chars, identity_chars, runtime_chars)
        VALUES
          (${r.workspaceId}, ${r.harnessSlug}, ${r.featureId},
           ${r.role}, ${r.runId}, ${Date.now()},
           ${r.totalChars}, ${r.substrateChars}, ${r.historyChars},
           ${r.rolePromptChars??null}, ${r.memoryChars??null},
           ${r.identityChars??null}, ${r.runtimeChars??null})
      `}catch{}})()}var a=t((()=>{}));a();export{n as recordPromptComposition};
