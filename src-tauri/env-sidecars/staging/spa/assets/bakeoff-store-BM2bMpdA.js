import{n as s}from"./chunk-ChpBd9eV.js";async function o(t,e){const _=Math.min(Math.max(1,e.limit??50),500);return(await t`
    SELECT flag_key, verdict, delta_mean_composite, delta_gate_pass_rate, run_at_ms
    FROM harness_shared.pot_eval_bakeoff_deltas
    WHERE workspace_id = ${e.workspaceId}
    ORDER BY run_at_ms DESC
    LIMIT ${_}
  `).map(a=>({flagKey:a.flag_key,verdict:a.verdict,deltaMeanComposite:Number(a.delta_mean_composite),deltaGatePassRate:Number(a.delta_gate_pass_rate),at:Number(a.run_at_ms)}))}var r=s((()=>{}));r();export{o as readBakeoffTrendRows};
