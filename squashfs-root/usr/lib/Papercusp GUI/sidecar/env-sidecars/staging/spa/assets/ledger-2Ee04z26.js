import{n as e}from"./chunk-CMxvf4Kt.js";function t(e){if(Array.isArray(e))return e;if(typeof e==`string`)try{let t=JSON.parse(e);return Array.isArray(t)?t:[]}catch{return[]}return[]}var n;e((()=>{n=class{sql;constructor(e){this.sql=e}async listRecent(e,n={}){let r=Math.min(Math.max(n.limit??20,1),200);return(n.testId?await this.sql`
          SELECT * FROM harness_shared.experiment_runs
          WHERE workspace_id = ${e} AND test_id = ${n.testId}
          ORDER BY created_at DESC LIMIT ${r}`:await this.sql`
          SELECT * FROM harness_shared.experiment_runs
          WHERE workspace_id = ${e}
          ORDER BY created_at DESC LIMIT ${r}`).map(e=>({batteryId:e.battery_id,testId:e.test_id,tier:e.tier,winner:e.winner??null,arms:t(e.arms),totalCostUsd:Number(e.total_cost_usd),budgetExhausted:!!e.budget_exhausted,decision:e.decision,createdAt:e.created_at.toISOString()}))}async record(e){await this.sql`
      INSERT INTO harness_shared.experiment_runs
        (workspace_id, battery_id, test_id, tier, arms, baseline_id, winner, comparison,
         total_cost_usd, budget_exhausted)
      VALUES (
        ${e.workspaceId}, ${e.batteryId}, ${e.testId}, ${e.tier},
        ${JSON.stringify(e.arms)}::text::jsonb, ${e.baselineId}, ${e.winner},
        ${e.comparison==null?null:JSON.stringify(e.comparison)}::text::jsonb,
        ${e.totalCostUsd}, ${e.budgetExhausted}
      )
      ON CONFLICT (workspace_id, battery_id) DO UPDATE SET
        test_id          = EXCLUDED.test_id,
        tier             = EXCLUDED.tier,
        arms             = EXCLUDED.arms,
        baseline_id      = EXCLUDED.baseline_id,
        winner           = EXCLUDED.winner,
        comparison       = EXCLUDED.comparison,
        total_cost_usd   = EXCLUDED.total_cost_usd,
        budget_exhausted = EXCLUDED.budget_exhausted,
        updated_at       = now()
    `}}}))();export{n as PgExperimentLedger};