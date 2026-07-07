import{n as e}from"./chunk-CMxvf4Kt.js";import{i as t,n}from"./provenance-DtYtheHL.js";import{i as r,r as i}from"./scoring-CbhRdhLt.js";function a(e){return{id:String(e.id),workspaceId:String(e.workspace_id),predictor:String(e.predictor),domain:String(e.domain),subjectKind:String(e.subject_kind),subjectId:String(e.subject_id),claim:String(e.claim),probability:Number(e.probability),stated:e.stated===!0||e.stated===`t`,origin:String(e.signal_origin),watchdogKey:e.watchdog_key===null||e.watchdog_key===void 0?null:String(e.watchdog_key),horizonTs:m(e.horizon_ts),createdAt:m(e.created_at),resolvedAt:h(e.resolved_at),outcome:e.outcome===null||e.outcome===void 0?null:e.outcome===!0||e.outcome===`t`,resolutionNote:e.resolution_note===null||e.resolution_note===void 0?null:String(e.resolution_note)}}async function o(e,t){let n=await e`
    INSERT INTO harness_shared.calibration_predictions
      (workspace_id, predictor, domain, subject_kind, subject_id, claim, probability, stated,
       signal_origin, watchdog_key, horizon_ts)
    VALUES (${t.workspaceId}, ${t.predictor}, ${t.domain}, ${t.subjectKind}, ${t.subjectId},
      ${t.claim}, ${t.probability}, ${t.stated}, ${t.origin}, ${t.watchdogKey??null}, ${t.horizonTs})
    ON CONFLICT (workspace_id, predictor, domain, subject_kind, subject_id)
      WHERE resolved_at IS NULL DO NOTHING
    RETURNING id
  `;return n.length>0?{created:!0,id:String(n[0].id)}:{created:!1,id:null}}async function s(e,t){return(await e.unsafe(`SELECT ${g} FROM harness_shared.calibration_predictions
      WHERE workspace_id = $1 AND resolved_at IS NULL AND horizon_ts <= $2
      ORDER BY horizon_ts ASC
      LIMIT $3`,[t.workspaceId,t.nowIso,t.limit??200])).map(a)}async function c(e,t){return(await e`
    UPDATE harness_shared.calibration_predictions
       SET resolved_at = ${t.nowIso}, outcome = ${t.outcome}, resolution_note = ${t.note??null}
     WHERE id = ${t.id} AND resolved_at IS NULL
     RETURNING id
  `).length>0}async function l(e,t){return(await e`
    UPDATE harness_shared.calibration_predictions
       SET resolved_at = ${t.nowIso}, resolution_note = ${t.note}
     WHERE id = ${t.id} AND resolved_at IS NULL
     RETURNING id
  `).length>0}async function u(e,t){if(t.subjectIds.length===0)return[];let r=[...t.origins??n];return(await e.unsafe(`SELECT ${g} FROM harness_shared.calibration_predictions
      WHERE workspace_id = $1 AND resolved_at IS NULL
        AND subject_id = ANY($2::text[]) AND signal_origin = ANY($3::text[])`,[t.workspaceId,[...t.subjectIds],r])).map(a)}async function d(e,t){let r=new Map;if(t.subjectIds.length===0)return r;let i=[...t.origins??n],a=await e`
    SELECT subject_id, count(*)::int AS bounced
      FROM harness_shared.calibration_predictions
     WHERE workspace_id = ${t.workspaceId} AND domain = 'fix-survival' AND outcome = false
       AND subject_id = ANY(${[...t.subjectIds]}::text[])
       AND signal_origin = ANY(${i}::text[])
     GROUP BY subject_id
  `;for(let e of a)r.set(String(e.subject_id),Number(e.bounced));return r}async function f(e,t){let r=[...t.origins??n];return(await e`
    SELECT domain, count(*)::int AS open,
           count(*) FILTER (WHERE horizon_ts <= now())::int AS matured
      FROM harness_shared.calibration_predictions
     WHERE workspace_id = ${t.workspaceId} AND resolved_at IS NULL
       AND signal_origin = ANY(${r}::text[])
     GROUP BY domain ORDER BY domain
  `).map(e=>({domain:String(e.domain),open:Number(e.open),matured:Number(e.matured)}))}async function p(e,t){let r=[...t.origins??n];return(await e`
    SELECT predictor, domain, count(*)::int AS n,
           avg(power(probability - (CASE WHEN outcome THEN 1.0 ELSE 0.0 END), 2)) AS brier,
           avg(CASE WHEN outcome THEN 1.0 ELSE 0.0 END) AS base_rate
      FROM harness_shared.calibration_predictions
     WHERE workspace_id = ${t.workspaceId} AND outcome IS NOT NULL
       AND signal_origin = ANY(${r}::text[])
       AND ${t.domain?e`domain = ${t.domain}`:e`TRUE`}
       AND ${t.predictor?e`predictor = ${t.predictor}`:e`TRUE`}
     GROUP BY predictor, domain
     ORDER BY predictor, domain
  `).map(e=>{let t=Number(e.n),n=Number(e.brier);return{predictor:String(e.predictor),domain:String(e.domain),n:t,brier:n,baseRate:Number(e.base_rate),weight:i(n,t)}})}var m,h,g,_=e((()=>{t(),r(),m=e=>new Date(e).getTime(),h=e=>e==null?null:m(e),g=`id, workspace_id, predictor, domain, subject_kind, subject_id, claim, probability,
  stated, signal_origin, watchdog_key, horizon_ts, created_at, resolved_at, outcome, resolution_note`}));export{s as a,c,o as i,l,p as n,f as o,_ as r,u as s,d as t};