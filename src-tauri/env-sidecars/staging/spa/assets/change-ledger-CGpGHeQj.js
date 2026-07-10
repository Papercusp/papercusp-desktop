import{n as e}from"./chunk-CMxvf4Kt.js";import{a as t}from"./types-lEAL9ctp.js";import{t as n}from"./src-BIeYfY9a.js";import{a as r,c as i}from"./server-BdkZUoEn.js";import{q as a,t as o}from"./src-C8OEUO3c.js";import{n as s,t as c}from"./pg-jsonb-B0anZ9e-.js";async function l(e){try{if(!await r(t.CHANGE_LEDGER,`change-ledger`))return null;let n=e.mutationClass??d[e.source],{sql:i}=a();return(await i`
      INSERT INTO harness_shared.behavior_change_ledger
        (workspace_id, source, mutation_class, action, target_kind, target,
         harness_slug, role, diff_ref, actor, summary, payload, recorded_at)
      VALUES
        (${e.workspaceId}, ${e.source}, ${n}, ${e.action},
         ${e.targetKind}, ${e.target}, ${e.harnessSlug??null},
         ${e.role??null}, ${e.diffRef??null}, ${e.actor??null},
         ${e.summary??null},
         ${e.payload?JSON.stringify(e.payload):null}::text::jsonb,
         ${e.recordedAtMs==null?i`now()`:new Date(e.recordedAtMs).toISOString()})
      ON CONFLICT DO NOTHING
      RETURNING id`)[0]?.id??null}catch(t){return console.warn(`[change-ledger] FAILED to record ${e.source} change on ${e.target} — EKG attribution has a hole here:`,t instanceof Error?t.message:t),null}}async function u(e,t={}){let{sql:n}=a(),r=Math.min(Math.max(1,t.limit??200),1e3),i=await n`
    SELECT id, workspace_id, recorded_at, source, mutation_class, action,
           target_kind, target, harness_slug, role, diff_ref, actor, summary, payload
      FROM harness_shared.behavior_change_ledger
     WHERE workspace_id = ${e}
       ${t.mutationClass?n`AND mutation_class = ${t.mutationClass}`:n``}
       ${t.sinceMs==null?n``:n`AND recorded_at >= ${new Date(t.sinceMs).toISOString()}`}
     ORDER BY recorded_at DESC
     LIMIT ${r}`,o=e=>e instanceof Date?e.toISOString():new Date(e).toISOString();return i.map(e=>({id:e.id,workspaceId:e.workspace_id,recordedAt:o(e.recorded_at),source:e.source,mutationClass:e.mutation_class,action:e.action,targetKind:e.target_kind,target:e.target,harnessSlug:e.harness_slug,role:e.role,diffRef:e.diff_ref,actor:e.actor,summary:e.summary,payload:c(e.payload)}))}var d,f=e((()=>{o(),s(),n(),i(),d={"gym:accept":`gym`,"gym:promotion":`gym`,"prompts-api":`manual-prompt`,"repo-scan":`repo-prompt`,ablation:`ablation`,manual:`manual-prompt`}}));export{l as i,f as n,u as r,d as t};