import{n as s}from"./chunk-ChpBd9eV.js";import{n as c,t as o}from"./pg-jsonb-D6Z3WsbA.js";function d(e){return new a(e)}var a,r=s((()=>{c(),a=class{sql;constructor(e){this.sql=e}async upsertInstance(e){await this.sql`
      INSERT INTO harness_shared.pot_eval_instances
        (instance_id, workspace_id, code_sha, genome_id, battery_slice_id)
      VALUES
        (${e.instanceId}, ${e.workspaceId}, ${e.codeSha}, ${e.genomeId||null}, ${e.batterySliceId||null})
      ON CONFLICT (instance_id) DO NOTHING
    `}async upsertScenario(e){await this.sql`
      INSERT INTO harness_shared.pot_eval_scenarios
        (scenario_id, title, shape, ideal_wall_clock_units, ideal_cup_count, total_units,
         critical_path, work_item_count, planted_bug_location)
      VALUES
        (${e.scenarioId}, ${e.title}, ${e.shape}, ${e.idealWallClockUnits}, ${e.idealBeeCount},
         ${e.totalUnits}, ${e.criticalPath==null?null:JSON.stringify(e.criticalPath)}::text::jsonb, ${e.workItemCount}, ${e.plantedBugLocation})
      ON CONFLICT (scenario_id) DO UPDATE SET
        title = EXCLUDED.title,
        shape = EXCLUDED.shape,
        ideal_wall_clock_units = EXCLUDED.ideal_wall_clock_units,
        ideal_cup_count = EXCLUDED.ideal_cup_count,
        total_units = EXCLUDED.total_units,
        critical_path = EXCLUDED.critical_path,
        work_item_count = EXCLUDED.work_item_count,
        planted_bug_location = EXCLUDED.planted_bug_location
    `}async startRun(e){await this.sql`
      INSERT INTO harness_shared.pot_eval_runs
        (run_id, instance_id, scenario_id, shape, repeat, seed, budget_usd_cap, cup_cap, started_at)
      VALUES
        (${e.runId}, ${e.instanceId}, ${e.scenarioId}, ${e.shape}, ${e.repeat}, ${e.seed},
         ${e.budgetUsdCap}, ${e.beeCap}, ${e.startedAt.toISOString()})
      ON CONFLICT (run_id) DO UPDATE SET
        instance_id = EXCLUDED.instance_id,
        scenario_id = EXCLUDED.scenario_id,
        shape = EXCLUDED.shape,
        repeat = EXCLUDED.repeat,
        seed = EXCLUDED.seed,
        budget_usd_cap = EXCLUDED.budget_usd_cap,
        cup_cap = EXCLUDED.cup_cap,
        started_at = EXCLUDED.started_at,
        finished_at = NULL,
        terminal_state = NULL,
        wall_clock_ms = NULL,
        frontier_drained = NULL,
        work_items_total = NULL,
        work_items_completed = NULL,
        cost_usd = NULL,
        observations = NULL,
        trace_ref = NULL
    `}async finishRun(e,i){const t=i.observations;await this.sql`
      UPDATE harness_shared.pot_eval_runs
      SET
        finished_at = ${i.finishedAt.toISOString()},
        terminal_state = ${t.terminalState},
        wall_clock_ms = ${t.wallClockMs},
        frontier_drained = ${t.frontierDrained},
        work_items_total = ${t.workItemsTotal},
        work_items_completed = ${t.workItemsCompleted},
        cost_usd = ${t.costUsd},
        observations = ${JSON.stringify(t)}::text::jsonb,
        trace_ref = ${i.traceRef||null}
      WHERE run_id = ${e}
    `}async upsertScore(e){await this.sql`
      INSERT INTO harness_shared.pot_eval_scores
        (run_id, rubric_hash, rubric_version, outcome_gate_passed, efficiency_score, speed_score,
         composite, judge_composite, regressions, planted_bug_caught, fabrication_detected,
         critical_path_ratio, floor_ceiling, detail)
      VALUES
        (${e.runId}, ${e.rubricHash}, ${e.rubricVersion}, ${e.outcomeGatePassed},
         ${e.efficiencyScore}, ${e.speedScore}, ${e.composite}, ${e.judgeComposite??null},
         ${e.regressions}, ${e.plantedBugCaught}, ${e.fabricationDetected},
         ${e.criticalPathRatio}, ${e.floorCeiling}, ${e.detail==null?null:JSON.stringify(e.detail)}::text::jsonb)
      ON CONFLICT (run_id, rubric_hash) DO UPDATE SET
        rubric_version = EXCLUDED.rubric_version,
        outcome_gate_passed = EXCLUDED.outcome_gate_passed,
        efficiency_score = EXCLUDED.efficiency_score,
        speed_score = EXCLUDED.speed_score,
        composite = EXCLUDED.composite,
        judge_composite = EXCLUDED.judge_composite,
        regressions = EXCLUDED.regressions,
        planted_bug_caught = EXCLUDED.planted_bug_caught,
        fabrication_detected = EXCLUDED.fabrication_detected,
        critical_path_ratio = EXCLUDED.critical_path_ratio,
        floor_ceiling = EXCLUDED.floor_ceiling,
        detail = EXCLUDED.detail,
        scored_at = now()
    `}async getScore(e,i){const t=(await this.sql`
      SELECT run_id, rubric_hash, rubric_version, outcome_gate_passed, efficiency_score, speed_score,
             composite, judge_composite, regressions, planted_bug_caught, fabrication_detected,
             critical_path_ratio, floor_ceiling, detail, scored_at
      FROM harness_shared.pot_eval_scores
      WHERE run_id = ${e} AND rubric_hash = ${i}
    `)[0];return t?{runId:t.run_id,rubricHash:t.rubric_hash,rubricVersion:t.rubric_version,outcomeGatePassed:t.outcome_gate_passed,efficiencyScore:Number(t.efficiency_score),speedScore:Number(t.speed_score),composite:Number(t.composite),judgeComposite:t.judge_composite==null?void 0:Number(t.judge_composite),regressions:t.regressions,plantedBugCaught:t.planted_bug_caught,fabricationDetected:t.fabrication_detected,criticalPathRatio:Number(t.critical_path_ratio),floorCeiling:Number(t.floor_ceiling),detail:o(t.detail),scoredAt:t.scored_at}:null}}}));r();export{a as HiveEvalStorePg,d as createPgHiveEvalStore};
