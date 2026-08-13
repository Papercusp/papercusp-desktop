const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/src-Bpk9Bd0g.js","assets/src-BmBNODK0.js","assets/chunk-ChpBd9eV.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js"])))=>i.map(i=>d[i]);
import{n as m}from"./chunk-ChpBd9eV.js";import{n as h,t as f}from"./preload-helper-CcgcQsTF.js";import{r as w,t as I}from"./harness-test-rollup-BZ8j3hrt.js";function p(r,l){return`${r}\0${l}`}function A(r,l,_){const i=I(l.map(e=>({val_id:e.valId,item_id:p(e.planSlug,e.itemId),requires_test:!0})),[..._]),a=new Map;for(const e of r){let n=0,u=0;for(const o of e.planItemIds){const t=i[p(e.planSlug,o)];t&&(n+=t.valsRequiringTest,u+=t.valsPassing)}if(n>0&&u<n){const o=a.get(e.harnessSlug)??[];o.push(e.workItemId),a.set(e.harnessSlug,o)}}return[...a].map(([e,n])=>({source:"done-without-test",key:e,title:`Done work-items missing a passing test: ${e}`,body:`${n.length} work-item(s) in ${e} are marked done (terminal/passed) but carry requires_test VAL(s) with no passing covering test: ${n.join(", ")}. A claimed-done feature whose required VALs were never proven by a framework test is the "done without test" recurrence (enforce-system-on-generic-work P-009) — the harness-test gate must not let it return silently.`,severity:"major",scope:`harness:${e}`,findingClass:"test-gate:done-without-test",count:n.length,workItemIds:n}))}async function D(r){const{getOrgPg:l}=await f(async()=>{const{getOrgPg:t}=await import("./src-Bpk9Bd0g.js");return{getOrgPg:t}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10])),{sql:_}=l(),i=await _`
    SELECT feature_id, harness_slug, source_plan_slug, source_plan_item_ids
      FROM harness_shared.harness_features_consolidated
     WHERE workspace_id = ${r}
       AND status = 'passed'
       AND source_plan_slug IS NOT NULL
       AND source_plan_item_ids IS NOT NULL
       AND array_length(source_plan_item_ids, 1) > 0
     ORDER BY harness_slug
     LIMIT 500
  `;if(i.length===0)return{signals:[]};const a=[...new Set(i.map(t=>t.harness_slug))],e=await _`
    SELECT harness_slug, plan_slug, item_id, val_id
      FROM harness_shared.harness_plan_assertions
     WHERE workspace_id = ${r}
       AND requires_test = true
       AND harness_slug = ANY(${a})
       AND plan_slug = ANY(${[...new Set(i.map(t=>t.source_plan_slug))]})
  `,n=await _`
    SELECT harness_slug, status, payload
      FROM harness_shared.harness_tests
     WHERE workspace_id = ${r}
       AND harness_slug = ANY(${a})
  `,u=t=>{const c=t?.coversVALs;return Array.isArray(c)?c.filter(g=>typeof g=="string"):[]},o=[];for(const t of a){const c=i.filter(s=>s.harness_slug===t).map(s=>({workItemId:s.feature_id,harnessSlug:s.harness_slug,planSlug:s.source_plan_slug,planItemIds:s.source_plan_item_ids??[]})),g=e.filter(s=>s.harness_slug===t).map(s=>({planSlug:s.plan_slug,itemId:s.item_id,valId:s.val_id})),d=n.filter(s=>s.harness_slug===t).map(s=>({coversVALs:u(s.payload),status:s.status}));o.push(...A(c,g,d))}return{signals:o}}var y=m((()=>{w(),h()}));y();export{D as collectDoneWithoutTestSignals};
