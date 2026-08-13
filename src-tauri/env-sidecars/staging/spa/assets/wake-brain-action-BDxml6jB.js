import{n as i}from"./chunk-ChpBd9eV.js";import{st as e,t}from"./src-BmBNODK0.js";import{a as c,i as d}from"./system-actions-58kRxx5t.js";function o(s){return`${_}:${s}`}async function u(s){const{sql:n}=e(),a=(await n`
    SELECT value FROM harness_shared.operator_settings WHERE key = ${o(s)} LIMIT 1
  `)[0]?.value?.trim()||null;return a||E(s)}async function E(s){const{sql:n}=e();return(await n`
    WITH legacy AS (
      DELETE FROM harness_shared.operator_settings
      WHERE key = ${"brain_session_id"}
      RETURNING value, updated_at
    )
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    SELECT
      ${o(s)},
      legacy.value,
      'Migrated from the pre-EI-908 unscoped brain pin (workspace-scoped).',
      legacy.updated_at,
      ${s}
    FROM legacy
    ON CONFLICT (key) DO NOTHING
    RETURNING value
  `)[0]?.value?.trim()||null}var _,l=i((()=>{t(),_="brain_session_id"}));async function R(s){const n=await u(s);if(!n)return null;const{sql:a}=e();return(await a`
    SELECT s.coord_owner_id AS coord_owner_id
    FROM harness_shared.adv_sessions s
    WHERE s.session_id = ${n} AND s.coord_owner_id IS NOT NULL
    ORDER BY s.started_at DESC
    LIMIT 1
  `)[0]?.coord_owner_id??null}var r,g=i((()=>{t(),d(),l(),r="wake-brain",c(r,async s=>{})}));export{g as n,R as r,r as t};
