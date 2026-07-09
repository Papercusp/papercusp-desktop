import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-BbbWoCsk.js";import{a as r,i}from"./system-actions-CHFDnK_N.js";function a(e){return`${c}:${e}`}async function o(e){let{sql:n}=t();return(await n`
    SELECT value FROM harness_shared.operator_settings WHERE key = ${a(e)} LIMIT 1
  `)[0]?.value?.trim()||s(e)}async function s(e){let{sql:n}=t();return(await n`
    WITH legacy AS (
      DELETE FROM harness_shared.operator_settings
      WHERE key = ${`brain_session_id`}
      RETURNING value, updated_at
    )
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    SELECT
      ${a(e)},
      legacy.value,
      'Migrated from the pre-EI-908 unscoped brain pin (workspace-scoped).',
      legacy.updated_at,
      ${e}
    FROM legacy
    ON CONFLICT (key) DO NOTHING
    RETURNING value
  `)[0]?.value?.trim()||null}var c,l=e((()=>{n(),c=`brain_session_id`}));async function u(e){let n=await o(e);if(!n)return null;let{sql:r}=t();return(await r`
    SELECT s.coord_owner_id AS coord_owner_id
    FROM harness_shared.adv_sessions s
    WHERE s.session_id = ${n} AND s.coord_owner_id IS NOT NULL
    ORDER BY s.started_at DESC
    LIMIT 1
  `)[0]?.coord_owner_id??null}var d,f=e((()=>{n(),i(),l(),d=`wake-brain`,r(d,async e=>{})}));export{f as n,u as r,d as t};