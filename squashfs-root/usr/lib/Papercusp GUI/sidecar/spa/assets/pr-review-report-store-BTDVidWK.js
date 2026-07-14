import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-BvZp-r10.js";import{n as r,t as i}from"./pg-jsonb-B0anZ9e-.js";function a(e){return e??t().sql}async function o(e){let t=a(e.sql),{report:n}=e;await t`
    INSERT INTO harness_shared.pr_review_reports
      (workspace_id, harness_slug, pr_number, pr_url, head_sha, feature_id,
       recommendation, summary, rationale, risks, checks_observed,
       model, tokens_in, tokens_out, cost_usd_cents, reviewed_at)
    VALUES (
      ${e.workspaceId}, ${e.harnessSlug}, ${e.prNumber}, ${e.prUrl},
      ${e.headSha}, ${e.featureId},
      ${n.recommendation}, ${n.summary}, ${n.rationale},
      ${JSON.stringify(n.risks)}::text::jsonb,
      ${JSON.stringify(n.checksObserved)}::text::jsonb,
      ${e.model}, ${e.tokensIn}, ${e.tokensOut}, ${e.costUsdCents},
      ${e.nowIso??new Date().toISOString()}
    )
    ON CONFLICT (workspace_id, harness_slug, pr_number, head_sha) DO UPDATE SET
      pr_url         = EXCLUDED.pr_url,
      feature_id     = EXCLUDED.feature_id,
      recommendation = EXCLUDED.recommendation,
      summary        = EXCLUDED.summary,
      rationale      = EXCLUDED.rationale,
      risks          = EXCLUDED.risks,
      checks_observed = EXCLUDED.checks_observed,
      model          = EXCLUDED.model,
      tokens_in      = EXCLUDED.tokens_in,
      tokens_out     = EXCLUDED.tokens_out,
      cost_usd_cents = EXCLUDED.cost_usd_cents,
      reviewed_at    = EXCLUDED.reviewed_at
  `}function s(e){return{workspace_id:e.workspace_id,harness_slug:e.harness_slug,pr_number:Number(e.pr_number),pr_url:e.pr_url,head_sha:e.head_sha,feature_id:e.feature_id??null,recommendation:e.recommendation,summary:e.summary,rationale:e.rationale,risks:i(e.risks)??[],checks_observed:i(e.checks_observed)??{},model:e.model,tokens_in:Number(e.tokens_in??0),tokens_out:Number(e.tokens_out??0),cost_usd_cents:Number(e.cost_usd_cents??0),reviewed_at:e.reviewed_at instanceof Date?e.reviewed_at.toISOString():String(e.reviewed_at)}}async function c(e){let t=a(e.sql),n=await t`
    SELECT * FROM harness_shared.pr_review_reports
     WHERE harness_slug = ${e.harnessSlug}
       AND pr_number = ${e.prNumber}
       ${e.workspaceId===void 0?t``:t`AND workspace_id = ${e.workspaceId}`}
     ORDER BY reviewed_at DESC
     LIMIT 1
  `;return n[0]?s(n[0]):null}async function l(e){let t=a(e.sql),n=e.bodyFeatureId??null;if(!n&&e.prUrl&&(n=(await t`
      SELECT feature_id FROM harness_shared.harness_feature_prs
       WHERE harness_slug = ${e.harnessSlug} AND pr_url = ${e.prUrl}
       LIMIT 1
    `)[0]?.feature_id??null),!n)return null;let r=await t`
    SELECT title, summary FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${e.harnessSlug} AND feature_id = ${n}
     LIMIT 1
  `;return{feature_id:n,title:r[0]?.title??null,summary:r[0]?.summary??null}}async function u(e){try{await a(e.sql).unsafe(`INSERT INTO harness_shared.auto_review_audit
         (workspace_id, harness_slug, pr_number, pr_url, author_github_id, reviewer_github_id, action, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,[e.workspaceId,e.harnessSlug,e.prNumber,e.prUrl,e.authorGithubId,e.reviewerGithubId,e.action,e.detail])}catch{}}var d=e((()=>{n(),r()}));export{u as a,o as i,l as n,c as r,d as t};