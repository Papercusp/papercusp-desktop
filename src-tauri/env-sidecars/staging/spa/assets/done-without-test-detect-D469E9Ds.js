const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/src-q56SuDEp.js","assets/src-CgbVJkBN.js","assets/chunk-CMxvf4Kt.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-BUBAcz5Q.js","assets/__vite-browser-external-CM3Eme-n.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";function r(e,t){return t.filter(t=>Array.isArray(t.coversVALs)&&t.coversVALs.includes(e))}function i(e,t){let n=r(e,t);return n.length===0?`todo`:n.some(e=>e.status===`failing`)?`failed`:n.every(e=>e.status===`passing`)?`passed`:`validating`}function a(e,t){let n={};for(let a of e){let e=n[a.item_id]??{itemId:a.item_id,valsTotal:0,valsRequiringTest:0,valsCovered:0,valsPassing:0};e.valsTotal+=1,a.requires_test&&(e.valsRequiringTest+=1,r(a.val_id,t).length>0&&(e.valsCovered+=1),i(a.val_id,t)===`passed`&&(e.valsPassing+=1)),n[a.item_id]=e}return n}var o=e((()=>{}));function s(e,t){return`${e}\x00${t}`}function c(e,t,n){let r=a(t.map(e=>({val_id:e.valId,item_id:s(e.planSlug,e.itemId),requires_test:!0})),[...n]),i=new Map;for(let t of e){let e=0,n=0;for(let i of t.planItemIds){let a=r[s(t.planSlug,i)];a&&(e+=a.valsRequiringTest,n+=a.valsPassing)}if(e>0&&n<e){let e=i.get(t.harnessSlug)??[];e.push(t.workItemId),i.set(t.harnessSlug,e)}}return[...i].map(([e,t])=>({source:`done-without-test`,key:e,title:`Done work-items missing a passing test: ${e}`,body:`${t.length} work-item(s) in ${e} are marked done (terminal/passed) but carry requires_test VAL(s) with no passing covering test: ${t.join(`, `)}. A claimed-done feature whose required VALs were never proven by a framework test is the "done without test" recurrence (enforce-system-on-generic-work P-009) — the harness-test gate must not let it return silently.`,severity:`major`,scope:`harness:${e}`,findingClass:`test-gate:done-without-test`,count:t.length,workItemIds:t}))}async function l(e){let{getOrgPg:t}=await n(async()=>{let{getOrgPg:e}=await import(`./src-q56SuDEp.js`);return{getOrgPg:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8])),{sql:r}=t(),i=await r`
    SELECT feature_id, harness_slug, source_plan_slug, source_plan_item_ids
      FROM harness_shared.harness_features_consolidated
     WHERE workspace_id = ${e}
       AND status = 'passed'
       AND source_plan_slug IS NOT NULL
       AND source_plan_item_ids IS NOT NULL
       AND array_length(source_plan_item_ids, 1) > 0
     ORDER BY harness_slug
     LIMIT 500
  `;if(i.length===0)return{signals:[]};let a=[...new Set(i.map(e=>e.harness_slug))],o=await r`
    SELECT harness_slug, plan_slug, item_id, val_id
      FROM harness_shared.harness_plan_assertions
     WHERE workspace_id = ${e}
       AND requires_test = true
       AND harness_slug = ANY(${a})
       AND plan_slug = ANY(${[...new Set(i.map(e=>e.source_plan_slug))]})
  `,s=await r`
    SELECT harness_slug, status, payload
      FROM harness_shared.harness_tests
     WHERE workspace_id = ${e}
       AND harness_slug = ANY(${a})
  `,l=e=>{let t=e?.coversVALs;return Array.isArray(t)?t.filter(e=>typeof e==`string`):[]},u=[];for(let e of a){let t=i.filter(t=>t.harness_slug===e).map(e=>({workItemId:e.feature_id,harnessSlug:e.harness_slug,planSlug:e.source_plan_slug,planItemIds:e.source_plan_item_ids??[]})),n=o.filter(t=>t.harness_slug===e).map(e=>({planSlug:e.plan_slug,itemId:e.item_id,valId:e.val_id})),r=s.filter(t=>t.harness_slug===e).map(e=>({coversVALs:l(e.payload),status:e.status}));u.push(...c(t,n,r))}return{signals:u}}e((()=>{o(),t()}))();export{l as collectDoneWithoutTestSignals};