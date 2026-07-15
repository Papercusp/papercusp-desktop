import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-C4H77EbW.js";import{n as r,t as i}from"./completion-ref-types-B6qBIlzv.js";async function a(e){return e.bodyFeatureId?e.bodyFeatureId:e.prUrl?(await(e.sql??t().sql)`
    SELECT feature_id FROM harness_shared.harness_feature_prs
     WHERE harness_slug = ${e.harnessSlug} AND pr_url = ${e.prUrl}
     LIMIT 1
  `)[0]?.feature_id??null:null}async function o(e){if(!e.featureId)return{stamped:!1,reason:`no_feature_id`};if(!e.mergeCommitSha)return{stamped:!1,reason:`empty_sha`};let n;try{n=i({remote:e.remote,branch:e.branch,commit_sha:e.mergeCommitSha.toLowerCase(),pr_url:e.prUrl||void 0,pr_number:e.prNumber})}catch{return{stamped:!1,reason:`invalid_ref`}}let r=e.sql??t().sql,a=e.nowMs??Date.now();return await r`
    UPDATE harness_shared.harness_features_consolidated
       SET completion_ref = ${JSON.stringify(n)}::text::jsonb,
           status = 'shipped',
           updated_ts = ${a}
     WHERE harness_slug = ${e.harnessSlug}
       AND feature_id = ${e.featureId}
       AND completion_ref IS NULL
  `,{stamped:!0,feature_id:e.featureId}}e((()=>{n(),r()}))();export{a as resolveMergedPrFeatureId,o as stampCompletionRefOnMerge};