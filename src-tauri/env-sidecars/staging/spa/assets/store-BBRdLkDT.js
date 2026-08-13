import{n as d}from"./chunk-ChpBd9eV.js";import{n as l,t as _}from"./db-BC-byBW_.js";function a(e){if(e==null)return null;if(typeof e=="string")try{return JSON.parse(e)}catch{return null}return e}function c(e){return{runId:e.run_id,suite:e.suite,modality:e.modality,taskId:e.task_id,arm:e.arm,seed:Number(e.seed),resolved:e.resolved===null||e.resolved===void 0?null:!!e.resolved,score:u(e.score),graderStatus:e.grader_status,graderFamily:e.grader_family,graderVersion:e.grader_version,failToPass:a(e.fail_to_pass),passToPass:a(e.pass_to_pass),tokensIn:r(e.tokens_in),tokensOut:r(e.tokens_out),tokensTotal:r(e.tokens_total),tokensCacheRead:u(e.tokens_cache_read),tokensCacheWrite:u(e.tokens_cache_write),costUsd:r(e.cost_usd),priceTableVersion:e.price_table_version,wallClockMs:r(e.wall_clock_ms),turns:r(e.turns),budgetTokens:u(e.budget_tokens),capped:!!e.capped,generationStatus:e.generation_status,generationError:e.generation_error??null,armMeta:a(e.arm_meta),modelId:e.model_id,harnessVersion:e.harness_version,preregHash:e.prereg_hash,rolloutId:e.rollout_id,rawGraderOutputRef:e.raw_grader_output_ref??null,submissionRef:e.submission_ref??null,createdAt:i(e.created_at)}}function m(e){return{rolloutId:e.rollout_id,runId:e.run_id,preregHash:e.prereg_hash,suite:e.suite,taskId:e.task_id,arm:e.arm,seed:Number(e.seed),configSnapshot:a(e.config_snapshot),modelId:e.model_id,modelVersion:e.model_version??null,harnessVersion:e.harness_version,harnessGitSha:e.harness_git_sha??null,envFingerprint:a(e.env_fingerprint),graderFamily:e.grader_family,graderVersion:e.grader_version,graderOutput:a(e.grader_output),rawGraderOutput:e.raw_grader_output??null,submission:e.submission??null,trajectoryRef:e.trajectory_ref??null,trajectoryKind:e.trajectory_kind??null,createdAt:i(e.created_at)}}function g(e){return{preregHash:e.prereg_hash,runId:e.run_id,label:e.label??null,suites:a(e.suites)??[],config:a(e.config)??{},filePath:e.file_path,gitCommitted:!!e.git_committed,gitCommitSha:e.git_commit_sha??null,createdAt:i(e.created_at)}}async function k(e={}){const{sql:t,ws:s}=l(e);return(await t`
    SELECT * FROM harness_shared.benchmark_run_result
     WHERE workspace_id = ${s}
       ${e.runId?t`AND run_id = ${e.runId}`:t``}
       ${e.suite?t`AND suite = ${e.suite}`:t``}
     ORDER BY suite, task_id, arm, seed
  `).map(c)}async function I(e={}){const{sql:t,ws:s}=l(e);return(await t`
    SELECT suite,
           count(DISTINCT run_id)::int AS runs,
           count(*)::int AS attempts,
           count(*) FILTER (WHERE resolved IS TRUE)::int AS resolved,
           count(*) FILTER (WHERE resolved IS NULL)::int AS infra,
           max(created_at) AS latest_at
      FROM harness_shared.benchmark_run_result
     WHERE workspace_id = ${s}
       ${e.runId?t`AND run_id = ${e.runId}`:t``}
     GROUP BY suite
     ORDER BY suite
  `).map(n=>({suite:n.suite,runs:n.runs,attempts:n.attempts,resolved:n.resolved,infra:n.infra,latestAt:n.latest_at?i(n.latest_at):null}))}async function R(e,t={}){const{sql:s,ws:n}=l(t),o=await s`
    SELECT * FROM harness_shared.benchmark_rollout
     WHERE rollout_id = ${e} AND workspace_id = ${n} LIMIT 1
  `;return o.length?m(o[0]):null}async function E(e,t={}){const{sql:s,ws:n}=l(t);if(!e.preregHash&&!e.runId)return null;const o=await s`
    SELECT * FROM harness_shared.benchmark_prereg
     WHERE workspace_id = ${n}
       ${e.preregHash?s`AND prereg_hash = ${e.preregHash}`:s``}
       ${e.runId?s`AND run_id = ${e.runId}`:s``}
     LIMIT 1
  `;return o.length?g(o[0]):null}var r,u,i,h=d((()=>{_(),r=e=>e==null?0:Number(e),u=e=>e==null?null:Number(e),i=e=>e instanceof Date?e.toISOString():String(e)}));h();export{E as getPrereg,R as getRollout,k as listRunResults,I as listSuites};
