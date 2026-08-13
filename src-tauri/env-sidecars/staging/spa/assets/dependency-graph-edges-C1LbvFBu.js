import{n as o}from"./chunk-ChpBd9eV.js";async function k(t,d){const i=Math.min(Math.max(1,Math.trunc(d.limit??5e3)),r);return(await t`
    SELECT bd.feature_id  AS blocked_id,
           bk.feature_id  AS blocker_id,
           d.blocker_ref  AS blocker_ref,
           bd.item_kind   AS blocked_kind,
           bk.item_kind   AS blocker_kind,
           bk.status      AS blocker_status,
           -- Endpoint hydration (WI-36045). Free: both rows are already joined below, so
           -- this adds columns to an existing scan rather than a second query.
           bd.title            AS blocked_title,
           bd.status           AS blocked_status,
           bd.source_plan_slug AS blocked_plan_slug,
           bk.title            AS blocker_title,
           bk.source_plan_slug AS blocker_plan_slug
      FROM harness_shared.work_item_deps d
      -- BLOCKED side: inner. An edge whose dependant is not in this harness is not ours.
      JOIN harness_shared.work_items bd
        ON bd.workspace_id = ${d.workspaceId}
       AND bd.harness_slug = ${d.harnessSlug}
       AND (
         (bd.item_kind = ANY (${s}) AND d.blocked_ref = bd.feature_id)
         OR
         (bd.item_kind <> ALL (${s})
           AND d.blocked_ref = bd.harness_slug || '#' || bd.feature_id)
       )
      -- BLOCKER side: LEFT. A blocker resolving to nothing is a dangling edge — a finding the
      -- integrity mode must render, not a row to drop (see header).
      LEFT JOIN harness_shared.work_items bk
        ON bk.workspace_id = ${d.workspaceId}
       AND bk.harness_slug = ${d.harnessSlug}
       AND (
         (bk.item_kind = ANY (${s}) AND d.blocker_ref = bk.feature_id)
         OR
         (bk.item_kind <> ALL (${s})
           AND d.blocker_ref = bk.harness_slug || '#' || bk.feature_id)
       )
     WHERE d.dep_type = 'blocks'
       AND d.workspace_id = ${l}
     ORDER BY bd.feature_id, d.blocker_ref
     LIMIT ${i}`).map(e=>({blockedId:e.blocked_id,blockerId:e.blocker_id,blockerRef:e.blocker_ref,blockedKind:e.blocked_kind,blockerKind:e.blocker_kind,blockerStatus:e.blocker_status,blockedTitle:e.blocked_title,blockedStatus:e.blocked_status,blockedPlanSlug:e.blocked_plan_slug,blockerTitle:e.blocker_title,blockerPlanSlug:e.blocker_plan_slug}))}var l,s,r,_=o((()=>{l="default",s=["bug","change","task"],r=5e3}));_();export{r as DEP_EDGES_MAX_LIMIT,k as resolveDependencyGraphEdges};
