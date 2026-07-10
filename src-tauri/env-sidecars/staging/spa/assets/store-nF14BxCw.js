import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,r as n}from"./categories-Cc2AsxTG.js";function r(e){return e?.code===f}function i(e){return e==null?0:e instanceof Date?e.getTime():new Date(e).getTime()}function a(e){return{id:e.id,workspaceId:e.workspace_id,category:e.category,findingClass:e.finding_class,action:e.action,riskTier:e.risk_tier,reversibility:e.reversibility,revertHandle:e.revert_handle??{kind:`unknown`},decision:e.decision,decisionId:e.decision_id??null,status:e.status,tripReason:e.trip_reason??null,armedAtMs:i(e.armed_at),windowUntilMs:i(e.window_until),resolvedAtMs:e.resolved_at==null?null:i(e.resolved_at),revertedAtMs:e.reverted_at==null?null:i(e.reverted_at),resolvedBy:e.resolved_by}}async function o(e,t){try{return(await e`
      SELECT ${e.unsafe(p)}
        FROM harness_shared.autonomy_tripwires
       WHERE workspace_id = ${t} AND status = 'armed'
       ORDER BY armed_at ASC`).filter(e=>n(e.category)).map(a)}catch(e){if(r(e))return[];throw e}}async function s(e,t,n,r,i=`sweep`){await e`
    UPDATE harness_shared.autonomy_tripwires
       SET status = 'cleared', resolved_at = ${new Date(r)}, resolved_by = ${i}
     WHERE workspace_id = ${t} AND id = ${n} AND status = 'armed'`}async function c(e,t,n,r,i,a=`sweep`){await e`
    UPDATE harness_shared.autonomy_tripwires
       SET status = 'tripped', trip_reason = ${r},
           resolved_at = ${new Date(i)}, resolved_by = ${a}
     WHERE workspace_id = ${t} AND id = ${n} AND status = 'armed'`}async function l(e,t,n,r){await e`
    UPDATE harness_shared.autonomy_tripwires
       SET status = 'reverted', reverted_at = ${new Date(r)}
     WHERE workspace_id = ${t} AND id = ${n} AND status = 'tripped'`}async function u(e,t,i){let o=i.nowMs-i.lookbackDays*864e5;try{return(await e`
      SELECT ${e.unsafe(p)}
        FROM harness_shared.autonomy_tripwires
       WHERE workspace_id = ${t} AND armed_at >= to_timestamp(${o} / 1000.0)
       ORDER BY armed_at ASC`).filter(e=>n(e.category)).map(a)}catch(e){if(r(e))return[];throw e}}async function d(e,t,i={}){let o=Math.min(Math.max(i.limit??50,1),500);try{return(await e`
      SELECT ${e.unsafe(p)}
        FROM harness_shared.autonomy_tripwires
       WHERE workspace_id = ${t}
         ${i.status?e`AND status = ${i.status}`:e``}
         ${i.category?e`AND category = ${i.category}`:e``}
       ORDER BY armed_at DESC
       LIMIT ${o}`).filter(e=>n(e.category)).map(a)}catch(e){if(r(e))return[];throw e}}var f,p,m=e((()=>{t(),f=`42P01`,p=`id, workspace_id, category, finding_class, action, risk_tier, reversibility,
  revert_handle, decision, decision_id, status, trip_reason, armed_at, window_until, resolved_at, reverted_at, resolved_by`}));export{l as a,s as i,o as n,c as o,d as r,u as s,m as t};