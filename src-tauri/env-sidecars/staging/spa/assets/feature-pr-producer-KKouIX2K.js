import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CRqYcphb.js";async function r(e){let n=e.sql??t().sql,r=e.workspaceId??``,i=e.nowMs??Date.now(),a=e.authorGithubUserId??null;await n`
    INSERT INTO harness_shared.harness_feature_prs
      (workspace_id, harness_slug, feature_id, pr_url, pr_state, opened_ts, updated_ts, author_github_user_id)
    VALUES (${r}, ${e.harnessSlug}, ${e.featureId}, ${e.prUrl}, 'open', ${i}, ${i}, ${a})
    ON CONFLICT (workspace_id, harness_slug, feature_id) DO UPDATE SET
      pr_url = EXCLUDED.pr_url,
      pr_state = 'open',
      updated_ts = EXCLUDED.updated_ts,
      author_github_user_id = COALESCE(EXCLUDED.author_github_user_id, harness_shared.harness_feature_prs.author_github_user_id)
  `}async function i(e){let n=e.sql??t().sql,r=e.nowMs??Date.now();await n`
    UPDATE harness_shared.harness_feature_prs
       SET pr_state = ${e.prState}, updated_ts = ${r}
     WHERE harness_slug = ${e.harnessSlug} AND pr_url = ${e.prUrl}
  `}e((()=>{n()}))();export{i as markFeaturePrState,r as upsertFeaturePrOnOpen};