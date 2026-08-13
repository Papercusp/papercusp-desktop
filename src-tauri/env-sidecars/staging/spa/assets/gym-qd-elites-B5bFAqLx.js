import{n as l}from"./chunk-ChpBd9eV.js";import{st as _,t as f}from"./src-BmBNODK0.js";import{a as h,n as g,r as y}from"./elite-outcome-record-CrPiNAN5.js";async function E(r,e){const s=r.workspaceId?.trim(),i=r.harnessSlug?.trim(),t=r.tableTag?.trim();if(!s||!i||!t)return;const o=r.sourceHive?.trim()||"unknown-remote";try{await(e??_().sql)`
      INSERT INTO harness_shared.federation_refused_op_counters
        (workspace_id, harness_slug, source_hive, table_tag, reason, count, updated_at)
      VALUES (${s}, ${i}, ${o}, ${t}, ${r.reason}, 1, now())
      ON CONFLICT (workspace_id, harness_slug, source_hive, table_tag, reason)
      DO UPDATE SET
        count = harness_shared.federation_refused_op_counters.count + 1,
        updated_at = now()`}catch(n){console.warn(`[federation-refused-op] counter bump failed (${t}/${r.reason}): ${String(n)}`)}}var m=l((()=>{f()}));function c(r){return typeof r=="string"}function k(r){if(!r||typeof r!="object")return!1;const e=r;return!(!c(e.harness_slug)||e.harness_slug.length===0||!c(e.niche_key)||e.niche_key.length===0||e.niche_key.length>200||!c(e.candidate_id)||e.candidate_id.length===0||e.candidate_id.length>200||!c(e.scope)||e.scope.length===0||e.scope.length>120||!c(e.domain)||e.domain.length===0||e.domain.length>120||!c(e.risk)||e.risk.length===0||e.risk.length>40||typeof e.fitness!="number"||!Number.isFinite(e.fitness)||!e.descriptor||typeof e.descriptor!="object"||Array.isArray(e.descriptor)||!(e.rationale===null||c(e.rationale)&&e.rationale.length<=2e3)||e.federatable!==!0||typeof e.updated_at!="number"||!Number.isFinite(e.updated_at))}function D(r){return r.niche_key}function p(r){return k(r)?r:null}function $(r){if(r&&typeof r=="object"&&!Array.isArray(r)){const e=r;if(typeof e.niche_key=="string"&&e.federatable!==!0)return"not-federatable"}return"malformed"}function b(r,e,s){if(s?.origin==="remote")return E({workspaceId:r.workspaceId,harnessSlug:r.harnessSlug,sourceHive:s.authorPubkey,tableTag:"gym-qd-elites-by-niche",reason:$(e)},r.sql)}async function N(r,e,s){if(e.harness_slug!==r.harnessSlug||s?.origin!=="remote")return;const i=r.sql??_().sql,t=s.authorPubkey||"unknown-remote",o=s.ts??null,n=y(e.outcome_record)?e.outcome_record:null,d=r.resolveSignerDevice?.(s.authorPubkey)??void 0,a=n!=null&&h(n,{nicheKey:e.niche_key,candidateId:e.candidate_id,expectedSignerDevice:d,isSignerAdmitted:r.isDeviceAdmitted}),u=n!=null?JSON.stringify(n):null;await i`
    INSERT INTO harness_shared.gym_qd_foreign_elites
      (workspace_id, harness_slug, niche_key, source_hive, candidate_id,
       scope, domain, risk, fitness, descriptor, rationale, novelty_gift,
       author_pubkey, fed_ts, updated_at, outcome_record, outcome_verified)
    VALUES
      (${r.workspaceId}, ${e.harness_slug}, ${e.niche_key}, ${t},
       ${e.candidate_id}, ${e.scope}, ${e.domain}, ${e.risk}, ${e.fitness},
       ${JSON.stringify(e.descriptor)}::text::jsonb, ${e.rationale},
       (NOT EXISTS (SELECT 1 FROM harness_shared.gym_qd_archive a
          WHERE a.workspace_id = ${r.workspaceId}
            AND a.harness_slug = ${e.harness_slug}
            AND a.niche_key = ${e.niche_key})),
       ${t}, ${o}, ${e.updated_at},
       ${u}::text::jsonb, ${a})
    ON CONFLICT (workspace_id, harness_slug, niche_key, source_hive)
    DO UPDATE SET
      candidate_id     = EXCLUDED.candidate_id,
      scope            = EXCLUDED.scope,
      domain           = EXCLUDED.domain,
      risk             = EXCLUDED.risk,
      fitness          = EXCLUDED.fitness,
      descriptor       = EXCLUDED.descriptor,
      rationale        = EXCLUDED.rationale,
      author_pubkey    = EXCLUDED.author_pubkey,
      fed_ts           = EXCLUDED.fed_ts,
      updated_at       = EXCLUDED.updated_at,
      outcome_record   = EXCLUDED.outcome_record,
      outcome_verified = EXCLUDED.outcome_verified
      -- novelty_gift deliberately NOT updated: the first-landing stamp is stable.
    WHERE harness_shared.fed_order_key(NULL, EXCLUDED.fed_ts)
      >= harness_shared.fed_order_key(NULL, harness_shared.gym_qd_foreign_elites.fed_ts)
  `}async function v(r,e,s,i,t){if(!e||t?.origin!=="remote")return;const o=r.sql??_().sql,n=t.authorPubkey||"unknown-remote",d=s??null;await o`
    DELETE FROM harness_shared.gym_qd_foreign_elites
     WHERE workspace_id = ${r.workspaceId}
       AND harness_slug = ${r.harnessSlug}
       AND niche_key = ${e}
       AND source_hive = ${n}
       AND (${d}::bigint IS NULL
         OR harness_shared.fed_order_key(NULL, ${d}::bigint) >= harness_shared.fed_order_key(NULL, fed_ts))`}async function O(r){if(!r.revokedPubkeys.length)return 0;const e=r.sql??_().sql,s=[...r.revokedPubkeys];let i=0;const t=await e`
    DELETE FROM harness_shared.gym_qd_foreign_elites
     WHERE workspace_id = ${r.workspaceId}
       AND harness_slug = ${r.potHomeSlug}
       AND (source_hive = ANY(${s}) OR author_pubkey = ANY(${s}))
     RETURNING niche_key`;if(i+=Array.isArray(t)?t.length:0,r.resolveAuthorDevice){const o=await e`
      SELECT DISTINCT source_hive FROM harness_shared.gym_qd_foreign_elites
       WHERE workspace_id = ${r.workspaceId}
         AND harness_slug = ${r.potHomeSlug}`,n=new Set(s),d=o.map(a=>a.source_hive).filter(a=>{const u=r.resolveAuthorDevice(a);return u!==null&&n.has(u)});if(d.length){const a=await e`
        DELETE FROM harness_shared.gym_qd_foreign_elites
         WHERE workspace_id = ${r.workspaceId}
           AND harness_slug = ${r.potHomeSlug}
           AND source_hive = ANY(${d})
         RETURNING niche_key`;i+=Array.isArray(a)?a.length:0}}return i}function R(r){return{tableTag:"gym-qd-elites-by-niche",skipOwnOps:!0,composeKey:D,decodeValue:p,onRefusedOp:(e,s)=>b(r,e,s),writeToPg:(e,s)=>N(r,e,s),deleteFromPg:(e,s,i,t)=>v(r,e,s,i,t)}}var U=l((()=>{f(),m(),g()}));export{E as a,O as i,U as n,m as o,k as r,R as t};
