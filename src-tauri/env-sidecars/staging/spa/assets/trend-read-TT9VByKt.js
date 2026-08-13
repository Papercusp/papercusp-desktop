import{n as s}from"./chunk-ChpBd9eV.js";import{a as r,r as _,t as c}from"./scoring-BGZJoAkZ.js";function o(e){return e instanceof Date?e.toISOString():typeof e=="string"?e:""}async function p(e,i){const n=Math.min(Math.max(i.limit??20,1),100);return(await e`
    SELECT
      i.instance_id,
      i.code_sha,
      i.created_at,
      count(DISTINCT r.run_id)::int                                       AS total_runs,
      count(s.run_id)::int                                                AS scored_runs,
      avg(s.composite)                                                    AS mean_composite,
      avg(s.efficiency_score)                                             AS mean_efficiency,
      avg(s.speed_score)                                                  AS mean_speed,
      avg(s.critical_path_ratio)                                          AS mean_critical_path_ratio,
      -- ::int (not CASE-WHEN) so an UNSCORED run (NULL LEFT JOIN) stays NULL and avg ignores it —
      -- a CASE WHEN NULL would score 0 and wrongly drag the rate down over unscored runs.
      avg(s.outcome_gate_passed::int)                                     AS gate_pass_rate,
      avg(s.fabrication_detected::int)                                    AS fabrication_rate
    FROM harness_shared.pot_eval_instances i
    JOIN harness_shared.pot_eval_runs r       ON r.instance_id = i.instance_id
    LEFT JOIN harness_shared.pot_eval_scores s ON s.run_id = r.run_id AND s.rubric_hash = ${i.rubricHash??_(c)}
    WHERE i.workspace_id = ${i.workspaceId}
    GROUP BY i.instance_id, i.code_sha, i.created_at
    ORDER BY i.created_at DESC
    LIMIT ${n}`).map(a=>({instanceId:String(a.instance_id),codeSha:String(a.code_sha??""),createdAt:o(a.created_at),totalRuns:Number(a.total_runs??0),scoredRuns:Number(a.scored_runs??0),meanComposite:t(a.mean_composite),meanEfficiency:t(a.mean_efficiency),meanSpeed:t(a.mean_speed),meanCriticalPathRatio:t(a.mean_critical_path_ratio),outcomeGatePassRate:t(a.gate_pass_rate),fabricationRate:t(a.fabrication_rate)}))}var t,d=s((()=>{r(),t=e=>e==null?null:Number(e)}));d();export{p as readHiveEvalInstanceSummaries};
