import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CwW4br4q.js";import{a as r,n as i,r as a}from"./elite-outcome-record-CF19_agl.js";async function o(e,n){let r=e.workspaceId?.trim(),i=e.harnessSlug?.trim(),a=e.tableTag?.trim();if(!r||!i||!a)return;let o=e.sourceHive?.trim()||`unknown-remote`;try{await(n??t().sql)`
      INSERT INTO harness_shared.federation_refused_op_counters
        (workspace_id, harness_slug, source_hive, table_tag, reason, count, updated_at)
      VALUES (${r}, ${i}, ${o}, ${a}, ${e.reason}, 1, now())
      ON CONFLICT (workspace_id, harness_slug, source_hive, table_tag, reason)
      DO UPDATE SET
        count = harness_shared.federation_refused_op_counters.count + 1,
        updated_at = now()`}catch(t){console.warn(`[federation-refused-op] counter bump failed (${a}/${e.reason}): ${String(t)}`)}}var s=e((()=>{n()}));function c(e){return typeof e==`string`}function l(e){if(!e||typeof e!=`object`)return!1;let t=e;return!(!c(t.harness_slug)||t.harness_slug.length===0||!c(t.niche_key)||t.niche_key.length===0||t.niche_key.length>200||!c(t.candidate_id)||t.candidate_id.length===0||t.candidate_id.length>200||!c(t.scope)||t.scope.length===0||t.scope.length>120||!c(t.domain)||t.domain.length===0||t.domain.length>120||!c(t.risk)||t.risk.length===0||t.risk.length>40||typeof t.fitness!=`number`||!Number.isFinite(t.fitness)||!t.descriptor||typeof t.descriptor!=`object`||Array.isArray(t.descriptor)||!(t.rationale===null||c(t.rationale)&&t.rationale.length<=2e3)||t.federatable!==!0||typeof t.updated_at!=`number`||!Number.isFinite(t.updated_at))}function u(e){return e.niche_key}function d(e){return l(e)?e:null}function f(e){if(e&&typeof e==`object`&&!Array.isArray(e)){let t=e;if(typeof t.niche_key==`string`&&t.federatable!==!0)return`not-federatable`}return`malformed`}function p(e,t,n){if(n?.origin===`remote`)return o({workspaceId:e.workspaceId,harnessSlug:e.harnessSlug,sourceHive:n.authorPubkey,tableTag:`gym-qd-elites-by-niche`,reason:f(t)},e.sql)}async function m(e,n,i){if(n.harness_slug!==e.harnessSlug||i?.origin!==`remote`)return;let o=e.sql??t().sql,s=i.authorPubkey||`unknown-remote`,c=i.ts??null,l=a(n.outcome_record)?n.outcome_record:null,u=e.resolveSignerDevice?.(i.authorPubkey)??void 0,d=l!=null&&r(l,{nicheKey:n.niche_key,candidateId:n.candidate_id,expectedSignerDevice:u,isSignerAdmitted:e.isDeviceAdmitted}),f=l==null?null:JSON.stringify(l);await o`
    INSERT INTO harness_shared.gym_qd_foreign_elites
      (workspace_id, harness_slug, niche_key, source_hive, candidate_id,
       scope, domain, risk, fitness, descriptor, rationale, novelty_gift,
       author_pubkey, fed_ts, updated_at, outcome_record, outcome_verified)
    VALUES
      (${e.workspaceId}, ${n.harness_slug}, ${n.niche_key}, ${s},
       ${n.candidate_id}, ${n.scope}, ${n.domain}, ${n.risk}, ${n.fitness},
       ${JSON.stringify(n.descriptor)}::text::jsonb, ${n.rationale},
       (NOT EXISTS (SELECT 1 FROM harness_shared.gym_qd_archive a
          WHERE a.workspace_id = ${e.workspaceId}
            AND a.harness_slug = ${n.harness_slug}
            AND a.niche_key = ${n.niche_key})),
       ${s}, ${c}, ${n.updated_at},
       ${f}::text::jsonb, ${d})
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
  `}async function h(e,n,r,i,a){if(!n||a?.origin!==`remote`)return;let o=e.sql??t().sql,s=a.authorPubkey||`unknown-remote`,c=r??null;await o`
    DELETE FROM harness_shared.gym_qd_foreign_elites
     WHERE workspace_id = ${e.workspaceId}
       AND harness_slug = ${e.harnessSlug}
       AND niche_key = ${n}
       AND source_hive = ${s}
       AND (${c}::bigint IS NULL
         OR harness_shared.fed_order_key(NULL, ${c}::bigint) >= harness_shared.fed_order_key(NULL, fed_ts))`}async function g(e){if(!e.revokedPubkeys.length)return 0;let n=e.sql??t().sql,r=[...e.revokedPubkeys],i=0,a=await n`
    DELETE FROM harness_shared.gym_qd_foreign_elites
     WHERE workspace_id = ${e.workspaceId}
       AND harness_slug = ${e.potHomeSlug}
       AND (source_hive = ANY(${r}) OR author_pubkey = ANY(${r}))
     RETURNING niche_key`;if(i+=Array.isArray(a)?a.length:0,e.resolveAuthorDevice){let t=await n`
      SELECT DISTINCT source_hive FROM harness_shared.gym_qd_foreign_elites
       WHERE workspace_id = ${e.workspaceId}
         AND harness_slug = ${e.potHomeSlug}`,a=new Set(r),o=t.map(e=>e.source_hive).filter(t=>{let n=e.resolveAuthorDevice(t);return n!==null&&a.has(n)});if(o.length){let t=await n`
        DELETE FROM harness_shared.gym_qd_foreign_elites
         WHERE workspace_id = ${e.workspaceId}
           AND harness_slug = ${e.potHomeSlug}
           AND source_hive = ANY(${o})
         RETURNING niche_key`;i+=Array.isArray(t)?t.length:0}}return i}function _(e){return{tableTag:`gym-qd-elites-by-niche`,skipOwnOps:!0,composeKey:u,decodeValue:d,onRefusedOp:(t,n)=>p(e,t,n),writeToPg:(t,n)=>m(e,t,n),deleteFromPg:(t,n,r,i)=>h(e,t,n,r,i)}}var v=e((()=>{n(),s(),i()}));export{o as a,g as i,v as n,s as o,l as r,_ as t};