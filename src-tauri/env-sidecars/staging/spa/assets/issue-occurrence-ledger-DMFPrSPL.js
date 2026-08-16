import{n as w}from"./chunk-ChpBd9eV.js";import{st as u,t as S}from"./src-8fWtxfEz.js";function p(e,t){const r=t.filter(c=>c.eligible),n=r.filter(c=>{const s=c.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();return e.titleKey===`title:${s}`}).sort((c,s)=>c.id.localeCompare(s.id));return n.length>0?n[0]??null:r.slice().sort((c,s)=>(s.similarity??0)-(c.similarity??0)||c.id.localeCompare(s.id))[0]??null}function a(e){return Number.isFinite(e)&&e>0?e:0}function l(e){const t=e.map(a).filter(n=>n>0),r=t.reduce((n,c)=>n+c,0);return t.length<=1||r<=0?0:t.reduce((n,c)=>{const s=c/r;return n-s*Math.log(s)},0)/Math.log(t.length)}function _(e){const t=e.map(a).filter(n=>n>0),r=t.reduce((n,c)=>n+c,0);return r>0?Math.max(...t)/r:0}function E(e){const t=l(e.canonicalClusterCounts),r=l(e.emitterCounts),n=_(e.canonicalClusterCounts),c=_(e.emitterCounts),s=Math.max(0,Math.trunc(e.rawOccurrences)),o=s>=12&&t<=.45&&r<=.45&&n>=.6&&c>=.6;return{active:o,mode:o?"coalesce":"pass",windowSeconds:300,rawOccurrences:s,duplicateOccurrences:Math.max(0,Math.trunc(e.duplicateOccurrences)),canonicalClusters:e.canonicalClusterCounts.filter(i=>a(i)>0).length,canonicalStock:Math.max(0,Math.trunc(e.canonicalStock)),emitters:e.emitterCounts.filter(i=>a(i)>0).length,canonicalNormalizedEntropy:t,emitterNormalizedEntropy:r,canonicalDominantShare:n,emitterDominantShare:c,thresholds:{minOccurrences:12,maxNormalizedEntropy:d,minDominantShare:m},units:{rawOccurrences:"append-only report rows in the rolling window",duplicateOccurrences:"rolling-window report rows not creating a canonical item",canonicalClusters:"distinct canonical clusters seen in the rolling window",canonicalStock:"current non-terminal issue-family work-item rows",emitters:"distinct source-tool plus reporter identities in the rolling window",entropy:"normalized Shannon entropy from 0 (one bucket) to 1 (uniform buckets)"},writers:{flow:"harness_shared.work_item_occurrences",stock:"harness_shared.work_items"},cap:"none — exact SQL aggregates"}}function k(e){if(e.force)return{action:"pass",reason:"forced",canonical:null,pressure:e.pressure};if(e.severity==="critical")return{action:"pass",reason:"critical-novelty",canonical:null,pressure:e.pressure};if(!e.pressure?.active)return{action:"pass",reason:"normal",canonical:null,pressure:e.pressure};const t=p(e.identity,e.candidates);return t?{action:"coalesce",reason:"low-diversity-burst",canonical:t,pressure:e.pressure}:{action:"pass",reason:"no-canonical-candidate",canonical:null,pressure:e.pressure}}async function R(e,t){if({}.VITEST&&!t)return null;const r=t??u().sql,n=new Date((e.now??new Date).getTime()-300*1e3).toISOString();try{const c=(await r`
      WITH scope AS (
        SELECT workspace_id, harness_slug
          FROM harness_shared.work_items
         WHERE feature_id = ${e.canonicalId}
           ${e.canonicalHarness?r`AND harness_slug = ${e.canonicalHarness}`:r``}
         ORDER BY created_ts DESC
         LIMIT 1
      ), recent AS (
        SELECT o.canonical_work_item_id,
               concat(o.source_tool, ':', coalesce(o.reporter, 'anonymous')) AS emitter,
               o.report_kind
          FROM harness_shared.work_item_occurrences o
          JOIN scope s
            ON s.workspace_id = o.workspace_id
           AND s.harness_slug = o.canonical_harness_slug
         WHERE o.occurred_at > ${n}::timestamptz
      ), cluster_counts AS (
        SELECT count(*)::bigint AS count
          FROM recent
         GROUP BY canonical_work_item_id
      ), emitter_counts AS (
        SELECT count(*)::bigint AS count
          FROM recent
         GROUP BY emitter
      )
      SELECT (SELECT count(*) FROM recent) AS raw_occurrences,
             (SELECT count(*) FROM recent WHERE report_kind <> 'canonical-created') AS duplicate_occurrences,
             (SELECT count(*)
                FROM harness_shared.work_items wi
                JOIN scope s ON s.workspace_id = wi.workspace_id AND s.harness_slug = wi.harness_slug
               WHERE wi.item_kind IN ('bug', 'change', 'task')
                 AND NOT harness_shared.work_item_status_is_terminal(wi.status)) AS canonical_stock,
             coalesce((SELECT array_agg(count ORDER BY count DESC) FROM cluster_counts), ARRAY[]::bigint[])
               AS canonical_cluster_counts,
             coalesce((SELECT array_agg(count ORDER BY count DESC) FROM emitter_counts), ARRAY[]::bigint[])
               AS emitter_counts
        FROM scope
    `)[0];return c?E({rawOccurrences:Number(c.raw_occurrences??0),duplicateOccurrences:Number(c.duplicate_occurrences??0),canonicalStock:Number(c.canonical_stock??0),canonicalClusterCounts:(c.canonical_cluster_counts??[]).map(Number),emitterCounts:(c.emitter_counts??[]).map(Number)}):null}catch{return null}}async function f(e,t){if({}.VITEST&&!t)return null;const r=t??u().sql;try{const n=(await r`
      SELECT workspace_id, harness_slug, feature_id
        FROM harness_shared.work_items
       WHERE feature_id = ${e.canonicalId}
         ${e.canonicalHarness?r`AND harness_slug = ${e.canonicalHarness}`:r``}
       ORDER BY created_ts DESC
       LIMIT 1
    `)[0];if(!n)return null;const c=JSON.stringify(e.evidence??{}),s=e.admissionIdentity?JSON.stringify(e.admissionIdentity):null,o=(await r`
      INSERT INTO harness_shared.work_item_occurrences
        (workspace_id, canonical_harness_slug, canonical_work_item_id, reporter,
         source_tool, report_kind, reported_title, evidence, admission_identity)
      VALUES
        (${n.workspace_id}, ${n.harness_slug}, ${n.feature_id},
         ${e.reporter??null}, ${e.sourceTool}, ${e.reportKind}, ${e.reportedTitle},
         ${c}::jsonb, ${s}::jsonb)
      RETURNING occurrence_id, occurred_at
    `)[0];return o?{occurrenceId:Number(o.occurrence_id),workspaceId:n.workspace_id,canonicalHarness:n.harness_slug,canonicalId:n.feature_id,reportKind:e.reportKind,occurredAt:new Date(o.occurred_at).toISOString()}:null}catch{return null}}async function A(e,t){const r=t??u().sql,n=(await r`
    SELECT count(DISTINCT (canonical_harness_slug, canonical_work_item_id)) AS canonical_clusters,
           count(*)                                                        AS raw_occurrences,
           count(*) FILTER (WHERE report_kind <> 'canonical-created')      AS duplicate_occurrences
      FROM harness_shared.work_item_occurrences
     WHERE workspace_id = ${e.workspaceId}
       ${e.harnessSlug?r`AND canonical_harness_slug = ${e.harnessSlug}`:r``}
       ${e.since?r`AND occurred_at > ${e.since}::timestamptz`:r``}
  `)[0];return{canonicalClusters:Number(n?.canonical_clusters??0),rawOccurrences:Number(n?.raw_occurrences??0),duplicateOccurrences:Number(n?.duplicate_occurrences??0),units:{canonicalClusters:"distinct canonical work-item ids with occurrences",rawOccurrences:"append-only report rows",duplicateOccurrences:"report rows not creating a canonical item"},writer:"harness_shared.work_item_occurrences"}}var h,O,d,m,g=w((()=>{S(),h=300,O=12,d=.45,m=.6}));export{f as a,A as i,g as n,p as o,R as r,k as t};
