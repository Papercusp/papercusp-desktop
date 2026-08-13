import{n as o}from"./chunk-ChpBd9eV.js";import{st as t,t as n}from"./src-BmBNODK0.js";async function l(s){const r=s.sql??t().sql,e=s.workspaceId??"",a=s.nowMs??Date.now(),_=s.authorGithubUserId??null;await r`
    INSERT INTO harness_shared.harness_feature_prs
      (workspace_id, harness_slug, feature_id, pr_url, pr_state, opened_ts, updated_ts, author_github_user_id)
    VALUES (${e}, ${s.harnessSlug}, ${s.featureId}, ${s.prUrl}, 'open', ${a}, ${a}, ${_})
    ON CONFLICT (workspace_id, harness_slug, feature_id) DO UPDATE SET
      pr_url = EXCLUDED.pr_url,
      pr_state = 'open',
      updated_ts = EXCLUDED.updated_ts,
      author_github_user_id = COALESCE(EXCLUDED.author_github_user_id, harness_shared.harness_feature_prs.author_github_user_id)
  `}async function c(s){const r=s.sql??t().sql,e=s.nowMs??Date.now();await r`
    UPDATE harness_shared.harness_feature_prs
       SET pr_state = ${s.prState}, updated_ts = ${e}
     WHERE harness_slug = ${s.harnessSlug} AND pr_url = ${s.prUrl}
  `}var u=o((()=>{n()}));u();export{c as markFeaturePrState,l as upsertFeaturePrOnOpen};
