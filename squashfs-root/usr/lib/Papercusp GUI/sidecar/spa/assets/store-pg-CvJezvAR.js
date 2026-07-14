import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./pg-jsonb-B0anZ9e-.js";function r(e){return new i(e)}var i;e((()=>{t(),i=class{sql;constructor(e){this.sql=e}async upsertInstance(e){await this.sql`
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
    `}async finishRun(e,t){let n=t.observations;await this.sql`
      UPDATE harness_shared.pot_eval_runs
      SET
        finished_at = ${t.finishedAt.toISOString()},
        terminal_state = ${n.terminalState},
        wall_clock_ms = ${n.wallClockMs},
        frontier_drained = ${n.frontierDrained},
        work_items_total = ${n.workItemsTotal},
        work_items_completed = ${n.workItemsCompleted},
        cost_usd = ${n.costUsd},
        observations = ${JSON.stringify(n)}::text::jsonb,
        trace_ref = ${t.traceRef||null}
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
    `}async getScore(e,t){let r=(await this.sql`
      SELECT run_id, rubric_hash, rubric_version, outcome_gate_passed, efficiency_score, speed_score,
             composite, judge_composite, regressions, planted_bug_caught, fabrication_detected,
             critical_path_ratio, floor_ceiling, detail, scored_at
      FROM harness_shared.pot_eval_scores
      WHERE run_id = ${e} AND rubric_hash = ${t}
    `)[0];return r?{runId:r.run_id,rubricHash:r.rubric_hash,rubricVersion:r.rubric_version,outcomeGatePassed:r.outcome_gate_passed,efficiencyScore:Number(r.efficiency_score),speedScore:Number(r.speed_score),composite:Number(r.composite),judgeComposite:r.judge_composite==null?void 0:Number(r.judge_composite),regressions:r.regressions,plantedBugCaught:r.planted_bug_caught,fabricationDetected:r.fabrication_detected,criticalPathRatio:Number(r.critical_path_ratio),floorCeiling:Number(r.floor_ceiling),detail:n(r.detail),scoredAt:r.scored_at}:null}}}))();export{i as HiveEvalStorePg,r as createPgHiveEvalStore};