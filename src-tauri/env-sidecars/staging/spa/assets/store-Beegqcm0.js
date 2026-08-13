const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/sweep-ranking-D2kXFJMF.js","assets/chunk-ChpBd9eV.js","assets/notify-evicted-B-dFQgTr.js","assets/preload-helper-CcgcQsTF.js","assets/harness-registry-BJnz_MHZ.js","assets/harness-registry-Cyujgx97.js","assets/src-BmBNODK0.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/operator-state-pg-DNPN5cby.js","assets/db-encryption-ByK3NqqK.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-als-CSW21ZcE.js","assets/workspace-id-constant-AQ2MH5pQ.js","assets/platform-pot-slug-C6n7Eole.js"])))=>i.map(i=>d[i]);
import{n as ue}from"./chunk-ChpBd9eV.js";import{n as fe,t as g}from"./preload-helper-CcgcQsTF.js";import{$t as d,t as pe}from"./src-l3Ts7dqj.js";import{st as _e,t as ye}from"./src-BmBNODK0.js";import{r as me}from"./coordination-event-log-browser-s_EyGDm7.js";import{c as he,r as m}from"./workspace-registry-Du2UbhlH.js";function Ee(e,t){return e!=="undecidable"?t!=null&&t.trim()!==""?`settledBy is only meaningful for kind:'undecidable' (got kind:'${e??"null"}') — it names what would settle an open question, so on a settled claim it has no referent`:null:t==null||t.trim()===""?`kind:'undecidable' requires settledBy — name the evidence that WOULD settle this question. An undecidable with no stated exit does not stop re-derivation, it invites it: a reader cannot tell "nobody COULD determine this" from "nobody has tried lately"`:null}function we(e){return e===G}function Ae(e){if(e==="provisional")return X;if(e==="suspected")return z}function Qe(e,t){if(t)return null;const n=Q.exec(e);return n?`confidence_lint: this fact's body asserts certainty ("${n[0]}") but no \`confidence\` was set. EI-18681964809855890: a peer's single unreplicated run rendered at IDENTICAL authority to a verified measurement once cost four agents a false regression chase. Pass confidence:'verified' if you replicated this yourself, 'provisional' for a single/unreplicated data point, or 'suspected' for a hunch / second-hand hedge — never write a peer's provisional evidence at higher confidence than they stated it.`:null}function x(e,t){if(!C.includes(e))return`unknown scope '${e}' — one of ${C.join("|")}`;const n=(t??"").trim();return e==="workspace"&&n?"scope 'workspace' carries no scope_ref":e!=="workspace"&&!n?`scope '${e}' requires scope_ref`:null}function Ne(e){const t=(e??"").trim();return t?Z.test(t)?null:`audienceScope '${t}' does not match the v1 grammar 'fleet:<slug>' — an unmatchable audience would hide the fact from everyone`:null}function ve(e,t){if(t==null)return null;if(e!=="convention")return`enforcement is only meaningful on kind:'convention' (got ${e==null?"no kind":`kind:'${e}'`}) — a tier describes how a NORM is enforced, and a ${e??"kind-less"} fact is not one`;const n=t.tier;if(!$.includes(n))return`unknown enforcement tier '${n}' — one of ${$.join("|")}. Note 'prompt' is deliberately not a tier (D-016): a convention enforced only by documentation leaves enforcement unset rather than claiming one`;const s=t.floor!=null,o=(t.reviewBy??"").trim()!=="";if(J.has(n)){if(!s||!o)return`tier '${n}' requires ${[s?null:"floor",o?null:"reviewBy"].filter(Boolean).join(" and ")} (D-016: every tier-2/tier-3 behaviour ships with an adoption floor and a review date — "a detector without a floor is prose exhortation in a costume")`;const r=t.floor;if(!Number.isFinite(r)||r<=0||r>1)return`floor must be a rate in (0,1] (got ${JSON.stringify(t.floor)}) — a floor of 0 is not a floor`;const i=(t.reviewBy??"").trim(),a=Date.parse(i);if(!Number.isFinite(a))return`reviewBy '${i}' is not a parseable date — an unparseable review date never comes due`}else if(s||o)return`tier 'structural' takes no ${[s?"floor":null,o?"reviewBy":null].filter(Boolean).join(" and ")} — D-016: structural "needs no enforcement because there is no behaviour to enforce", so the adoption rate is undefined, not merely unmeasured. An uncomputable floor reads as FAILING at review and would get a working convention cut`;return null}function Se(e){let t=e;if(typeof t=="string"){const r=t.trim();if(!r)return null;try{t=JSON.parse(r)}catch{return null}}if(!t||typeof t!="object"||Array.isArray(t))return null;const n=t,s=typeof n.tier=="string"?n.tier:"";if(!$.includes(s))return null;const o={tier:s};return typeof n.floor=="number"&&Number.isFinite(n.floor)&&(o.floor=n.floor),typeof n.reviewBy=="string"&&n.reviewBy.trim()&&(o.reviewBy=n.reviewBy.trim()),o}function ke(e){if(typeof e=="string")try{e=JSON.parse(e)}catch{return null}if(!e||typeof e!="object")return null;const t=e;return t.kind!=="msg"&&t.kind!=="work-item"&&t.kind!=="owner-turn"||typeof t.verified!="boolean"||typeof t.verifiedAt!="string"||!t.verifiedAt?null:{kind:t.kind,verified:t.verified,verifiedAt:t.verifiedAt,...typeof t.quote=="string"&&t.quote?{quote:t.quote}:{},...typeof t.label=="string"&&t.label?{label:t.label}:{},...typeof t.error=="string"&&t.error?{error:t.error}:{}}}function be(e){if(typeof e=="string")try{e=JSON.parse(e)}catch{return null}if(!e||typeof e!="object"||Array.isArray(e))return null;const t=e;if(t.subjectVolatile!==!0||typeof t.measuredAt!="string"||!t.measuredAt.trim())return null;const n=Date.parse(t.measuredAt);return Number.isFinite(n)?{subjectVolatile:!0,measuredAt:new Date(n).toISOString()}:null}function $e(e){if(typeof e=="string")try{e=JSON.parse(e)}catch{return[]}if(!Array.isArray(e))return[];const t=[];for(const n of e){if(!n||typeof n!="object")continue;const s=n,o=typeof s.cell=="string"?s.cell.trim():"",r=typeof s.observedAt=="string"?s.observedAt:"";if(!o||!r)continue;const i=typeof s.digest=="string"&&s.digest?s.digest:void 0,a=typeof s.unknown=="string"&&s.unknown?s.unknown:void 0;if(i===void 0!=(a===void 0)&&(t.push({cell:o,...typeof s.subject=="string"&&s.subject?{subject:s.subject}:{},observedAt:r,...i?{digest:i}:{},...a?{unknown:a}:{},...typeof s.observed=="string"&&s.observed?{observed:s.observed.slice(0,120)}:{}}),t.length>=12))break}return t}function De(e){if(!e||e.length===0)return null;const t=new Set,n=[];for(const s of e){const o=(s?.cell??"").trim();if(!o||t.has(o))continue;const r=typeof s.digest=="string"&&s.digest.length>0,i=typeof s.unknown=="string"&&s.unknown.length>0;if(r!==i&&(t.add(o),n.push({cell:o,...s.subject?{subject:s.subject}:{},observedAt:s.observedAt||new Date().toISOString(),...r?{digest:s.digest}:{},...i?{unknown:s.unknown}:{},...s.observed?{observed:s.observed.slice(0,120)}:{}}),n.length>=12))break}return n.length>0?n:null}function Le(e){const t=e.sourceRef??"",n=e.sourceProvenance;return n?n.verified?n.quote?`${t} ✓ "${n.quote}"`:`${t} ✓${n.label?` ${n.label}`:""}`:`${t} ✗unverified${n.error?` (${n.error})`:""}`:t}function Ze(e,t,n){if((t??"").trim())return t;switch(e){case"owner":return n.ownerId??t;case"harness":return n.harnessSlug??t;case"role":return n.role??t;default:return t}}function y(e){return e??_e().sql}function Re(e){const t=e?.trim();return t&&t!=="*"&&t!=="default"?t:void 0}function Ie(e){const t=e.trim();if(t.length<=1200)return t;const n=" […]",s=t.slice(0,k-4),o=Math.floor(k*.6);let r=-1;for(let a=s.length-1;a>0;a-=1){const c=s[a];if((c==="."||c==="!"||c==="?"||c===";")&&/\s/.test(s[a+1]??t[s.length]??" ")){r=a;break}}if(r+1>=o)return`${s.slice(0,r+1)}${n}`;const i=s.lastIndexOf(" ");return i>=o?`${s.slice(0,i)}${n}`:`${t.slice(0,k-1)}…`}async function et(e,t){const n=x(e.scope,e.scopeRef);if(n)throw new d(`facts:assert — ${n}`);const s=Ne(e.audienceScope);if(s)throw new d(`facts:assert — ${s}`);const o=(e.audienceScope??"").trim()||null,r=e.key.trim();if(!r)throw new d("facts:assert — key required (stable slug)");const i=Ie(e.body);if(!i)throw new d("facts:assert — body required");const a=e.subjectVolatile===!0,c=e.measuredAt?.trim()||null;if(a&&!c)throw new d("facts:assert — subjectVolatile:true requires measuredAt (the ISO timestamp of the sample)");if(!a&&c)throw new d("facts:assert — measuredAt is only meaningful with subjectVolatile:true; mark the subject volatile or omit the timestamp");let l=null;if(c){const E=Date.parse(c);if(!Number.isFinite(E))throw new d(`facts:assert — measuredAt must be a valid ISO timestamp (got '${c}')`);if(E>Date.now()+6e4)throw new d("facts:assert — measuredAt cannot be more than 60 seconds in the future");l={subjectVolatile:!0,measuredAt:new Date(E).toISOString()}}if(a&&e.ttlSec!=null&&e.ttlSec>900)throw new d(`facts:assert — a volatile measurement must use ttlSec <= 900 seconds (15 minutes); the requested ${e.ttlSec}-second TTL would leave a moving snapshot in the standing-facts fold too long`);const p=y(t),_=e.workspaceId??m();if(e.shareable===!0&&!Re(_))throw new Error(`facts:assert — a shareable fact cannot use the '${_}' workspace partition (WI-1564): the coordination/'*' partition never federates, so the fact would be captured then stranded on every peer. Assert from a hive-scoped workspace.`);const h=e.scope==="workspace"?null:(e.scopeRef??"").trim(),te=e.kind==="convention"&&e.ttlSec==null&&!a,ne=a?e.ttlSec&&e.ttlSec>0?e.ttlSec:900:e.ttlSec&&e.ttlSec>0?e.ttlSec:Ae(e.confidence)??604800,se=e.confidence??null;if(e.kind!=null&&!b.includes(e.kind))throw new d(`facts:assert — unknown kind '${e.kind}' — one of ${b.join("|")}`);const R=e.kind??null,U=ve(R,e.enforcement);if(U)throw new d(`facts:assert — ${U}`);const B=e.enforcement??null,M=Ee(R,e.settledBy);if(M)throw new d(`facts:assert — ${M}`);const re=e.settledBy?.trim()?e.settledBy.trim():null,P=De(e.dependsOn),j=e.claim&&typeof e.claim=="object"?e.claim:null,H=await p`
    WITH superseded AS (
      UPDATE harness_shared.agent_facts
         SET superseded_at = now()
       WHERE workspace_id = ${_} AND scope = ${e.scope}
         AND coalesce(scope_ref, '') = ${h??""} AND key = ${r}
         AND source_hive IS NULL
         AND superseded_at IS NULL
      RETURNING id, harness_slug
    )
    INSERT INTO harness_shared.agent_facts
      (workspace_id, harness_slug, scope, scope_ref, key, body, source_ref, created_by, expires_at, shareable,
       audience_scope, source_provenance, confidence, measurement, supersedes_id, kind, depends_on, claim,
       enforcement, settled_by)
    VALUES
      (${_},
       -- keep an already-stamped federation identity when a later assert omits
       -- it (never NULL it back out) — carried forward off the superseded row,
       -- since there is no longer an UPDATE branch to COALESCE against.
       COALESCE(${e.potHomeSlug??null}, (SELECT harness_slug FROM superseded)),
       ${e.scope}, ${h}, ${r}, ${i},
       ${e.sourceRef??null}, ${e.createdBy??null},
       ${te?p`'infinity'::timestamptz`:p`now() + make_interval(secs => ${ne})`},
       ${e.shareable===!0},
       ${o},
       ${e.sourceProvenance?JSON.stringify(e.sourceProvenance):null}::text::jsonb,
       ${se},
       ${l?JSON.stringify(l):null}::text::jsonb,
       (SELECT id FROM superseded),
       ${R},
       ${P?JSON.stringify(P):null}::text::jsonb,
       ${j?JSON.stringify(j):null}::text::jsonb,
       ${B?JSON.stringify(B):null}::text::jsonb,
       ${re})
    RETURNING id, superseded_at::text, supersedes_id,
              scope, scope_ref, key, body, source_ref, audience_scope, source_provenance,
              confidence, measurement, kind, depends_on, claim, enforcement, settled_by, created_by, updated_at::text, expires_at::text`,W=H[0].id??null,q=await p`
    UPDATE harness_shared.agent_facts SET retracted_at = now(), evicted_at = now()
     WHERE source_hive IS NULL
       AND superseded_at IS NULL
       AND (workspace_id, scope, coalesce(scope_ref,''), key) IN (
       SELECT workspace_id, scope, coalesce(scope_ref,''), key
         FROM harness_shared.agent_facts
        WHERE workspace_id = ${_} AND scope = ${e.scope}
          AND coalesce(scope_ref,'') = ${h??""}
          AND source_hive IS NULL
          AND superseded_at IS NULL
          AND retracted_at IS NULL AND expires_at > now()
          AND key NOT LIKE ${`${F}%`}
          AND key NOT LIKE ${`${D}%`}
          -- P-028: conventions are governance rows, not ordinary cap
          -- population. Their explicit TTL still controls natural expiry,
          -- but the per-scope observation cap must never retract policy.
          AND COALESCE(kind, '') <> 'convention'
          AND id IS DISTINCT FROM ${W}
        ORDER BY CASE confidence
                   WHEN 'verified'    THEN 0
                   WHEN 'provisional' THEN 1
                   WHEN 'suspected'   THEN 2
                   ELSE 1
                 END ASC,
                 (EXTRACT(epoch FROM (expires_at - now()))
                    / GREATEST(EXTRACT(epoch FROM (expires_at - created_at)), 1)) DESC,
                 updated_at DESC
       OFFSET ${Math.max(0,199)})
    RETURNING key, confidence, expires_at, created_by`,I=L(H[0]);if(q.length>0){const E=new Set,N=[];for(const u of q)E.has(u.key)||(E.add(u.key),N.push({key:u.key,confidence:O(u.confidence),expiresAt:u.expires_at,createdBy:u.created_by}));I.evicted=N;let T=null;try{const u=await p`
        SELECT id, confidence, expires_at, created_at, updated_at
          FROM harness_shared.agent_facts
         WHERE workspace_id = ${_} AND scope = ${e.scope}
           AND coalesce(scope_ref,'') = ${h??""}
           AND source_hive IS NULL
           AND superseded_at IS NULL
           AND retracted_at IS NULL AND expires_at > now()
           AND key NOT LIKE ${`${F}%`}
           AND key NOT LIKE ${`${D}%`}`,ae=f=>f==="verified"?0:f==="suspected"?2:1,w=new Set;for(const f of u)w.add(O(f.confidence));for(const f of N)w.add(f.confidence);T={confidenceDiscriminated:new Set([...w].map(ae)).size>1,prevailingConfidence:w.size===1?[...w][0]:null};const{orderAsSweepWould:ie,rankOfId:ce,sweepRemainingFraction:de}=await g(async()=>{const{orderAsSweepWould:f,rankOfId:S,sweepRemainingFraction:le}=await import("./sweep-ranking-D2kXFJMF.js");return{orderAsSweepWould:f,rankOfId:S,sweepRemainingFraction:le}},__vite__mapDeps([0,1])),V=Date.now(),v=ie(u,V),A=ce(v,W);if(A>0){const f=A===v.length,S=f&&A>1?v[A-2]:null;I.survival={rank:A,liveCount:v.length,nextVictim:f,survivingFractionFloor:S?de(S,V):null}}}catch{T=null}const{notifyEvictedFactOwners:oe}=await g(async()=>{const{notifyEvictedFactOwners:u}=await import("./notify-evicted-B-dFQgTr.js");return{notifyEvictedFactOwners:u}},__vite__mapDeps([2,1,3]));await oe({evicted:N,ranking:T,writerOwnerId:e.createdBy,scope:e.scope,scopeRef:h})}return I}async function tt(e,t){const n=x(e.scope,e.scopeRef);if(n)throw new d(`facts:retract — ${n}`);const s=y(t),o=e.workspaceId??m(),r=e.scope==="workspace"?"":(e.scopeRef??"").trim();return(await s`
    UPDATE harness_shared.agent_facts
       SET retracted_at = now(), retracted_by = ${e.retractedBy?.trim()||null}, retraction_reason = ${e.reason?.trim()||null}
     WHERE workspace_id = ${o} AND scope = ${e.scope}
       AND coalesce(scope_ref,'') = ${r} AND key = ${e.key.trim()}
       AND source_hive IS NULL
       AND superseded_at IS NULL
       AND retracted_at IS NULL
    RETURNING key`).length>0}async function nt(e,t){const n=e.key.trim();return n?(await y(t)`
    SELECT id, scope, scope_ref, expires_at::text
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${e.workspaceId??m()} AND key = ${n}
       AND source_hive IS NULL
       AND superseded_at IS NULL
       AND retracted_at IS NULL
     ORDER BY expires_at DESC, id DESC
     LIMIT 2`).map(s=>({id:Number(s.id),scope:s.scope,scopeRef:s.scope_ref,expiresAt:s.expires_at})):[]}async function st(e,t){const n=y(t),s=e.workspaceId??m(),o=e.scope==="workspace"?"":e.scopeRef.trim();return(await n`
    SELECT id, scope, scope_ref, expires_at::text
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${s} AND key = ${e.key.trim()}
       AND source_hive IS NULL
       AND superseded_at IS NULL
       AND retracted_at IS NULL
       AND NOT (scope = ${e.scope} AND coalesce(scope_ref,'') = ${o})
     ORDER BY expires_at DESC
     LIMIT 5`).map(r=>({id:Number(r.id),scope:r.scope,scopeRef:r.scope_ref,expiresAt:r.expires_at}))}async function Y(e,t={},n){if(e.length===0)return[];const s=y(n),o=t.workspaceId??m(),r=t.limitPerSelector??12,i=(t.keyPrefix??"").trim(),a=t.audiences==="all"?"all":(t.audiences??[]).map(l=>l.trim()).filter(Boolean),c=[];for(const l of e){const p=l.scope==="workspace"?"":(l.scopeRef??"").trim();if(l.scope!=="workspace"&&!p)continue;const _=await s`
      SELECT id, scope, scope_ref, key, body, source_ref, audience_scope, source_provenance,
             -- P-002: settled_by rides the FOLD specifically. An undecidable whose exit
             -- is stored but never surfaced cannot stop re-derivation — the reader would
             -- see "nobody could determine this" with no way to act on it, which is the
             -- half-finish this modality exists to prevent.
             confidence, measurement, kind, depends_on, claim, enforcement, settled_by, created_by, updated_at::text, expires_at::text,
             -- P-008 (c): the cell version, so the fold can mark what changed since
             -- the reader's cursor without a second query.
             fed_hlc
        FROM harness_shared.agent_facts
       WHERE workspace_id = ${o} AND scope = ${l.scope}
         AND coalesce(scope_ref,'') = ${p}
         -- P-008 (a): CURRENT versions only. A fold that saw the superseded tail
         -- would serve an agent both the corrected value and the value it
         -- corrected, as peers.
         AND superseded_at IS NULL
         AND retracted_at IS NULL AND expires_at > now()
         AND ${i?s`key LIKE ${i+"%"}`:s`TRUE`}
         AND ${a==="all"?s`TRUE`:a.length>0?s`(audience_scope IS NULL OR audience_scope = ANY(${a}))`:s`audience_scope IS NULL`}
       ORDER BY updated_at DESC
       LIMIT ${r}`;c.push(..._.map(L))}return c}async function rt(e,t={},n){return Y(e,{...t,keyPrefix:D},n)}async function ot(e={},t){return(await y(t)`
    SELECT workspace_id, scope, scope_ref, key, body, created_by, expires_at::text
      FROM harness_shared.agent_facts
     WHERE key LIKE ${"wall:%"}
       -- P-008 (a): only the CURRENT version of a wall can be lapsed. A
       -- superseded version's expiry is a historical fact, not a page.
       AND superseded_at IS NULL
       AND retracted_at IS NULL
       AND expires_at < now()
     ORDER BY expires_at ASC
     LIMIT ${e.limit??200}`).map(n=>({workspaceId:n.workspace_id,scope:n.scope,scopeRef:n.scope_ref,key:n.key,body:n.body,createdBy:n.created_by,expiresAt:n.expires_at}))}async function at(e,t={},n){return Y([e],{workspaceId:t.workspaceId,limitPerSelector:t.limit??50,audiences:"all"},n)}async function it(e={},t){const n=y(t),s=e.workspaceId??m(),o=(e.scopeRefs??[]).map(r=>r.trim()).filter(Boolean);return(await n`
    SELECT id, scope, scope_ref, key, body, source_ref, audience_scope, source_provenance,
           confidence, measurement, kind, depends_on, claim, enforcement, created_by, updated_at::text, expires_at::text
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${s} AND kind = 'convention'
       AND superseded_at IS NULL AND retracted_at IS NULL AND expires_at > now()
       AND ${o.length>0?n`(scope = 'workspace' OR coalesce(scope_ref,'') = ANY(${o}))`:n`TRUE`}
     ORDER BY updated_at DESC
     LIMIT ${e.limit??100}`).map(L)}function ct(e){return e.kind!=null?e.kind==="assumption":e.confidence==="suspected"}async function dt(e,t){const n=x(e.scope,e.scopeRef);if(n)throw new d(`facts:versions — ${n}`);const s=e.key.trim();if(!s)throw new d("facts:versions — key required");const o=y(t),r=e.workspaceId??m(),i=e.scope==="workspace"?"":(e.scopeRef??"").trim(),a=e.limit&&e.limit>0?Math.floor(e.limit):20;return(await o`
    SELECT id, superseded_at::text, supersedes_id,
           scope, scope_ref, key, body, source_ref, audience_scope, source_provenance,
           confidence, measurement, kind, depends_on, claim, enforcement, settled_by,
           created_by, updated_at::text, expires_at::text, retracted_at::text,
           retracted_by, retraction_reason
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${r} AND scope = ${e.scope}
       AND coalesce(scope_ref,'') = ${i} AND key = ${s}
       AND source_hive IS NULL
     ORDER BY superseded_at DESC NULLS FIRST, id DESC
     LIMIT ${a}`).map(L)}async function lt(e,t){const n=[...new Set(e.keys.map(s=>s.trim()).filter(Boolean))];return n.length===0?[]:(await y(t)`
    SELECT scope, scope_ref, key, created_by, body, kind, settled_by, updated_at::text
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${e.workspaceId??m()}
       AND source_hive IS NULL
       AND superseded_at IS NOT NULL
       AND key = ANY(${n})
     ORDER BY superseded_at DESC, id DESC
     LIMIT ${e.limit&&e.limit>0?Math.floor(e.limit):400}`).map(s=>({scope:s.scope,scopeRef:s.scope_ref,key:s.key,createdBy:s.created_by,body:s.body,kind:s.kind??null,settledBy:s.settled_by,updatedAt:s.updated_at}))}async function ut(e){return(await y(e)`
    DELETE FROM harness_shared.agent_facts
     WHERE expires_at < now() - interval '30 days'
        OR retracted_at < now() - interval '30 days'
        -- P-008 (a): bound the version tail on the SUPERSEDE date, not on the
        -- version's own expiry. A long-TTL fact (a 90d wall) corrected on day
        -- one leaves a version whose expires_at is still months out; without
        -- this clause the tail would outlive the value it was corrected to.
        OR superseded_at < now() - interval '30 days'
    RETURNING key`).length}function ft(e){return e.outcome==="won"||(e.grade??0)>=4}function Te(e){const t=e.scope==="workspace"?"":`${(e.scopeRef??"").trim()}:`;return`fact:${e.scope}:${t}${e.key}${e.id!=null?`@v${e.id}`:""}`}function ge(e){if(e.floor==null&&!e.reviewBy)return e.tier;const t=e.floor!=null?` ≥${Math.round(e.floor*100)}%`:"",n=e.reviewBy?` by ${e.reviewBy.slice(0,10)}`:"";return`${e.tier}${t}${n}`}function pt(e,t=Date.now()){return e.length===0?"":`### Standing facts (deterministic — assert via facts:assert, retract when stale)
${e.map(n=>{const s=n.scopeRef?`${n.scope}:${n.scopeRef}`:n.scope,o=n.audienceScope?` ⊸${n.audienceScope}`:"",r=we(n.expiresAt)?"permanent":`expires ~${Math.max(0,Math.round((Date.parse(n.expiresAt)-t)/864e5))}d`,i=Le(n),a=i?`, src ${i}`:"",c=n.kind==="convention"&&n.enforcement?` · ${ge(n.enforcement)}`:"",l=n.kind?`⟦${ee[n.kind]}${c}⟧ `:"",p=n.measurement?.subjectVolatile?`⟦SNAPSHOT — subject may still be changing; measured at ${n.measurement.measuredAt}; re-measure before acting⟧ `:"",_=n.kind==="convention"?`, cite ${Te(n)}`:"",h=n.kind==="undecidable"&&n.settledBy?` — SETTLED BY: ${n.settledBy}`:"";return`• [${s}${o}] ${l}${p}${n.body}${h} (${r}${a}${_})`}).join(`
`)}`}function O(e){return e===null?null:K.includes(e)?e:null}function Oe(e){return e==null?null:b.includes(e)?e:null}function Ce(e){if(typeof e=="string")try{e=JSON.parse(e)}catch{return null}return!e||typeof e!="object"||Array.isArray(e)?null:e}function L(e){return{scope:e.scope,scopeRef:e.scope_ref,key:e.key,body:e.body,sourceRef:e.source_ref,audienceScope:e.audience_scope??null,sourceProvenance:ke(e.source_provenance),confidence:O(e.confidence),measurement:be(e.measurement),kind:Oe(e.kind),dependsOn:$e(e.depends_on),claim:Ce(e.claim),enforcement:Se(e.enforcement),...e.settled_by===void 0?{}:{settledBy:e.settled_by},createdBy:e.created_by,updatedAt:e.updated_at,expiresAt:e.expires_at,...e.retracted_at===void 0?{}:{retractedAt:e.retracted_at},...e.retracted_by===void 0?{}:{retractedBy:e.retracted_by},...e.retraction_reason===void 0?{}:{retractionReason:e.retraction_reason},...e.fed_hlc===void 0?{}:{cellVersion:e.fed_hlc},...e.id!=null?{id:Number(e.id)}:{},...e.superseded_at!==void 0?{supersededAt:e.superseded_at}:{},...e.supersedes_id!==void 0?{supersedesId:e.supersedes_id==null?null:Number(e.supersedes_id)}:{}}}async function _t(e){const t=e?.trim();if(!t||t==="*")return null;try{const{loadHarnessRegistry:n}=await g(async()=>{const{loadHarnessRegistry:s}=await import("./harness-registry-BJnz_MHZ.js");return{loadHarnessRegistry:s}},__vite__mapDeps([4,5,1,3,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]));return(await n()).projects.find(s=>s.slug===t)?.hive_slug??t}catch{return null}}var C,K,b,$,J,k,Fe,xe,G,Ue,X,z,Be,Me,D,F,Pe,je,He,Q,Z,ee,yt=ue((()=>{ye(),me(),pe(),he(),fe(),C=["workspace","role","owner","harness","work_item"],K=["verified","provisional","suspected"],b=["conclusion","assumption","convention","undecidable"],$=["structural","gate","detector"],J=new Set(["gate","detector"]),k=1200,Fe=160,xe=168*3600,G="infinity",Ue=900,X=24*3600,z=6*3600,Be=200,Me=12,D="dead-end:",F="wall:",Pe=2160*3600,je=12,He=120,Q=/\b(verified|confirmed|confirms|proven|proves)\b/i,Z=/^fleet:[a-z0-9][a-z0-9._-]*$/i,ee={conclusion:"CONCLUSION",assumption:"ASSUMPTION",convention:"CONVENTION",undecidable:"UNDECIDABLE"}}));export{x as $,yt as A,be as B,Te as C,nt as D,st as E,ot as F,_t as G,ge as H,De as I,tt as J,Ze as K,Se as L,we as M,it as N,rt as O,at as P,ve as Q,Ce as R,Ae as S,ft as T,Le as U,ke as V,pt as W,ut as X,lt as Y,Ne as Z,Pe as _,k as a,Qe as b,He as c,G as d,Ee as et,Fe as f,Ue as g,z as h,Be as i,ct as j,Y as k,b as l,C as m,D as n,K as o,X as p,Re as q,Me as r,xe as s,$ as t,je as u,F as v,dt as w,Ie as x,et as y,$e as z};
