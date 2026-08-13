import{n as i}from"./chunk-ChpBd9eV.js";import{st as _,t as u}from"./src-BmBNODK0.js";import{n as o,t as a}from"./pg-jsonb-D6Z3WsbA.js";function t(e){return e??_().sql}async function E(e){const s=t(e.sql),{report:r}=e;await s`
    INSERT INTO harness_shared.pr_review_reports
      (workspace_id, harness_slug, pr_number, pr_url, head_sha, feature_id,
       recommendation, summary, rationale, risks, checks_observed,
       model, tokens_in, tokens_out, cost_usd_cents, reviewed_at)
    VALUES (
      ${e.workspaceId}, ${e.harnessSlug}, ${e.prNumber}, ${e.prUrl},
      ${e.headSha}, ${e.featureId},
      ${r.recommendation}, ${r.summary}, ${r.rationale},
      ${JSON.stringify(r.risks)}::text::jsonb,
      ${JSON.stringify(r.checksObserved)}::text::jsonb,
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
  `}function d(e){return{workspace_id:e.workspace_id,harness_slug:e.harness_slug,pr_number:Number(e.pr_number),pr_url:e.pr_url,head_sha:e.head_sha,feature_id:e.feature_id??null,recommendation:e.recommendation,summary:e.summary,rationale:e.rationale,risks:a(e.risks)??[],checks_observed:a(e.checks_observed)??{},model:e.model,tokens_in:Number(e.tokens_in??0),tokens_out:Number(e.tokens_out??0),cost_usd_cents:Number(e.cost_usd_cents??0),reviewed_at:e.reviewed_at instanceof Date?e.reviewed_at.toISOString():String(e.reviewed_at)}}async function p(e){const s=t(e.sql),r=await s`
    SELECT * FROM harness_shared.pr_review_reports
     WHERE harness_slug = ${e.harnessSlug}
       AND pr_number = ${e.prNumber}
       ${e.workspaceId!==void 0?s`AND workspace_id = ${e.workspaceId}`:s``}
     ORDER BY reviewed_at DESC
     LIMIT 1
  `;return r[0]?d(r[0]):null}async function k(e){const s=t(e.sql);let r=e.bodyFeatureId??null;if(!r&&e.prUrl&&(r=(await s`
      SELECT feature_id FROM harness_shared.harness_feature_prs
       WHERE harness_slug = ${e.harnessSlug} AND pr_url = ${e.prUrl}
       LIMIT 1
    `)[0]?.feature_id??null),!r)return null;const n=await s`
    SELECT title, summary FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${e.harnessSlug} AND feature_id = ${r}
     LIMIT 1
  `;return{feature_id:r,title:n[0]?.title??null,summary:n[0]?.summary??null}}async function D(e){try{await t(e.sql).unsafe(`INSERT INTO harness_shared.auto_review_audit
         (workspace_id, harness_slug, pr_number, pr_url, author_github_id, reviewer_github_id, action, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,[e.workspaceId,e.harnessSlug,e.prNumber,e.prUrl,e.authorGithubId,e.reviewerGithubId,e.action,e.detail])}catch{}}var $=i((()=>{u(),o()}));export{D as a,E as i,k as n,p as r,$ as t};
