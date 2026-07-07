import{n as e}from"./chunk-CMxvf4Kt.js";function t(e,t){(async()=>{try{await e`
        INSERT INTO harness_shared.prompt_compositions
          (workspace_id, harness_slug, feature_id, role, run_id, ts_ms,
           total_chars, substrate_chars, history_chars,
           role_prompt_chars, memory_chars, identity_chars, runtime_chars)
        VALUES
          (${t.workspaceId}, ${t.harnessSlug}, ${t.featureId},
           ${t.role}, ${t.runId}, ${Date.now()},
           ${t.totalChars}, ${t.substrateChars}, ${t.historyChars},
           ${t.rolePromptChars??null}, ${t.memoryChars??null},
           ${t.identityChars??null}, ${t.runtimeChars??null})
      `}catch{}})()}e((()=>{}))();export{t as recordPromptComposition};