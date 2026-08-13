import{n as c}from"./chunk-ChpBd9eV.js";import{st as i,t as o}from"./src-BmBNODK0.js";import{c as _,r as n}from"./workspace-registry-Du2UbhlH.js";async function f(s){const t=s.workspaceId??n(),{sql:e}=i(),a=r=>r==null?null:JSON.stringify(r);await e`
    INSERT INTO harness_shared.scout_cycle_stage_artifacts
      (workspace_id, install_slug, cycle_id, ideas, scored, proposals, ideator_slots)
    VALUES (${t}, ${s.installSlug??null}, ${s.cycleId},
            ${a(s.ideas)}::text::jsonb, ${a(s.scored)}::text::jsonb,
            ${a(s.proposals)}::text::jsonb, ${a(s.ideatorSlots)}::text::jsonb)
    ON CONFLICT (workspace_id, cycle_id) DO NOTHING`,await e`
    DELETE FROM harness_shared.scout_cycle_stage_artifacts
     WHERE workspace_id = ${t}
       AND id NOT IN (
         SELECT id FROM harness_shared.scout_cycle_stage_artifacts
          WHERE workspace_id = ${t}
          ORDER BY created_at DESC
          LIMIT ${30})`}var l,d=c((()=>{o(),_(),l=30}));d();export{f as persistStageArtifacts};
