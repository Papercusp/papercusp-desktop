import{n as c}from"./chunk-ChpBd9eV.js";function _(e){return e instanceof Date?e.toISOString():typeof e=="string"?e:""}async function m(e,n){const r=Math.min(Math.max(n.limit??20,1),100);return(await e`
    SELECT
      i.instance_id,
      i.code_sha,
      i.created_at,
      count(DISTINCT r.run_id)::int                                      AS total_runs,
      count(*) FILTER (WHERE s.success)::int                             AS successful_runs,
      avg(s.composite)                                                   AS mean_composite,
      avg(s.time_to_green_secs) FILTER (WHERE s.success)                 AS mean_time_to_green,
      avg(s.tokens_per_task) FILTER (WHERE s.success)                    AS mean_tokens,
      avg(CASE WHEN s.escalation THEN 1.0 ELSE 0.0 END)                  AS escalation_rate,
      avg(CASE WHEN s.first_attempt_pass THEN 1.0 ELSE 0.0 END)         AS first_attempt_rate
    FROM harness_shared.cup_keeper_instances i
    JOIN harness_shared.cup_keeper_runs r   ON r.instance_id = i.instance_id
    LEFT JOIN harness_shared.cup_keeper_scores s ON s.run_id = r.run_id
    WHERE i.workspace_id = ${n.workspaceId}
    GROUP BY i.instance_id, i.code_sha, i.created_at
    ORDER BY i.created_at DESC
    LIMIT ${r}`).map(s=>{const a=Number(s.total_runs??0),i=Number(s.successful_runs??0);return{instanceId:String(s.instance_id),codeSha:String(s.code_sha??""),createdAt:_(s.created_at),totalRuns:a,successfulRuns:i,successRate:a?i/a:0,meanComposite:t(s.mean_composite),meanTimeToGreenSecs:t(s.mean_time_to_green),meanTokens:t(s.mean_tokens),escalationRate:t(s.escalation_rate),firstAttemptRate:t(s.first_attempt_rate)}})}var t,o=c((()=>{t=e=>e==null?null:Number(e)}));o();export{m as readApiaryInstanceSummaries};
