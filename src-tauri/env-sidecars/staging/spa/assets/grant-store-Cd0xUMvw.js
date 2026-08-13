import{n as _}from"./chunk-ChpBd9eV.js";import{st as s,t as c}from"./src-BmBNODK0.js";import{r as p}from"./coordination-event-log-browser-s_EyGDm7.js";import{t as u}from"./capabilities-ByKQbq_Q.js";function i(e){const r=e?.trim();return r&&r!=="*"&&r!=="default"?r:void 0}function h(e){return{workspaceId:e.workspace_id,potSlug:e.harness_slug,grantorGithubUserId:Number(e.grantor_github_user_id),grantorLogin:e.grantor_login,granteeKind:e.grantee_kind,granteeRef:e.grantee_ref,capabilities:e.capabilities??[],preset:e.preset,status:e.status,grantorEpoch:Number(e.grantor_epoch),wakeRateCapPerHour:e.wake_rate_cap_per_hour,excludedDevicePubkeys:e.excluded_device_pubkeys??[],note:e.note}}async function g(e,r,t,a){const n=await e`
    SELECT high_water_epoch FROM harness_shared.p2p_grantor_epochs
     WHERE workspace_id = ${r} AND harness_slug = ${t}
       AND grantor_github_user_id = ${a} LIMIT 1`;return Number(n[0]?.high_water_epoch??0)}async function k(e,r){const t=i(e.workspaceId);if(!t)return[];const a=r??s().sql;return(e.includeRevoked?await a`
        SELECT * FROM harness_shared.p2p_peer_grants
         WHERE workspace_id = ${t} AND harness_slug = ${e.potSlug}
         ORDER BY grantor_github_user_id, grantee_kind, grantee_ref`:await a`
        SELECT * FROM harness_shared.p2p_peer_grants
         WHERE workspace_id = ${t} AND harness_slug = ${e.potSlug} AND status = 'active'
         ORDER BY grantor_github_user_id, grantee_kind, grantee_ref`).map(h)}async function m(e,r,t,a){const n=i(e);if(!n)throw new Error("currentGrantorEpoch refused: unresolvable workspace partition (WI-1564) — the H9 epoch fence must fail-closed, never silently read epoch 0.");const o=r?.trim();if(!o)throw new Error("currentGrantorEpoch refused: potSlug (hive) is required.");return g(a??s().sql,n,o,t)}async function R(e,r){!Number.isFinite(e.epoch)||e.epoch<=0||await(r??s().sql)`
    INSERT INTO harness_shared.p2p_grantor_epochs
      (workspace_id, harness_slug, grantor_github_user_id, high_water_epoch, updated_at)
    VALUES (${e.workspaceId}, ${e.potSlug}, ${e.grantorGithubUserId}, ${e.epoch}, now())
    ON CONFLICT (workspace_id, harness_slug, grantor_github_user_id)
    DO UPDATE SET high_water_epoch = GREATEST(harness_shared.p2p_grantor_epochs.high_water_epoch, EXCLUDED.high_water_epoch),
                  updated_at = now()`}var D=_((()=>{c(),p(),u()}));export{i as a,k as i,m as n,D as r,R as t};
