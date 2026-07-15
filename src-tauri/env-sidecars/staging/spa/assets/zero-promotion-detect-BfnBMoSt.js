const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/server-COcuK_NM.js","assets/server-Dbwl6Oih.js","assets/chunk-CMxvf4Kt.js","assets/types-qZw2Z8cE.js","assets/src-80MlgAIG.js","assets/src-C_84UHfx.js","assets/flag-distinct-id-BfIfK3hx.js","assets/flag-distinct-id-BZ5cCTSq.js","assets/__vite-browser-external-CM3Eme-n.js","assets/src-CK4XKdGu.js","assets/src-C4H77EbW.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-CXmc9pS7.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";function r(e){return e.filter(e=>e.openItemCount>0&&e.workItemCount===0).map(e=>({source:`zero-promotion`,key:e.planSlug,title:`Started plan has open items but zero work-items: ${e.planSlug}`,body:`Plan ${e.planSlug} (${e.harnessSlug}) has ${e.openItemCount} open plan-item(s) but 0 work-items. plan→work-item promotion is not producing placeable work, so the Mug has nothing to place from it (unified-work-item-ledger P-003/P-009).`,severity:`major`,scope:`harness:${e.harnessSlug}`,findingClass:`promotion:zero-conversion`}))}async function i(e){let{getFlag:t}=await n(async()=>{let{getFlag:e}=await import(`./server-COcuK_NM.js`);return{getFlag:e}},__vite__mapDeps([0,1,2,3])),{FLAGS:i}=await n(async()=>{let{FLAGS:e}=await import(`./src-80MlgAIG.js`);return{FLAGS:e}},__vite__mapDeps([4,5,2,3])),{systemDistinctId:a}=await n(async()=>{let{systemDistinctId:e}=await import(`./flag-distinct-id-BfIfK3hx.js`);return{systemDistinctId:e}},__vite__mapDeps([6,7,2,8]));if(!await t(i.PLAN_WORKITEM_PROMOTION,a()))return{signals:[],note:`dark: papercusp-plan-workitem-promotion OFF`};let{getOrgPg:o}=await n(async()=>{let{getOrgPg:e}=await import(`./src-CK4XKdGu.js`);return{getOrgPg:e}},__vite__mapDeps([9,10,2,11,12,13,8,14,15])),{sql:s}=o();return{signals:r((await s`
    WITH started AS (
      SELECT harness_slug, plan_slug, items
        FROM harness_shared.harness_plans
       WHERE workspace_id = ${e}
         AND op_status = 'started'
         AND COALESCE(archived, false) = false
    ),
    open_counts AS (
      SELECT s.harness_slug, s.plan_slug,
             COUNT(*) FILTER (
               WHERE COALESCE(it->>'status', 'todo') NOT IN ('done', 'dropped')
             )::int AS open_items
        FROM started s
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(s.items, '[]'::jsonb)) it ON true
       GROUP BY s.harness_slug, s.plan_slug
    ),
    wi_counts AS (
      SELECT source_plan_slug AS plan_slug, harness_slug, COUNT(*)::int AS work_items
        FROM harness_shared.work_items
       WHERE workspace_id = ${e}
         AND source_plan_slug IS NOT NULL
       GROUP BY source_plan_slug, harness_slug
    )
    SELECT o.harness_slug, o.plan_slug, o.open_items,
           COALESCE(w.work_items, 0) AS work_items
      FROM open_counts o
      LEFT JOIN wi_counts w
        ON w.plan_slug = o.plan_slug AND w.harness_slug = o.harness_slug
     WHERE o.open_items > 0
     ORDER BY o.open_items DESC
     LIMIT 50
  `).map(e=>({planSlug:e.plan_slug,harnessSlug:e.harness_slug,openItemCount:Number(e.open_items),workItemCount:Number(e.work_items)})))}}e((()=>{t()}))();export{i as collectZeroPromotionSignals};