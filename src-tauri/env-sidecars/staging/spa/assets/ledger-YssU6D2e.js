import{n as i}from"./chunk-ChpBd9eV.js";function r(t){if(Array.isArray(t))return t;if(typeof t=="string")try{const e=JSON.parse(t);return Array.isArray(e)?e:[]}catch{return[]}return[]}function n(t){if(t instanceof Date)return t.toISOString();const e=new Date(t);return Number.isFinite(e.getTime())?e.toISOString():String(t??"")}var d,o=i((()=>{d=class{sql;constructor(t){this.sql=t}async listRecent(t,e={}){const a=Math.min(Math.max(e.limit??20,1),200);return(e.testId?await this.sql`
          SELECT * FROM harness_shared.experiment_runs
          WHERE workspace_id = ${t} AND test_id = ${e.testId}
          ORDER BY created_at DESC LIMIT ${a}`:await this.sql`
          SELECT * FROM harness_shared.experiment_runs
          WHERE workspace_id = ${t}
          ORDER BY created_at DESC LIMIT ${a}`).map(s=>({batteryId:s.battery_id,testId:s.test_id,tier:s.tier,winner:s.winner??null,arms:r(s.arms),totalCostUsd:Number(s.total_cost_usd),budgetExhausted:!!s.budget_exhausted,decision:s.decision,createdAt:n(s.created_at)}))}async record(t){await this.sql`
      INSERT INTO harness_shared.experiment_runs
        (workspace_id, battery_id, test_id, tier, arms, baseline_id, winner, comparison,
         total_cost_usd, budget_exhausted)
      VALUES (
        ${t.workspaceId}, ${t.batteryId}, ${t.testId}, ${t.tier},
        ${JSON.stringify(t.arms)}::text::jsonb, ${t.baselineId}, ${t.winner},
        ${t.comparison==null?null:JSON.stringify(t.comparison)}::text::jsonb,
        ${t.totalCostUsd}, ${t.budgetExhausted}
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
    `}}}));export{r as n,o as r,d as t};
