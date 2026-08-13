import{n as d}from"./chunk-ChpBd9eV.js";import{st as l,t as u}from"./src-BmBNODK0.js";import{c as f,r as c}from"./workspace-registry-Du2UbhlH.js";import{E as g,h as _}from"./messages-DA3ma2xE.js";async function D(e){const a=e.log??(()=>{}),i=e.workspaceId??c(),o=e.deps?.send??g;let r=null;try{const n=e.deps?.sql??l().sql;if(r=(await n`
      SELECT parent_slug FROM harness_shared.projects
       WHERE slug = ${e.harnessSlug} AND parent_slug IS NOT NULL
       LIMIT 1
    `)[0]?.parent_slug??null,!r)return{notified:!1,reason:"no_parent"};const s=(await n`
      SELECT count(*)::int AS n
        FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${i}
         AND harness_slug = ${e.harnessSlug}
         AND feature_id  <> ${e.featureId??""}
         AND status NOT IN ('passed', 'deprecated', 'done', 'dropped')
    `)[0]?.n??0;if(s>0)return{notified:!1,parent:r,reason:"queue_not_drained",remaining:s}}catch(n){return a(`[afterDone] parent/drain lookup failed (non-fatal): ${n instanceof Error?n.message:String(n)}`),{notified:!1,reason:"lookup_failed"}}try{return await o({...t,ownerId:`harness-afterdone:${e.harnessSlug}`},{to:[r],summary:`mission DONE: ${e.harnessSlug}`,body:`Harness ${e.harnessSlug} finished its queue`+(e.featureId?` (last feature: ${e.featureId})`:"")+". All features are terminal (passed/deprecated).",harnessSlug:e.harnessSlug,category:"harness-lifecycle"}),a(`[afterDone] notified parent ${r}: mission DONE (${e.harnessSlug})`),{notified:!0,parent:r}}catch(n){return a(`[afterDone] Completion send to ${r} threw (non-fatal): ${n instanceof Error?n.message:String(n)}`),{notified:!1,parent:r,reason:"send_failed"}}}var t,h=d((()=>{u(),_(),f(),t={ownerId:"harness-afterdone",ownerLabel:"harness afterDone builtin",source:"static-client",workspaceId:null,userId:null}}));h();export{D as notifyParentOnDone};
