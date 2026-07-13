import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-BiEJ-vhU.js";import{r}from"./coordination-event-log-browser-Dq_4i-_C.js";var i,a=e((()=>{i=[`chat`,`steer`,`work-offer`,`wake`,`spawn`,`read-artifacts`],new Set(i)}));function o(e){let t=e?.trim();return t&&t!==`*`&&t!=="default"?t:void 0}async function s(e,n){!Number.isFinite(e.epoch)||e.epoch<=0||await(n??t().sql)`
    INSERT INTO harness_shared.p2p_grantor_epochs
      (workspace_id, harness_slug, grantor_github_user_id, high_water_epoch, updated_at)
    VALUES (${e.workspaceId}, ${e.potSlug}, ${e.grantorGithubUserId}, ${e.epoch}, now())
    ON CONFLICT (workspace_id, harness_slug, grantor_github_user_id)
    DO UPDATE SET high_water_epoch = GREATEST(harness_shared.p2p_grantor_epochs.high_water_epoch, EXCLUDED.high_water_epoch),
                  updated_at = now()`}var c=e((()=>{n(),r(),a()}));export{a as i,c as n,o as r,s as t};