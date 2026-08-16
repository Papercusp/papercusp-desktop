import{n as i}from"./chunk-ChpBd9eV.js";import{st as a,t as o}from"./src-8fWtxfEz.js";async function d(e,s={}){try{if(!e?.ownerId)return;const n=a().sql,r=s.currentFiles===void 0?null:JSON.stringify(s.currentFiles);await n`
      INSERT INTO harness_shared.session_briefs
        (owner_id, workspace_id, owner_label, source, intent,
         current_plan_slug, current_files, harness_slug, pot_slug, goal_id,
         native_session_id, first_seen_at, updated_at)
      VALUES (
        ${e.ownerId},
        ${e.workspaceId??"default"},
        ${e.ownerLabel??""},
        ${e.source??""},
        ${s.intent??""},
        ${s.currentPlanSlug??null},
        COALESCE(${r}::text::jsonb, '[]'::jsonb),
        ${s.harnessSlug??null},
        ${s.potSlug??null},
        ${s.goalId??null},
        ${s.nativeSessionId??null},
        now(), now()
      )
      ON CONFLICT (owner_id) DO UPDATE SET
        workspace_id      = EXCLUDED.workspace_id,
        owner_label       = EXCLUDED.owner_label,
        source            = EXCLUDED.source,
        intent            = EXCLUDED.intent,
        current_plan_slug = EXCLUDED.current_plan_slug,
        -- omitted ⇒ untouched, explicit [] ⇒ clear (EI-18776963284535761); reads the
        -- parameter directly, not EXCLUDED (the VALUES row COALESCEd it to '[]').
        current_files     = COALESCE(${r}::text::jsonb, harness_shared.session_briefs.current_files),
        -- populate-once-then-keep: a write that omits harness/hive/session never WIPES
        -- a previously-resolved value (mirrors coord_presence D-004).
        harness_slug      = COALESCE(EXCLUDED.harness_slug, harness_shared.session_briefs.harness_slug),
        pot_slug         = COALESCE(EXCLUDED.pot_slug, harness_shared.session_briefs.pot_slug),
        -- Same populate-once-then-keep as the lanes above, and it matters more
        -- here: goal context is written ONCE at launch, while presence/intent
        -- writes fire constantly and all omit it. Plain assignment would erase
        -- a descendant's goal on its very next heartbeat (D-008).
        goal_id           = COALESCE(EXCLUDED.goal_id, harness_shared.session_briefs.goal_id),
        native_session_id = COALESCE(EXCLUDED.native_session_id, harness_shared.session_briefs.native_session_id),
        updated_at        = now()
    `}catch{}}function t(e){return{ownerId:String(e.owner_id),workspaceId:String(e.workspace_id),ownerLabel:String(e.owner_label??""),source:String(e.source??""),intent:String(e.intent??""),currentPlanSlug:e.current_plan_slug??null,currentFiles:Array.isArray(e.current_files)?e.current_files:[],harnessSlug:e.harness_slug??null,potSlug:e.pot_slug??null,goalId:e.goal_id??null,nativeSessionId:e.native_session_id??null,firstSeenAt:String(e.first_seen_at??""),updatedAt:String(e.updated_at??"")}}async function c(e){try{const s=a().sql;if(e.ownerId){const n=await s`
        SELECT * FROM harness_shared.session_briefs WHERE owner_id = ${e.ownerId} LIMIT 1
      `;return n[0]?t(n[0]):null}if(e.nativeSessionId){const n=await s`
        SELECT * FROM harness_shared.session_briefs
        WHERE native_session_id = ${e.nativeSessionId}
        ORDER BY updated_at DESC LIMIT 1
      `;return n[0]?t(n[0]):null}return null}catch{return null}}var E=i((()=>{o()}));export{E as n,d as r,c as t};
