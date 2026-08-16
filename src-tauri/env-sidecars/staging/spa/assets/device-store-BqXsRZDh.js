import{n as i}from"./chunk-ChpBd9eV.js";import{Q as a,t as r}from"./src-8fWtxfEz.js";async function d(e){return a(e,async s=>s`
      SELECT device_id, user_email, workspace_id, device_kind, device_label,
             paired_at, last_seen, revoked_at
      FROM harness_shared.mobile_devices
      WHERE revoked_at IS NULL
      ORDER BY paired_at DESC
    `)}async function c(e,s){await a(e,async t=>{await t`DELETE FROM harness_shared.mobile_push_tokens WHERE token = ${s}`})}async function E(e){return a(e,async s=>s`
      SELECT t.platform, t.token
      FROM harness_shared.mobile_push_tokens t
      JOIN harness_shared.mobile_devices d ON d.device_id = t.device_id
      WHERE d.revoked_at IS NULL
    `)}var h=i((()=>{r()}));export{E as i,h as n,d as r,c as t};
