import{n as e}from"./chunk-CMxvf4Kt.js";import{U as t,t as n}from"./src-CRqYcphb.js";async function r(e){return t(e,async e=>e`
      SELECT t.platform, t.token
      FROM harness_shared.mobile_push_tokens t
      JOIN harness_shared.mobile_devices d ON d.device_id = t.device_id
      WHERE d.revoked_at IS NULL
    `)}e((()=>{n()}))();export{r as pushTargetsForWorkspace};