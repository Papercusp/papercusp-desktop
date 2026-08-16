import{n as s}from"./chunk-ChpBd9eV.js";import{st as a,t as i}from"./src-8fWtxfEz.js";import{n as u,t as l}from"./completion-ref-types-C-kDQ6d5.js";async function c(e){return e.bodyFeatureId?e.bodyFeatureId:e.prUrl?(await(e.sql??a().sql)`
    SELECT feature_id FROM harness_shared.harness_feature_prs
     WHERE harness_slug = ${e.harnessSlug} AND pr_url = ${e.prUrl}
     LIMIT 1
  `)[0]?.feature_id??null:null}async function h(e){if(!e.featureId)return{stamped:!1,reason:"no_feature_id"};if(!e.mergeCommitSha)return{stamped:!1,reason:"empty_sha"};let r;try{r=l({remote:e.remote,branch:e.branch,commit_sha:e.mergeCommitSha.toLowerCase(),pr_url:e.prUrl||void 0,pr_number:e.prNumber})}catch{return{stamped:!1,reason:"invalid_ref"}}const t=e.sql??a().sql,n=e.nowMs??Date.now();return await t`
    UPDATE harness_shared.harness_features_consolidated
       SET completion_ref = ${JSON.stringify(r)}::text::jsonb,
           status = 'shipped',
           updated_ts = ${n}
     WHERE harness_slug = ${e.harnessSlug}
       AND feature_id = ${e.featureId}
       AND completion_ref IS NULL
  `,{stamped:!0,feature_id:e.featureId}}var _=s((()=>{i(),u()}));_();export{c as resolveMergedPrFeatureId,h as stampCompletionRefOnMerge};
