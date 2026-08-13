import{n as s}from"./chunk-ChpBd9eV.js";import{a as t,d as c,s as o,u}from"./pg-stores-CGlGDhOJ.js";async function p(r,e){await n(r).configureBucket(e)}async function w(r,e){await n(r).configureCircuit(e)}async function y(r,e){await n(r).configureCredits(e)}async function _(r,e){return n(r).grantCredits(e)}async function C(r,e){await n(r).recordCircuitSuccess(e)}async function k(r,e){return n(r).recordCircuitFailure(e)}async function l(r,e){return n(r).admitSpawn(e)}async function m(r,e){return r.begin(async a=>{const i=await a`
      SELECT credits FROM harness_shared.fleet_governor
       WHERE workspace_id = ${e.workspaceId} AND kind = 'credit' AND scope_key = ${e.scopeKey}
       FOR UPDATE`;return!i.length||i[0].credits==null||Number(i[0].credits)<=0?!1:(await a`
      UPDATE harness_shared.fleet_governor SET credits = credits - 1
       WHERE workspace_id = ${e.workspaceId} AND kind = 'credit' AND scope_key = ${e.scopeKey}`,!0)})}function v(r){return`spawn-budget:${r}`}var n,E=s((()=>{u(),t(),n=r=>c(o(r))}));export{_ as a,C as c,y as i,v as l,p as n,E as o,w as r,k as s,l as t,m as u};
