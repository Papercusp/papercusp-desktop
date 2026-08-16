const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/sweep-ranking-D2kXFJMF.js","assets/chunk-ChpBd9eV.js","assets/notify-evicted-Da8XfPsM.js","assets/preload-helper-CcgcQsTF.js","assets/harness-registry-BtRgjvBY.js","assets/harness-registry-Diy1vc1F.js","assets/src-8fWtxfEz.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/operator-state-pg-Cytj1dEs.js","assets/db-encryption-ByK3NqqK.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-als-CSW21ZcE.js","assets/workspace-id-constant-AQ2MH5pQ.js","assets/platform-pot-slug-C6n7Eole.js"])))=>i.map(i=>d[i]);
import{n as pe}from"./chunk-ChpBd9eV.js";import{n as _e,t as O}from"./preload-helper-CcgcQsTF.js";import{en as l,t as ye}from"./src-BnAm_Gmw.js";import{st as me,t as he}from"./src-8fWtxfEz.js";import{r as Ee}from"./coordination-event-log-browser-s_EyGDm7.js";import{c as we,r as m}from"./workspace-registry-Du2UbhlH.js";function Ne(e,t){return e!=="undecidable"?t!=null&&t.trim()!==""?`settledBy is only meaningful for kind:'undecidable' (got kind:'${e??"null"}') — it names what would settle an open question, so on a settled claim it has no referent`:null:t==null||t.trim()===""?`kind:'undecidable' requires settledBy — name the evidence that WOULD settle this question. An undecidable with no stated exit does not stop re-derivation, it invites it: a reader cannot tell "nobody COULD determine this" from "nobody has tried lately"`:null}function Ae(e){return e===X}function ve(e){if(e==="provisional")return z;if(e==="suspected")return Q}function et(e,t){if(t)return null;const n=Z.exec(e);return n?`confidence_lint: this fact's body asserts certainty ("${n[0]}") but no \`confidence\` was set. EI-18681964809855890: a peer's single unreplicated run rendered at IDENTICAL authority to a verified measurement once cost four agents a false regression chase. Pass confidence:'verified' if you replicated this yourself, 'provisional' for a single/unreplicated data point, or 'suspected' for a hunch / second-hand hedge — never write a peer's provisional evidence at higher confidence than they stated it.`:null}function x(e,t){if(!F.includes(e))return`unknown scope '${e}' — one of ${F.join("|")}`;const n=(t??"").trim();return e==="workspace"&&n?"scope 'workspace' carries no scope_ref":e!=="workspace"&&!n?`scope '${e}' requires scope_ref`:null}function Se(e){const t=(e??"").trim();return t?ee.test(t)?null:`audienceScope '${t}' does not match the v1 grammar 'fleet:<slug>' — an unmatchable audience would hide the fact from everyone`:null}function ke(e,t){if(t==null)return null;if(e!=="convention")return`enforcement is only meaningful on kind:'convention' (got ${e==null?"no kind":`kind:'${e}'`}) — a tier describes how a NORM is enforced, and a ${e??"kind-less"} fact is not one`;const n=t.tier;if(!D.includes(n))return`unknown enforcement tier '${n}' — one of ${D.join("|")}. Note 'prompt' is deliberately not a tier (D-016): a convention enforced only by documentation leaves enforcement unset rather than claiming one`;const s=t.floor!=null,o=(t.reviewBy??"").trim()!=="";if(G.has(n)){if(!s||!o)return`tier '${n}' requires ${[s?null:"floor",o?null:"reviewBy"].filter(Boolean).join(" and ")} (D-016: every tier-2/tier-3 behaviour ships with an adoption floor and a review date — "a detector without a floor is prose exhortation in a costume")`;const r=t.floor;if(!Number.isFinite(r)||r<=0||r>1)return`floor must be a rate in (0,1] (got ${JSON.stringify(t.floor)}) — a floor of 0 is not a floor`;const a=(t.reviewBy??"").trim(),i=Date.parse(a);if(!Number.isFinite(i))return`reviewBy '${a}' is not a parseable date — an unparseable review date never comes due`}else if(s||o)return`tier 'structural' takes no ${[s?"floor":null,o?"reviewBy":null].filter(Boolean).join(" and ")} — D-016: structural "needs no enforcement because there is no behaviour to enforce", so the adoption rate is undefined, not merely unmeasured. An uncomputable floor reads as FAILING at review and would get a working convention cut`;return null}function be(e){let t=e;if(typeof t=="string"){const r=t.trim();if(!r)return null;try{t=JSON.parse(r)}catch{return null}}if(!t||typeof t!="object"||Array.isArray(t))return null;const n=t,s=typeof n.tier=="string"?n.tier:"";if(!D.includes(s))return null;const o={tier:s};return typeof n.floor=="number"&&Number.isFinite(n.floor)&&(o.floor=n.floor),typeof n.reviewBy=="string"&&n.reviewBy.trim()&&(o.reviewBy=n.reviewBy.trim()),o}function $e(e){if(typeof e=="string")try{e=JSON.parse(e)}catch{return null}if(!e||typeof e!="object")return null;const t=e;return t.kind!=="msg"&&t.kind!=="work-item"&&t.kind!=="owner-turn"||typeof t.verified!="boolean"||typeof t.verifiedAt!="string"||!t.verifiedAt?null:{kind:t.kind,verified:t.verified,verifiedAt:t.verifiedAt,...typeof t.quote=="string"&&t.quote?{quote:t.quote}:{},...typeof t.label=="string"&&t.label?{label:t.label}:{},...typeof t.error=="string"&&t.error?{error:t.error}:{}}}function De(e){if(typeof e=="string")try{e=JSON.parse(e)}catch{return null}if(!e||typeof e!="object"||Array.isArray(e))return null;const t=e;if(t.subjectVolatile!==!0||typeof t.measuredAt!="string"||!t.measuredAt.trim())return null;const n=Date.parse(t.measuredAt);return Number.isFinite(n)?{subjectVolatile:!0,measuredAt:new Date(n).toISOString()}:null}function Le(e){if(typeof e=="string")try{e=JSON.parse(e)}catch{return[]}if(!Array.isArray(e))return[];const t=[];for(const n of e){if(!n||typeof n!="object")continue;const s=n,o=typeof s.cell=="string"?s.cell.trim():"",r=typeof s.observedAt=="string"?s.observedAt:"";if(!o||!r)continue;const a=typeof s.digest=="string"&&s.digest?s.digest:void 0,i=typeof s.unknown=="string"&&s.unknown?s.unknown:void 0;if(a===void 0!=(i===void 0)&&(t.push({cell:o,...typeof s.subject=="string"&&s.subject?{subject:s.subject}:{},observedAt:r,...a?{digest:a}:{},...i?{unknown:i}:{},...typeof s.observed=="string"&&s.observed?{observed:s.observed.slice(0,120)}:{}}),t.length>=12))break}return t}function Re(e){if(!e||e.length===0)return null;const t=new Set,n=[];for(const s of e){const o=(s?.cell??"").trim();if(!o||t.has(o))continue;const r=typeof s.digest=="string"&&s.digest.length>0,a=typeof s.unknown=="string"&&s.unknown.length>0;if(r!==a&&(t.add(o),n.push({cell:o,...s.subject?{subject:s.subject}:{},observedAt:s.observedAt||new Date().toISOString(),...r?{digest:s.digest}:{},...a?{unknown:s.unknown}:{},...s.observed?{observed:s.observed.slice(0,120)}:{}}),n.length>=12))break}return n.length>0?n:null}function Ie(e){const t=e.sourceRef??"",n=e.sourceProvenance;return n?n.verified?n.quote?`${t} ✓ "${n.quote}"`:`${t} ✓${n.label?` ${n.label}`:""}`:`${t} ✗unverified${n.error?` (${n.error})`:""}`:t}function tt(e,t,n){if((t??"").trim())return t;switch(e){case"owner":return n.ownerId??t;case"harness":return n.harnessSlug??t;case"role":return n.role??t;default:return t}}function p(e){return e??me().sql}function Te(e){const t=e?.trim();return t&&t!=="*"&&t!=="default"?t:void 0}function ge(e){const t=e.trim();if(t.length<=1200)return t;const n=" […]",s=t.slice(0,b-4),o=Math.floor(b*.6);let r=-1;for(let i=s.length-1;i>0;i-=1){const d=s[i];if((d==="."||d==="!"||d==="?"||d===";")&&/\s/.test(s[i+1]??t[s.length]??" ")){r=i;break}}if(r+1>=o)return`${s.slice(0,r+1)}${n}`;const a=s.lastIndexOf(" ");return a>=o?`${s.slice(0,a)}${n}`:`${t.slice(0,b-1)}…`}async function nt(e,t){const n=x(e.scope,e.scopeRef);if(n)throw new l(`facts:assert — ${n}`);const s=Se(e.audienceScope);if(s)throw new l(`facts:assert — ${s}`);const o=(e.audienceScope??"").trim()||null,r=e.key.trim();if(!r)throw new l("facts:assert — key required (stable slug)");const a=ge(e.body);if(!a)throw new l("facts:assert — body required");const i=e.subjectVolatile===!0,d=e.measuredAt?.trim()||null;if(i&&!d)throw new l("facts:assert — subjectVolatile:true requires measuredAt (the ISO timestamp of the sample)");if(!i&&d)throw new l("facts:assert — measuredAt is only meaningful with subjectVolatile:true; mark the subject volatile or omit the timestamp");let c=null;if(d){const E=Date.parse(d);if(!Number.isFinite(E))throw new l(`facts:assert — measuredAt must be a valid ISO timestamp (got '${d}')`);if(E>Date.now()+6e4)throw new l("facts:assert — measuredAt cannot be more than 60 seconds in the future");c={subjectVolatile:!0,measuredAt:new Date(E).toISOString()}}if(i&&e.ttlSec!=null&&e.ttlSec>900)throw new l(`facts:assert — a volatile measurement must use ttlSec <= 900 seconds (15 minutes); the requested ${e.ttlSec}-second TTL would leave a moving snapshot in the standing-facts fold too long`);const _=p(t),y=e.workspaceId??m();if(e.shareable===!0&&!Te(y))throw new Error(`facts:assert — a shareable fact cannot use the '${y}' workspace partition (WI-1564): the coordination/'*' partition never federates, so the fact would be captured then stranded on every peer. Assert from a hive-scoped workspace.`);const h=e.scope==="workspace"?null:(e.scopeRef??"").trim(),se=e.kind==="convention"&&e.ttlSec==null&&!i,re=i?e.ttlSec&&e.ttlSec>0?e.ttlSec:900:e.ttlSec&&e.ttlSec>0?e.ttlSec:ve(e.confidence)??604800,oe=e.confidence??null;if(e.kind!=null&&!$.includes(e.kind))throw new l(`facts:assert — unknown kind '${e.kind}' — one of ${$.join("|")}`);const I=e.kind??null,B=ke(I,e.enforcement);if(B)throw new l(`facts:assert — ${B}`);const P=e.enforcement??null,M=Ne(I,e.settledBy);if(M)throw new l(`facts:assert — ${M}`);const ae=e.settledBy?.trim()?e.settledBy.trim():null,j=Re(e.dependsOn),H=e.claim&&typeof e.claim=="object"?e.claim:null,W=await _`
    WITH superseded AS (
      UPDATE harness_shared.agent_facts
         SET superseded_at = now()
       WHERE workspace_id = ${y} AND scope = ${e.scope}
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
      (${y},
       -- keep an already-stamped federation identity when a later assert omits
       -- it (never NULL it back out) — carried forward off the superseded row,
       -- since there is no longer an UPDATE branch to COALESCE against.
       COALESCE(${e.potHomeSlug??null}, (SELECT harness_slug FROM superseded)),
       ${e.scope}, ${h}, ${r}, ${a},
       ${e.sourceRef??null}, ${e.createdBy??null},
       ${se?_`'infinity'::timestamptz`:_`now() + make_interval(secs => ${re})`},
       ${e.shareable===!0},
       ${o},
       ${e.sourceProvenance?JSON.stringify(e.sourceProvenance):null}::text::jsonb,
       ${oe},
       ${c?JSON.stringify(c):null}::text::jsonb,
       (SELECT id FROM superseded),
       ${I},
       ${j?JSON.stringify(j):null}::text::jsonb,
       ${H?JSON.stringify(H):null}::text::jsonb,
       ${P?JSON.stringify(P):null}::text::jsonb,
       ${ae})
    RETURNING id, superseded_at::text, supersedes_id,
              scope, scope_ref, key, body, source_ref, audience_scope, source_provenance,
              confidence, measurement, kind, depends_on, claim, enforcement, settled_by, created_by, updated_at::text, expires_at::text`,V=W[0].id??null,q=await _`
    UPDATE harness_shared.agent_facts SET retracted_at = now(), evicted_at = now()
     WHERE source_hive IS NULL
       AND superseded_at IS NULL
       AND (workspace_id, scope, coalesce(scope_ref,''), key) IN (
       SELECT workspace_id, scope, coalesce(scope_ref,''), key
         FROM harness_shared.agent_facts
        WHERE workspace_id = ${y} AND scope = ${e.scope}
          AND coalesce(scope_ref,'') = ${h??""}
          AND source_hive IS NULL
          AND superseded_at IS NULL
          AND retracted_at IS NULL AND expires_at > now()
          AND key NOT LIKE ${`${L}%`}
          AND key NOT LIKE ${`${A}%`}
          -- P-028: conventions are governance rows, not ordinary cap
          -- population. Their explicit TTL still controls natural expiry,
          -- but the per-scope observation cap must never retract policy.
          AND COALESCE(kind, '') <> 'convention'
          AND id IS DISTINCT FROM ${V}
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
    RETURNING key, confidence, expires_at, created_by`,T=R(W[0]);if(q.length>0){const E=new Set,v=[];for(const u of q)E.has(u.key)||(E.add(u.key),v.push({key:u.key,confidence:C(u.confidence),expiresAt:u.expires_at,createdBy:u.created_by}));T.evicted=v;let g=null;try{const u=await _`
        SELECT id, confidence, expires_at, created_at, updated_at
          FROM harness_shared.agent_facts
         WHERE workspace_id = ${y} AND scope = ${e.scope}
           AND coalesce(scope_ref,'') = ${h??""}
           AND source_hive IS NULL
           AND superseded_at IS NULL
           AND retracted_at IS NULL AND expires_at > now()
           AND key NOT LIKE ${`${L}%`}
           AND key NOT LIKE ${`${A}%`}`,ce=f=>f==="verified"?0:f==="suspected"?2:1,w=new Set;for(const f of u)w.add(C(f.confidence));for(const f of v)w.add(f.confidence);g={confidenceDiscriminated:new Set([...w].map(ce)).size>1,prevailingConfidence:w.size===1?[...w][0]:null};const{orderAsSweepWould:de,rankOfId:le,sweepRemainingFraction:ue}=await O(async()=>{const{orderAsSweepWould:f,rankOfId:k,sweepRemainingFraction:fe}=await import("./sweep-ranking-D2kXFJMF.js");return{orderAsSweepWould:f,rankOfId:k,sweepRemainingFraction:fe}},__vite__mapDeps([0,1])),Y=Date.now(),S=de(u,Y),N=le(S,V);if(N>0){const f=N===S.length,k=f&&N>1?S[N-2]:null;T.survival={rank:N,liveCount:S.length,nextVictim:f,survivingFractionFloor:k?ue(k,Y):null}}}catch{g=null}const{notifyEvictedFactOwners:ie}=await O(async()=>{const{notifyEvictedFactOwners:u}=await import("./notify-evicted-Da8XfPsM.js");return{notifyEvictedFactOwners:u}},__vite__mapDeps([2,1,3]));await ie({evicted:v,ranking:g,writerOwnerId:e.createdBy,scope:e.scope,scopeRef:h})}return T}async function st(e,t){const n=x(e.scope,e.scopeRef);if(n)throw new l(`facts:retract — ${n}`);const s=p(t),o=e.workspaceId??m(),r=e.scope==="workspace"?"":(e.scopeRef??"").trim();return(await s`
    UPDATE harness_shared.agent_facts
       SET retracted_at = now(), retracted_by = ${e.retractedBy?.trim()||null}, retraction_reason = ${e.reason?.trim()||null}
     WHERE workspace_id = ${o} AND scope = ${e.scope}
       AND coalesce(scope_ref,'') = ${r} AND key = ${e.key.trim()}
       AND source_hive IS NULL
       AND superseded_at IS NULL
       AND retracted_at IS NULL
    RETURNING key`).length>0}async function rt(e,t){const n=e.key.trim();return n?(await p(t)`
    SELECT id, scope, scope_ref, expires_at::text
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${e.workspaceId??m()} AND key = ${n}
       AND source_hive IS NULL
       AND superseded_at IS NULL
       AND retracted_at IS NULL
     ORDER BY expires_at DESC, id DESC
     LIMIT 2`).map(s=>({id:Number(s.id),scope:s.scope,scopeRef:s.scope_ref,expiresAt:s.expires_at})):[]}async function ot(e,t){const n=p(t),s=e.workspaceId??m(),o=e.scope==="workspace"?"":e.scopeRef.trim();return(await n`
    SELECT id, scope, scope_ref, expires_at::text
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${s} AND key = ${e.key.trim()}
       AND source_hive IS NULL
       AND superseded_at IS NULL
       AND retracted_at IS NULL
       AND NOT (scope = ${e.scope} AND coalesce(scope_ref,'') = ${o})
     ORDER BY expires_at DESC
     LIMIT 5`).map(r=>({id:Number(r.id),scope:r.scope,scopeRef:r.scope_ref,expiresAt:r.expires_at}))}function K(e,t,n,s,o,r){return e`workspace_id = ${t} AND scope = ${n}
         AND coalesce(scope_ref,'') = ${s}
         -- P-008 (a): CURRENT versions only. A fold that saw the superseded tail
         -- would serve an agent both the corrected value and the value it
         -- corrected, as peers.
         AND superseded_at IS NULL
         AND retracted_at IS NULL AND expires_at > now()
         AND ${o.length>0?e`key LIKE ANY(${o.map(a=>a+"%")})`:e`TRUE`}
         AND ${r==="all"?e`TRUE`:r.length>0?e`(audience_scope IS NULL OR audience_scope = ANY(${r}))`:e`audience_scope IS NULL`}`}async function at(e,t={},n){const s=p(n),o=t.workspaceId??m(),r=e.scope==="workspace"?"":(e.scopeRef??"").trim();if(e.scope!=="workspace"&&!r)return 0;const a=(t.keyPrefixes??[]).map(c=>c.trim()).filter(Boolean),i=t.audiences==="all"?"all":(t.audiences??[]).map(c=>c.trim()).filter(Boolean),d=await s`
    SELECT count(*)::text AS n
      FROM harness_shared.agent_facts
     WHERE ${K(s,o,e.scope,r,a,i)}`;return Number(d[0]?.n??0)}async function U(e,t={},n){if(e.length===0)return[];const s=p(n),o=t.workspaceId??m(),r=t.limitPerSelector??12,a=(t.keyPrefixes??[]).map(c=>c.trim()).filter(Boolean),i=t.audiences==="all"?"all":(t.audiences??[]).map(c=>c.trim()).filter(Boolean),d=[];for(const c of e){const _=c.scope==="workspace"?"":(c.scopeRef??"").trim();if(c.scope!=="workspace"&&!_)continue;const y=await s`
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
       WHERE ${K(s,o,c.scope,_,a,i)}
       ORDER BY updated_at DESC
       LIMIT ${r}`;d.push(...y.map(R))}return d}async function it(e,t={},n){return U(e,{...t,keyPrefixes:[A]},n)}async function ct(e,t={},n){return U(e,{...t,keyPrefixes:te},n)}async function dt(e={},t){return(await p(t)`
    SELECT workspace_id, scope, scope_ref, key, body, created_by, expires_at::text
      FROM harness_shared.agent_facts
     WHERE key LIKE ${"wall:%"}
       -- P-008 (a): only the CURRENT version of a wall can be lapsed. A
       -- superseded version's expiry is a historical fact, not a page.
       AND superseded_at IS NULL
       AND retracted_at IS NULL
       AND expires_at < now()
     ORDER BY expires_at ASC
     LIMIT ${e.limit??200}`).map(n=>({workspaceId:n.workspace_id,scope:n.scope,scopeRef:n.scope_ref,key:n.key,body:n.body,createdBy:n.created_by,expiresAt:n.expires_at}))}async function lt(e,t={},n){return U([e],{workspaceId:t.workspaceId,limitPerSelector:t.limit??50,audiences:"all"},n)}async function ut(e={},t){const n=p(t),s=e.workspaceId??m(),o=(e.scopeRefs??[]).map(r=>r.trim()).filter(Boolean);return(await n`
    SELECT id, scope, scope_ref, key, body, source_ref, audience_scope, source_provenance,
           confidence, measurement, kind, depends_on, claim, enforcement, created_by, updated_at::text, expires_at::text
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${s} AND kind = 'convention'
       AND superseded_at IS NULL AND retracted_at IS NULL AND expires_at > now()
       AND ${o.length>0?n`(scope = 'workspace' OR coalesce(scope_ref,'') = ANY(${o}))`:n`TRUE`}
     ORDER BY updated_at DESC
     LIMIT ${e.limit??100}`).map(R)}function ft(e){return e.kind!=null?e.kind==="assumption":e.confidence==="suspected"}async function pt(e,t){const n=x(e.scope,e.scopeRef);if(n)throw new l(`facts:versions — ${n}`);const s=e.key.trim();if(!s)throw new l("facts:versions — key required");const o=p(t),r=e.workspaceId??m(),a=e.scope==="workspace"?"":(e.scopeRef??"").trim(),i=e.limit&&e.limit>0?Math.floor(e.limit):20;return(await o`
    SELECT id, superseded_at::text, supersedes_id,
           scope, scope_ref, key, body, source_ref, audience_scope, source_provenance,
           confidence, measurement, kind, depends_on, claim, enforcement, settled_by,
           created_by, updated_at::text, expires_at::text, retracted_at::text,
           retracted_by, retraction_reason
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${r} AND scope = ${e.scope}
       AND coalesce(scope_ref,'') = ${a} AND key = ${s}
       AND source_hive IS NULL
     ORDER BY superseded_at DESC NULLS FIRST, id DESC
     LIMIT ${i}`).map(R)}async function _t(e,t){const n=[...new Set(e.keys.map(s=>s.trim()).filter(Boolean))];return n.length===0?[]:(await p(t)`
    SELECT scope, scope_ref, key, created_by, body, kind, settled_by, updated_at::text
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${e.workspaceId??m()}
       AND source_hive IS NULL
       AND superseded_at IS NOT NULL
       AND key = ANY(${n})
     ORDER BY superseded_at DESC, id DESC
     LIMIT ${e.limit&&e.limit>0?Math.floor(e.limit):400}`).map(s=>({scope:s.scope,scopeRef:s.scope_ref,key:s.key,createdBy:s.created_by,body:s.body,kind:s.kind??null,settledBy:s.settled_by,updatedAt:s.updated_at}))}async function yt(e){return(await p(e)`
    DELETE FROM harness_shared.agent_facts
     WHERE expires_at < now() - interval '30 days'
        OR retracted_at < now() - interval '30 days'
        -- P-008 (a): bound the version tail on the SUPERSEDE date, not on the
        -- version's own expiry. A long-TTL fact (a 90d wall) corrected on day
        -- one leaves a version whose expires_at is still months out; without
        -- this clause the tail would outlive the value it was corrected to.
        OR superseded_at < now() - interval '30 days'
    RETURNING key`).length}function mt(e){return e.outcome==="won"||(e.grade??0)>=4}function Oe(e){const t=e.scope==="workspace"?"":`${(e.scopeRef??"").trim()}:`;return`fact:${e.scope}:${t}${e.key}${e.id!=null?`@v${e.id}`:""}`}function Ce(e){if(e.floor==null&&!e.reviewBy)return e.tier;const t=e.floor!=null?` ≥${Math.round(e.floor*100)}%`:"",n=e.reviewBy?` by ${e.reviewBy.slice(0,10)}`:"";return`${e.tier}${t}${n}`}function ht(e,t=Date.now()){return e.length===0?"":`### Standing facts (deterministic — assert via facts:assert, retract when stale)
${e.map(n=>{const s=n.scopeRef?`${n.scope}:${n.scopeRef}`:n.scope,o=n.audienceScope?` ⊸${n.audienceScope}`:"",r=Ae(n.expiresAt)?"permanent":`expires ~${Math.max(0,Math.round((Date.parse(n.expiresAt)-t)/864e5))}d`,a=Ie(n),i=a?`, src ${a}`:"",d=n.kind==="convention"&&n.enforcement?` · ${Ce(n.enforcement)}`:"",c=n.kind?`⟦${ne[n.kind]}${d}⟧ `:"",_=n.measurement?.subjectVolatile?`⟦SNAPSHOT — subject may still be changing; measured at ${n.measurement.measuredAt}; re-measure before acting⟧ `:"",y=n.kind==="convention"?`, cite ${Oe(n)}`:"",h=n.kind==="undecidable"&&n.settledBy?` — SETTLED BY: ${n.settledBy}`:"";return`• [${s}${o}] ${c}${_}${n.body}${h} (${r}${i}${y})`}).join(`
`)}`}function C(e){return e===null?null:J.includes(e)?e:null}function Fe(e){return e==null?null:$.includes(e)?e:null}function xe(e){if(typeof e=="string")try{e=JSON.parse(e)}catch{return null}return!e||typeof e!="object"||Array.isArray(e)?null:e}function R(e){return{scope:e.scope,scopeRef:e.scope_ref,key:e.key,body:e.body,sourceRef:e.source_ref,audienceScope:e.audience_scope??null,sourceProvenance:$e(e.source_provenance),confidence:C(e.confidence),measurement:De(e.measurement),kind:Fe(e.kind),dependsOn:Le(e.depends_on),claim:xe(e.claim),enforcement:be(e.enforcement),...e.settled_by===void 0?{}:{settledBy:e.settled_by},createdBy:e.created_by,updatedAt:e.updated_at,expiresAt:e.expires_at,...e.retracted_at===void 0?{}:{retractedAt:e.retracted_at},...e.retracted_by===void 0?{}:{retractedBy:e.retracted_by},...e.retraction_reason===void 0?{}:{retractionReason:e.retraction_reason},...e.fed_hlc===void 0?{}:{cellVersion:e.fed_hlc},...e.id!=null?{id:Number(e.id)}:{},...e.superseded_at!==void 0?{supersededAt:e.superseded_at}:{},...e.supersedes_id!==void 0?{supersedesId:e.supersedes_id==null?null:Number(e.supersedes_id)}:{}}}async function Et(e){const t=e?.trim();if(!t||t==="*")return null;try{const{loadHarnessRegistry:n}=await O(async()=>{const{loadHarnessRegistry:s}=await import("./harness-registry-BtRgjvBY.js");return{loadHarnessRegistry:s}},__vite__mapDeps([4,5,1,3,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]));return(await n()).projects.find(s=>s.slug===t)?.hive_slug??t}catch{return null}}var F,J,$,D,G,b,Ue,Be,X,Pe,z,Q,Me,je,A,L,He,We,Ve,Z,ee,te,ne,wt=pe((()=>{he(),Ee(),ye(),we(),_e(),F=["workspace","role","owner","harness","work_item"],J=["verified","provisional","suspected"],$=["conclusion","assumption","convention","undecidable"],D=["structural","gate","detector"],G=new Set(["gate","detector"]),b=1200,Ue=160,Be=168*3600,X="infinity",Pe=900,z=24*3600,Q=6*3600,Me=200,je=12,A="dead-end:",L="wall:",He=2160*3600,We=12,Ve=120,Z=/\b(verified|confirmed|confirms|proven|proves)\b/i,ee=/^fleet:[a-z0-9][a-z0-9._-]*$/i,te=[A,L],ne={conclusion:"CONCLUSION",assumption:"ASSUMPTION",convention:"CONVENTION",undecidable:"UNDECIDABLE"}}));export{yt as $,it as A,be as B,at as C,mt as D,pt as E,Ae as F,Ce as G,Le as H,ut as I,Et as J,Ie as K,lt as L,ct as M,wt as N,ot as O,ft as P,_t as Q,dt as R,ge as S,Oe as T,De as U,xe as V,$e as W,Te as X,tt as Y,st as Z,te as _,b as a,nt as b,Ve as c,X as d,Se as et,Ue as f,Pe as g,Q as h,Me as i,U as j,rt as k,$ as l,F as m,A as n,x as nt,J as o,z as p,ht as q,je as r,Ne as rt,Be as s,D as t,ke as tt,We as u,He as v,ve as w,et as x,L as y,Re as z};
