import{n as l}from"./chunk-ChpBd9eV.js";import{s as d}from"./types-B6UfiA7g.js";import{t as m}from"./src-CL56NiZm.js";import{st as o,t as g}from"./src-BmBNODK0.js";import{l as _,o as u}from"./server-CB1HiStO.js";import{n as f,t as h}from"./pg-jsonb-D6Z3WsbA.js";async function C(a){try{if(!await u(d.CHANGE_LEDGER,"change-ledger"))return null;const r=a.mutationClass??s[a.source],{sql:t}=o();return(await t`
      INSERT INTO harness_shared.behavior_change_ledger
        (workspace_id, source, mutation_class, action, target_kind, target,
         harness_slug, role, diff_ref, actor, summary, payload, recorded_at)
      VALUES
        (${a.workspaceId}, ${a.source}, ${r}, ${a.action},
         ${a.targetKind}, ${a.target}, ${a.harnessSlug??null},
         ${a.role??null}, ${a.diffRef??null}, ${a.actor??null},
         ${a.summary??null},
         ${a.payload?JSON.stringify(a.payload):null}::text::jsonb,
         ${a.recordedAtMs!=null?new Date(a.recordedAtMs).toISOString():t`now()`})
      ON CONFLICT DO NOTHING
      RETURNING id`)[0]?.id??null}catch(r){return console.warn(`[change-ledger] FAILED to record ${a.source} change on ${a.target} — EKG attribution has a hole here:`,r instanceof Error?r.message:r),null}}async function N(a,r={}){const{sql:t}=o(),n=Math.min(Math.max(1,r.limit??200),1e3),c=await t`
    SELECT id, workspace_id, recorded_at, source, mutation_class, action,
           target_kind, target, harness_slug, role, diff_ref, actor, summary, payload
      FROM harness_shared.behavior_change_ledger
     WHERE workspace_id = ${a}
       ${r.mutationClass?t`AND mutation_class = ${r.mutationClass}`:t``}
       ${r.sinceMs!=null?t`AND recorded_at >= ${new Date(r.sinceMs).toISOString()}`:t``}
     ORDER BY recorded_at DESC
     LIMIT ${n}`,i=e=>e instanceof Date?e.toISOString():new Date(e).toISOString();return c.map(e=>({id:e.id,workspaceId:e.workspace_id,recordedAt:i(e.recorded_at),source:e.source,mutationClass:e.mutation_class,action:e.action,targetKind:e.target_kind,target:e.target,harnessSlug:e.harness_slug,role:e.role,diffRef:e.diff_ref,actor:e.actor,summary:e.summary,payload:h(e.payload)}))}var s,R=l((()=>{g(),f(),m(),_(),s={"gym:accept":"gym","gym:promotion":"gym","prompts-api":"manual-prompt","repo-scan":"repo-prompt",ablation:"ablation",manual:"manual-prompt"}}));export{C as i,R as n,N as r,s as t};
