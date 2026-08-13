import{n as l}from"./chunk-ChpBd9eV.js";import{i as _,n as s}from"./provenance-aJfL4aZO.js";import{i as p,r as g}from"./scoring-CONcD-q4.js";function c(i){return{id:String(i.id),workspaceId:String(i.workspace_id),predictor:String(i.predictor),domain:String(i.domain),subjectKind:String(i.subject_kind),subjectId:String(i.subject_id),claim:String(i.claim),probability:Number(i.probability),stated:i.stated===!0||i.stated==="t",origin:String(i.signal_origin),watchdogKey:i.watchdog_key===null||i.watchdog_key===void 0?null:String(i.watchdog_key),horizonTs:a(i.horizon_ts),createdAt:a(i.created_at),resolvedAt:u(i.resolved_at),outcome:i.outcome===null||i.outcome===void 0?null:i.outcome===!0||i.outcome==="t",resolutionNote:i.resolution_note===null||i.resolution_note===void 0?null:String(i.resolution_note),potSlug:i.pot_slug===null||i.pot_slug===void 0?null:String(i.pot_slug)}}async function E(i,t){const o=await i`
    INSERT INTO harness_shared.calibration_predictions
      (workspace_id, predictor, domain, subject_kind, subject_id, claim, probability, stated,
       signal_origin, watchdog_key, horizon_ts, pot_slug)
    VALUES (${t.workspaceId}, ${t.predictor}, ${t.domain}, ${t.subjectKind}, ${t.subjectId},
      ${t.claim}, ${t.probability}, ${t.stated}, ${t.origin}, ${t.watchdogKey??null}, ${t.horizonTs},
      ${t.potSlug})
    ON CONFLICT (workspace_id, predictor, domain, subject_kind, subject_id)
      WHERE resolved_at IS NULL DO NOTHING
    RETURNING id
  `;return o.length>0?{created:!0,id:String(o[0].id)}:{created:!1,id:null}}async function S(i,t){return(await i.unsafe(`SELECT ${d} FROM harness_shared.calibration_predictions
      WHERE workspace_id = $1 AND resolved_at IS NULL AND horizon_ts <= $2
      ORDER BY horizon_ts ASC
      LIMIT $3`,[t.workspaceId,t.nowIso,t.limit??200])).map(c)}async function w(i,t){return(await i`
    UPDATE harness_shared.calibration_predictions
       SET resolved_at = ${t.nowIso}, outcome = ${t.outcome}, resolution_note = ${t.note??null}
     WHERE id = ${t.id} AND resolved_at IS NULL
     RETURNING id
  `).length>0}async function h(i,t){return(await i`
    UPDATE harness_shared.calibration_predictions
       SET resolved_at = ${t.nowIso}, resolution_note = ${t.note}
     WHERE id = ${t.id} AND resolved_at IS NULL
     RETURNING id
  `).length>0}async function A(i,t){if(t.subjectIds.length===0)return[];const o=[...t.origins??s];return(await i.unsafe(`SELECT ${d} FROM harness_shared.calibration_predictions
      WHERE workspace_id = $1 AND resolved_at IS NULL
        AND subject_id = ANY($2::text[]) AND signal_origin = ANY($3::text[])`,[t.workspaceId,[...t.subjectIds],o])).map(c)}async function $(i,t){const o=new Map;if(t.subjectIds.length===0)return o;const e=[...t.origins??s],r=await i`
    SELECT subject_id, count(*)::int AS bounced
      FROM harness_shared.calibration_predictions
     WHERE workspace_id = ${t.workspaceId} AND domain = 'fix-survival' AND outcome = false
       AND subject_id = ANY(${[...t.subjectIds]}::text[])
       AND signal_origin = ANY(${e}::text[])
     GROUP BY subject_id
  `;for(const n of r)o.set(String(n.subject_id),Number(n.bounced));return o}async function R(i,t){const o=[...t.origins??s];return(await i`
    SELECT domain, count(*)::int AS open,
           count(*) FILTER (WHERE horizon_ts <= now())::int AS matured
      FROM harness_shared.calibration_predictions
     WHERE workspace_id = ${t.workspaceId} AND resolved_at IS NULL
       AND signal_origin = ANY(${o}::text[])
     GROUP BY domain ORDER BY domain
  `).map(e=>({domain:String(e.domain),open:Number(e.open),matured:Number(e.matured)}))}async function I(i,t){const o=[...t.origins??s];return(await i`
    SELECT predictor, domain, count(*)::int AS n,
           avg(power(probability - (CASE WHEN outcome THEN 1.0 ELSE 0.0 END), 2)) AS brier,
           avg(CASE WHEN outcome THEN 1.0 ELSE 0.0 END) AS base_rate
      FROM harness_shared.calibration_predictions
     WHERE workspace_id = ${t.workspaceId} AND outcome IS NOT NULL
       AND signal_origin = ANY(${o}::text[])
       AND ${t.domain?i`domain = ${t.domain}`:i`TRUE`}
       AND ${t.predictor?i`predictor = ${t.predictor}`:i`TRUE`}
     GROUP BY predictor, domain
     ORDER BY predictor, domain
  `).map(e=>{const r=Number(e.n),n=Number(e.brier);return{predictor:String(e.predictor),domain:String(e.domain),n:r,brier:n,baseRate:Number(e.base_rate),weight:g(n,r)}})}var a,u,d,L=l((()=>{_(),p(),a=i=>new Date(i).getTime(),u=i=>i==null?null:a(i),d=`id, workspace_id, predictor, domain, subject_kind, subject_id, claim, probability,
  stated, signal_origin, watchdog_key, horizon_ts, created_at, resolved_at, outcome, resolution_note,
  pot_slug`}));export{S as a,w as c,E as i,h as l,I as n,R as o,L as r,A as s,$ as t};
