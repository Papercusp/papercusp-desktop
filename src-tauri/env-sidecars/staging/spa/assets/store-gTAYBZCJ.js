import{n as f}from"./chunk-ChpBd9eV.js";import{c as I,d as R,f as $,t as T}from"./src-DZqanng7.js";import{st as i,t as y}from"./src-8fWtxfEz.js";import{r as b,t as U}from"./coordination-event-log-browser-s_EyGDm7.js";import{n as v,r as g}from"./pg-bounded-txn-CDAxhG-7.js";import{a as S,i as O}from"./announce-key-DMKjmeb6.js";function ie(e){return typeof e=="string"&&(e.includes("*")||e.startsWith("@"))}function x(e){if(typeof e!="string"||!e.startsWith("@"))return e;const t=/^@plan:(.+)$/.exec(e);if(t)return`plan-item:done:${t[1]}:*`;const a=/^@fleet:(.+)$/.exec(e);if(a)return`fleet:*:${a[1]}`;throw new Error(`events:await — unknown pattern macro '${e}'. Known macros: @plan:<slug>, @fleet:<slug>. Or pass a raw glob, e.g. 'work-item:done:*'.`)}function C(e){return e.replace(/[.+?^${}()|[\]\\]/g,"\\$&")}function M(e){return{matches:"^"+C(e).replace(/\*/g,".*")+"$"}}function h(e,t){if(typeof e!="string")return!1;const a=x(e);return a.includes("*")?$(M(a),t):a===t}function A(e,t){if(e==null)return!0;if(!R(e))return!1;try{return I(e,t)}catch{return!1}}function W(e){if(typeof e!="string")return"";const t=e.indexOf("*"),a=t===-1?e:e.slice(0,t),n=a.lastIndexOf(":");return n===-1?t===-1?a:"":a.slice(0,n)}function oe(e){if(e.replace(/[*:]/g,"").length<3)throw new Error(`events:await — pattern '${e}' is too broad (it would wake on nearly every event). Anchor it with a concrete prefix, e.g. 'work-item:done:*' or '@plan:<slug>'.`)}var H=f((()=>{T()})),F,P,L,K=f((()=>{F=1800,P=10080*60,L=["pty-inject","psu-socket-inject","psu-socket-reset","psu-socket-recycle","psu-socket-reset-unconfirmed","psu-socket-recycle-unconfirmed","resume","resume-headless","hive-fresh-wake","plan-run-resume"]}));function q(e,t){return e.map(a=>{if(a.expiresTs!=null||a.rootId==null)return a;const n=t.get(a.rootId);return n?.expiresTs?{...a,expiresTs:n.expiresTs}:a})}function B(e){const t=new Set;for(const a of e)a.expiresTs==null&&a.rootId!=null&&Number.isFinite(a.rootId)&&t.add(a.rootId);return[...t]}function Y(e,t=Date.now()){if(e.expiresTs==null)return!0;const a=Date.parse(e.expiresTs);return!Number.isFinite(a)||a>t}async function G(e,t={}){const a=[...new Set(e.filter(n=>Number.isFinite(n)))];if(a.length===0)return new Map;try{const{sql:n}=i(),r=await n`
      SELECT id, expires_ts, timeout_behavior
        FROM harness_shared.event_await_nodes
       WHERE id = ANY(${a}::bigint[])
         ${t.workspaceId?n`AND workspace_id = ${t.workspaceId}`:n``}
    `;return new Map(r.map(s=>[Number(s.id),{expiresTs:s.expires_ts?new Date(s.expires_ts).toISOString():null,timeoutBehavior:s.timeout_behavior??null}]))}catch{return new Map}}async function p(e,t={}){const a=B(e),n=q(e,a.length>0?await G(a,t):new Map);if(!t.dropExpired)return n;const r=t.nowMs??Date.now();return n.filter(s=>Y(s,r))}var j=f((()=>{y()}));function u(e){if(e==null)return null;if(typeof e=="string")try{return JSON.parse(e)}catch{return null}return e}function l(e){return{id:Number(e.id),workspaceId:e.workspace_id,subscriberId:e.subscriber_id,eventKey:e.event_key,policy:e.policy,note:e.note??null,wakeHandle:u(e.wake_handle),timeoutBehavior:e.timeout_behavior,expiresTs:e.expires_ts?new Date(e.expires_ts).toISOString():null,createdAt:new Date(e.created_at).toISOString(),firedAt:e.fired_at?new Date(e.fired_at).toISOString():null,firedReason:e.fired_reason??null,cancelledAt:e.cancelled_at?new Date(e.cancelled_at).toISOString():null,once:e.once??!0,minSleepSec:e.min_sleep_sec!=null?Number(e.min_sleep_sec):null,urgency:e.urgency??!1,payloadFilter:u(e.payload_filter),scopeKind:e.scope_kind??null,scopeRef:e.scope_ref??null,causalGeneration:e.causal_generation!=null?Number(e.causal_generation):null,expectedCondition:u(e.expected_condition),supersededAt:e.superseded_at?new Date(e.superseded_at).toISOString():null,firedBy:e.fired_by??null,firedPayload:u(e.fired_payload),nodeId:e.node_id!=null?Number(e.node_id):null,rootId:e.root_id!=null?Number(e.root_id):null,memberFiredAt:e.member_fired_at?new Date(e.member_fired_at).toISOString():null,memberPayload:u(e.member_payload),producerHealthCertificate:u(e.producer_health),timeoutVerification:u(e.timeout_verification),verificationClaimedAt:e.verification_claimed_at?new Date(e.verification_claimed_at).toISOString():null}}function D(e){return{id:Number(e.id),workspaceId:e.workspace_id,awaitId:Number(e.await_id),subscriberId:e.subscriber_id,eventKey:e.event_key,payload:u(e.payload),summary:e.summary??null,status:e.status,channel:e.channel??null,attempts:Number(e.attempts),lastError:e.last_error??null,nextAttemptAt:new Date(e.next_attempt_at).toISOString(),createdAt:new Date(e.created_at).toISOString(),deliveredAt:e.delivered_at?new Date(e.delivered_at).toISOString():null,urgent:e.urgent??!1,minSleepSec:e.min_sleep_sec!=null?Number(e.min_sleep_sec):null,coalescedCount:e.coalesced_count!=null?Number(e.coalesced_count):1,source:e.source??null}}function J(e){return{...D(e),wakeHandle:u(e.wake_handle),note:e.await_note??null}}async function ce(e){const{sql:t}=i(),a=o(),n=e.timeoutBehavior??"wake";return l((await t`
    INSERT INTO harness_shared.event_awaits
      (workspace_id, subscriber_id, event_key, policy, note, wake_handle, timeout_behavior, expires_ts, once, min_sleep_sec, urgency, payload_filter, producer_health)
    VALUES
      (${a}, ${e.subscriberId}, ${e.eventKey}, ${e.policy??"wake"},
       ${e.note??null}, ${e.wakeHandle?JSON.stringify(e.wakeHandle):null}::text::jsonb,
       ${n},
       ${e.timeoutSec!=null?new Date(Date.now()+e.timeoutSec*1e3).toISOString():null},
       ${e.once??!0}, ${e.minSleepSec??null}, ${e.urgency??!1},
       ${e.payloadFilter!=null?JSON.stringify(e.payloadFilter):null}::text::jsonb,
       ${e.producerHealthCertificate?JSON.stringify(e.producerHealthCertificate):null}::text::jsonb)
    RETURNING *
  `)[0])}async function de(e){const{sql:t}=i();return l((await t`
    INSERT INTO harness_shared.event_awaits
      (workspace_id, subscriber_id, event_key, policy, note, wake_handle, timeout_behavior, expires_ts, once, min_sleep_sec, urgency)
    VALUES
      (${o()}, ${e.subscriberId}, ${e.eventKey}, 'wake',
       ${e.note??null}, ${e.wakeHandle?JSON.stringify(e.wakeHandle):null}::text::jsonb,
       'expire', NULL, false, ${e.minSleepSec??null}, false)
    ON CONFLICT (workspace_id, subscriber_id, event_key)
      WHERE policy = 'wake' AND once = false AND cancelled_at IS NULL
            AND event_key LIKE 'coord:inbox-wake:%'
    DO UPDATE SET
      wake_handle = COALESCE(EXCLUDED.wake_handle, harness_shared.event_awaits.wake_handle),
      note = COALESCE(EXCLUDED.note, harness_shared.event_awaits.note),
      min_sleep_sec = EXCLUDED.min_sleep_sec
    RETURNING *
  `)[0])}async function le(e){const{sql:t}=i();return(await t`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()} AND subscriber_id = ${e}
       AND policy = 'wake' AND once = false AND fired_at IS NULL AND cancelled_at IS NULL
       AND event_key LIKE 'coord:inbox-wake:%'
    RETURNING id
  `).length}async function _e(e){const{sql:t}=i();return(await t`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()} AND subscriber_id = ${e}
       AND event_key = 'work-item:claimable'
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}async function ue(e,t){if(e.length===0||t.length===0)return 0;const{sql:a}=i();return(await a`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()}
       AND subscriber_id = ANY(${a.array([...e])}::text[])
       AND event_key = ANY(${a.array([...t])}::text[])
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}async function we(e){if(e.length===0)return 0;const{sql:t}=i();return(await t`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()} AND id = ANY(${[...e]})
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}async function Ee(e){const{sql:t}=i();return(await t`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()} AND id = ${e.awaitId}
       AND subscriber_id = ${e.subscriberId}
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length>0}async function Ne(e){const{sql:t}=i(),a=o();return p((await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${a} AND subscriber_id = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at DESC
     LIMIT 100
  `).map(l),{workspaceId:a})}async function fe(e){const{sql:t}=i();return(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${o()} AND event_key LIKE ${e+"%"}
       AND fired_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at ASC
     LIMIT 200
  `).map(l)}async function Ae(e){const t=[...new Set(e.filter(r=>!!r))];if(t.length===0)return[];const{sql:a}=i(),n=o();return p((await a`
    SELECT subscriber_id, event_key, note, expires_ts, created_at, root_id
      FROM harness_shared.event_awaits
     WHERE workspace_id = ${n}
       AND subscriber_id = ANY(${t}::text[])
       AND fired_at IS NULL AND cancelled_at IS NULL
       AND event_key NOT LIKE ${"coord:inbox-wake:%"}
       AND policy <> 'announce'
       AND (expires_ts IS NULL OR expires_ts > now())
     ORDER BY created_at DESC
     LIMIT 500
  `).map(r=>({subscriberId:r.subscriber_id,eventKey:r.event_key,note:r.note??null,expiresTs:r.expires_ts?new Date(r.expires_ts).toISOString():null,createdAt:new Date(r.created_at).toISOString(),rootId:r.root_id!=null?Number(r.root_id):null})),{workspaceId:n,dropExpired:!0})}async function pe(e,t=24){const a=[...new Set(e.filter(r=>!!r))];if(a.length===0)return[];const{sql:n}=i();return(await n`
    SELECT DISTINCT ON (subscriber_id, event_key)
           subscriber_id, event_key, fired_at, timeout_verification
      FROM harness_shared.event_awaits
     WHERE workspace_id = ${o()}
       AND subscriber_id = ANY(${a}::text[])
       AND fired_reason = 'verified-timeout'
       AND fired_at >= now() - make_interval(hours => ${Math.min(Math.max(t,1),168)})
       AND timeout_verification IS NOT NULL
     ORDER BY subscriber_id, event_key, fired_at DESC
     LIMIT 500
  `).flatMap(r=>{const s=u(r.timeout_verification);if(!s||s.classification!=="stalled"&&s.classification!=="absent"||s.nextAction!=="wake-owner-or-takeover")return[];const c=s.owner.workItemId??s.owner.ownerId;return[{subscriberId:r.subscriber_id,eventKey:r.event_key,firedAt:new Date(r.fired_at).toISOString(),classification:s.classification,nextAction:s.nextAction,producer:s.producer,owner:s.owner,checkedAtMs:s.checkedAtMs,verificationDeadlineMs:s.verificationDeadlineMs,lastProgressAtMs:s.lastProgressAtMs,lastFireAtMs:s.lastFireAtMs,...s.evidence?{evidence:s.evidence}:{},remedy:c?`Wake the owner of ${c}; if it does not resume promptly, claim/take over ${c}.`:"No owning work-item or agent was recorded; claim the producer repair before retrying this wait."}]})}async function De(e,t=5){const a=o();return p((await v(n=>n`
    SELECT event_key, expires_ts, root_id
      FROM harness_shared.event_awaits
     WHERE workspace_id = ${a}
       AND subscriber_id = ${e}
       AND policy = 'wake'
       AND fired_at IS NULL AND cancelled_at IS NULL
       AND event_key NOT LIKE ${"coord:inbox-wake:%"}
       AND (expires_ts IS NULL OR expires_ts > now())
     ORDER BY created_at DESC
     LIMIT ${t}
  `)).map(n=>({eventKey:n.event_key,expiresTs:n.expires_ts?new Date(n.expires_ts).toISOString():null,rootId:n.root_id!=null?Number(n.root_id):null})),{workspaceId:a,dropExpired:!0})}async function Se(e){const t=o();return(await v(a=>a`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${t} AND event_key = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL
       AND policy <> 'announce'
     ORDER BY created_at ASC
  `)).map(l)}async function ye(e){const t=[...new Set(e.filter(s=>s.length>0))],a=new Map;if(t.length===0)return a;for(const s of t)a.set(s,0);const{sql:n}=i(),r=await n`
    SELECT p.prefix AS prefix, count(a.id)::int AS n
      FROM unnest(${t}::text[]) AS p(prefix)
      LEFT JOIN harness_shared.event_awaits a
        ON a.workspace_id = ${o()}
       AND a.event_key LIKE p.prefix || '%'
       AND a.fired_at IS NULL AND a.cancelled_at IS NULL
       AND a.policy <> 'announce'
     GROUP BY p.prefix
  `;for(const s of r)a.set(s.prefix,Number(s.n)||0);return a}async function ve(e){const{sql:t}=i(),a=o(),n=await t`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = ${e.reason??"event"}
     WHERE workspace_id = ${a} AND event_key = ${e.eventKey}
       AND once = true AND fired_at IS NULL AND cancelled_at IS NULL
       AND payload_filter IS NULL
       AND policy <> 'announce'
    RETURNING *
  `,r=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${a} AND event_key = ${e.eventKey}
       AND once = true AND fired_at IS NULL AND cancelled_at IS NULL
       AND payload_filter IS NOT NULL
       AND policy <> 'announce'
  `).filter(d=>A(u(d.payload_filter),e.payload)).map(d=>Number(d.id)),s=r.length>0?await t`
          UPDATE harness_shared.event_awaits
             SET fired_at = now(), fired_reason = ${e.reason??"event"}
           WHERE id = ANY(${r})
             AND fired_at IS NULL AND cancelled_at IS NULL
          RETURNING *
        `:[],c=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${a} AND event_key = ${e.eventKey}
       AND once = false AND cancelled_at IS NULL
       AND (expires_ts IS NULL OR expires_ts > now())
       AND policy <> 'announce'
  `).filter(d=>A(u(d.payload_filter),e.payload)),_=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${a}
       AND event_key LIKE '%*%'
       AND fired_at IS NULL AND cancelled_at IS NULL
       AND (once = true OR expires_ts IS NULL OR expires_ts > now())
       AND policy <> 'announce'
  `).filter(d=>typeof d.event_key=="string"&&h(d.event_key,e.eventKey)&&A(u(d.payload_filter),e.payload)),w=_.filter(d=>(d.once??!0)===!0).map(d=>Number(d.id)),N=_.filter(d=>(d.once??!0)===!1),E=w.length>0?await t`
          UPDATE harness_shared.event_awaits
             SET fired_at = now(), fired_reason = ${e.reason??"event"}
           WHERE id = ANY(${w})
             AND fired_at IS NULL AND cancelled_at IS NULL
          RETURNING *
        `:[];return[...n,...s,...c,...E,...N].map(l)}async function he(e,t="event"){if(e.length===0)return[];const{sql:a}=i();return(await a`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = ${t}
     WHERE workspace_id = ${o()} AND id = ANY(${e})
       AND once = true AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING *
  `).map(l)}async function Le(e){if(e.awaits.length===0)return 0;const{sql:t}=i(),a=o(),n=e.payload===void 0?null:JSON.stringify(e.payload);let r=0;for(const s of e.awaits){const c=(e.urgent??!1)||s.urgency;await t`
      INSERT INTO harness_shared.event_wake_deliveries
        (workspace_id, await_id, subscriber_id, event_key, payload, summary, urgent, min_sleep_sec, source)
      VALUES (${a}, ${s.id}, ${s.subscriberId}, ${s.eventKey}, ${n}::text::jsonb,
              ${e.summary??null}, ${c}, ${s.minSleepSec??null}, ${e.source??null})
    `,r++}return r}async function ke(e){const{sql:t}=i();return(await t`
    WITH due AS (
      SELECT id FROM harness_shared.event_wake_deliveries
       WHERE workspace_id = ${o()}
         AND status IN ('pending', 'parked')
         AND next_attempt_at <= now()
       ORDER BY created_at ASC
       LIMIT ${e.limit??10}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE harness_shared.event_wake_deliveries d
       SET status = 'delivering', attempts = d.attempts + 1
      FROM due
     WHERE d.id = due.id
    RETURNING d.*,
      (SELECT a.wake_handle FROM harness_shared.event_awaits a WHERE a.id = d.await_id) AS wake_handle,
      (SELECT a.note FROM harness_shared.event_awaits a WHERE a.id = d.await_id) AS await_note
  `).map(J)}async function me(e,t,a=1){const{sql:n}=i();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = ${t}, delivered_at = now(), last_error = NULL,
           coalesced_count = ${a}
     WHERE id = ${e}
  `}async function Ie(e,t){if(e.length===0)return;const{sql:a}=i();await a`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = 'coalesced', delivered_at = now(),
           last_error = ${`coalesced into wake #${t}`}
     WHERE id = ANY(${e})
  `}async function Re(e){const t=new Map;if(e.length===0)return t;const{sql:a}=i(),n=await a`
    SELECT subscriber_id, max(delivered_at) AS last_woken_at
      FROM harness_shared.event_wake_deliveries
     WHERE workspace_id = ${o()}
       AND subscriber_id = ANY(${e})
       AND status = 'delivered'
       AND channel = ANY(${L})
       AND delivered_at IS NOT NULL
     GROUP BY subscriber_id
  `;for(const r of n)r.last_woken_at&&t.set(r.subscriber_id,new Date(r.last_woken_at).getTime());return t}async function $e(e,t,a){const{sql:n}=i();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'parked', last_error = ${t},
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(a/1e3)})
     WHERE id = ${e}
  `}async function Te(e,t){const{sql:a}=i();await a`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'dropped', last_error = ${t}
     WHERE id = ${e}
  `}async function be(e){const{sql:t}=i();return e.attempts>=e.maxAttempts?(await t`
      UPDATE harness_shared.event_wake_deliveries
         SET status = 'dead', last_error = ${e.error}
       WHERE id = ${e.id}
    `,"dead"):(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending', last_error = ${e.error},
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(e.backoffMs/1e3)})
     WHERE id = ${e.id}
  `,"retrying")}async function Ue(e){const{sql:t}=i(),a=(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = CASE WHEN attempts >= ${e.maxAttempts} THEN 'dead' ELSE 'pending' END,
           channel = NULL,
           delivered_at = NULL,
           coalesced_count = 1,
           last_error = ${e.error},
           next_attempt_at = CASE
             WHEN attempts >= ${e.maxAttempts} THEN next_attempt_at
             ELSE now() + make_interval(secs => ${Math.ceil(e.backoffMs/1e3)})
           END
     WHERE id = ${e.id} AND status = 'delivered'
    RETURNING status
  `)[0]?.status;return a==="dead"?"dead":a==="pending"?"retrying":"ignored"}async function ge(e,t){const{sql:a}=i();await a`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending', attempts = greatest(attempts - 1, 0),
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(t/1e3)})
     WHERE id = ${e}
  `}async function Oe(e){const{sql:t}=i();return(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending'
     WHERE workspace_id = ${o()} AND status = 'delivering'
       AND next_attempt_at < now() - make_interval(secs => ${Math.ceil(e.olderThanMs/1e3)})
    RETURNING id
  `).length}async function xe(){const{sql:e}=i();return(await e`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'timeout'
     WHERE workspace_id = ${o()} AND timeout_behavior = 'wake'
       AND expires_ts IS NOT NULL AND expires_ts <= now()
       AND producer_health IS NULL
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING *
  `).map(l)}async function Ce(e=100){const{sql:t}=i();return(await t`
    WITH due AS (
      SELECT id
        FROM harness_shared.event_awaits
       WHERE workspace_id = ${o()}
         AND timeout_behavior = 'wake'
         AND producer_health IS NOT NULL
         AND expires_ts IS NOT NULL AND expires_ts <= now()
         AND fired_at IS NULL AND cancelled_at IS NULL
         AND (verification_claimed_at IS NULL OR verification_claimed_at < now() - interval '2 minutes')
       ORDER BY expires_ts ASC
       LIMIT ${Math.min(Math.max(e,1),500)}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE harness_shared.event_awaits a
       SET verification_claimed_at = now()
      FROM due
     WHERE a.id = due.id
    RETURNING a.*
  `).map(l)}async function Me(e){const{sql:t}=i(),a=o();if(e.result.classification==="progressing"){if(!e.nextCertificate)throw new Error("progressing verified wait requires nextCertificate");return await t`
      UPDATE harness_shared.event_awaits
         SET producer_health = ${JSON.stringify(e.nextCertificate)}::text::jsonb,
             expires_ts = to_timestamp(${e.nextCertificate.verificationDeadlineMs} / 1000.0),
             timeout_verification = ${JSON.stringify(e.result)}::text::jsonb,
             verification_claimed_at = NULL
       WHERE workspace_id = ${a} AND id = ${e.id}
         AND fired_at IS NULL AND cancelled_at IS NULL
    `,null}const n=await t`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'verified-timeout',
           timeout_verification = ${JSON.stringify(e.result)}::text::jsonb,
           verification_claimed_at = NULL
     WHERE workspace_id = ${a} AND id = ${e.id}
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING *
  `;return n[0]?l(n[0]):null}async function We(){const{sql:e}=i();return(await e`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'expired'
     WHERE workspace_id = ${o()} AND timeout_behavior = 'expire'
       AND expires_ts IS NOT NULL AND expires_ts <= now()
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}async function He(e){const{sql:t}=i();return(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = COALESCE(channel, 'inbox'), delivered_at = now(),
           last_error = 'acked by subscriber while awake'
     WHERE id = ${e.deliveryId} AND subscriber_id = ${e.subscriberId}
       AND status IN ('pending', 'parked', 'delivering')
    RETURNING id
  `).length>0}async function Fe(e){const{sql:t}=i(),a=o(),n=`${m}${e.subscriberId}`;return(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = 'coalesced', delivered_at = now(),
           last_error = 'caught up at turn-end cursor settle — already seen in a bulk coord:inbox read (EI-9389)'
     WHERE workspace_id = ${a} AND subscriber_id = ${e.subscriberId}
       AND event_key = ${n}
       AND status IN ('pending', 'parked')
       AND created_at <= ${e.cutoffTs}
    RETURNING id
  `).length}async function Pe(e,t=10){const{sql:a}=i();return(await a`
    SELECT * FROM harness_shared.event_wake_deliveries
     WHERE subscriber_id = ${e}
     ORDER BY created_at DESC
     LIMIT ${t}
  `).map(D)}async function Ke(e={}){const{sql:t}=i();return(await t`
    SELECT subscriber_id, status, channel, count(*)::int AS count
      FROM harness_shared.event_wake_deliveries
     WHERE workspace_id = ${o()}
       AND created_at > now() - make_interval(hours => ${e.sinceHours??24})
     GROUP BY subscriber_id, status, channel
     ORDER BY count DESC
     LIMIT 50
  `).map(a=>({subscriberId:a.subscriber_id,status:a.status,channel:a.channel??null,count:Number(a.count)}))}async function qe(e){const{sql:t}=i(),a=o(),n=e.expiresSec!=null?new Date(Date.now()+e.expiresSec*1e3).toISOString():null;return t.begin(async r=>{await r`SELECT pg_advisory_xact_lock(hashtextextended(${"event-announce:"+e.eventKey}, 0))`;const s=await r`
      SELECT COALESCE(MAX(causal_generation), 0)::bigint + 1 AS next_generation
        FROM harness_shared.event_awaits
       WHERE workspace_id = ${a} AND policy = 'announce' AND event_key = ${e.eventKey}
    `,c=Number(s[0]?.next_generation??1);return await r`
      UPDATE harness_shared.event_awaits
         SET superseded_at = COALESCE(superseded_at, now())
       WHERE workspace_id = ${a} AND policy = 'announce' AND event_key = ${e.eventKey}
         AND superseded_at IS NULL
    `,l((await r`
      INSERT INTO harness_shared.event_awaits
        (workspace_id, subscriber_id, event_key, policy, note, wake_handle, timeout_behavior, expires_ts,
         once, min_sleep_sec, urgency, payload_filter, scope_kind, scope_ref, causal_generation,
         expected_condition)
      VALUES
        (${a}, ${e.subscriberId}, ${e.eventKey}, 'announce', ${e.note??null}, NULL,
         'expire', ${n}, false, NULL, false, NULL, ${e.scopeKind}, ${e.scopeRef??null},
         ${c}, ${e.expectedCondition!=null?JSON.stringify(e.expectedCondition):null}::text::jsonb)
      RETURNING *
    `)[0])})}async function Be(e){const{sql:t}=i();return(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${o()} AND policy = 'announce' AND event_key = ${e}
       AND cancelled_at IS NULL AND superseded_at IS NULL
     ORDER BY causal_generation DESC NULLS LAST, created_at DESC
     LIMIT 1
  `).map(l)}async function Ye(e,t){const a=S(e);if(!a)return[];const{sql:n}=i(),r=await n`
    SELECT event_key, policy, subscriber_id FROM harness_shared.event_awaits
     WHERE workspace_id = ${o()} AND cancelled_at IS NULL AND fired_at IS NULL
       AND event_key <> ${e}
       AND position('*' in event_key) = 0
     ORDER BY created_at DESC
     LIMIT 200
  `,s=new Map;for(const c of r){const _=String(c.event_key),w=String(c.subscriber_id);if(t?.excludeOwner&&w===t.excludeOwner||S(_)!==a)continue;const N=String(c.policy)==="announce"?"announce":"await",E=s.get(_);E?(E.holders.add(w),N==="announce"&&(E.kind="announce")):s.set(_,{kind:N,holders:new Set([w])})}return[...s.entries()].slice(0,5).map(([c,_])=>({eventKey:c,kind:_.kind,holders:_.holders.size}))}async function Ge(e,t={}){const{sql:a}=i(),n=o();return(await a`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'event', fired_by = ${t.firedBy??null},
           fired_payload = ${t.payload!==void 0?JSON.stringify(t.payload):null}::text::jsonb
     WHERE workspace_id = ${n} AND policy = 'announce' AND event_key = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL
    RETURNING id
  `).length}async function je(e={}){const{sql:t}=i();return(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${o()} AND policy = 'announce'
       AND cancelled_at IS NULL AND superseded_at IS NULL
       AND (expires_ts IS NULL OR expires_ts > now())
       AND (${e.unfiredOnly===!1} OR fired_at IS NULL)
     ORDER BY created_at DESC
     LIMIT ${Math.min(e.limit??100,200)}
  `).map(l)}function k(e){return{workspaceId:e.workspace_id,eventKey:e.event_key,firstFiredAt:e.first_fired_at,lastFiredAt:e.last_fired_at,lastFiredBy:e.last_fired_by??null,lastPayload:e.last_payload??null,fireCount:Number(e.fire_count)||0}}async function Je(e){const{sql:t}=i();await t`
    INSERT INTO harness_shared.event_key_fires
      (workspace_id, event_key, first_fired_at, last_fired_at, last_fired_by, last_payload, fire_count)
    VALUES
      (${o()}, ${e.eventKey}, now(), now(), ${e.firedBy??null},
       ${e.payload!==void 0?JSON.stringify(e.payload):null}::text::jsonb, 1)
    ON CONFLICT (workspace_id, event_key) DO UPDATE
       SET last_fired_at = now(),
           last_fired_by = ${e.firedBy??null},
           last_payload = ${e.payload!==void 0?JSON.stringify(e.payload):null}::text::jsonb,
           fire_count = harness_shared.event_key_fires.fire_count + 1
  `}async function Ve(e){const{sql:t}=i(),a=await t`
    SELECT * FROM harness_shared.event_key_fires
     WHERE workspace_id = ${o()} AND event_key = ${e}
     LIMIT 1
  `;return a.length>0?k(a[0]):null}function V(e){const t=String(e??"").trim().split(":");return t.length<=2?t.join(":"):t.slice(0,2).join(":")}async function Xe(e){const{sql:t}=i(),a=o(),n=String(e??"").trim(),r=V(n),s={prefix:r,exact:!1,distinctKeys:0,fires:0,lastFiredAt:null};if(!r)return s;const c=(await t`
    SELECT count(*)::int                                             AS distinct_keys,
           coalesce(sum(fire_count), 0)::bigint                      AS fires,
           max(last_fired_at)                                        AS last_fired_at,
           bool_or(event_key = ${n})                               AS exact
      FROM harness_shared.event_key_fires
     WHERE workspace_id = ${a}
       AND (event_key = ${r} OR event_key LIKE ${`${r.replace(/([\\%_])/g,"\\$1")}:%`} ESCAPE '\\')
  `)[0];return c?{prefix:r,exact:c.exact===!0,distinctKeys:Number(c.distinct_keys)||0,fires:Number(c.fires)||0,lastFiredAt:c.last_fired_at?String(c.last_fired_at):null}:s}async function ze(e,t){const{sql:a}=i(),n=o(),r=String(e??"").trim(),s=Math.max(1,Math.min(500,t?.limit??200)),c=W(r),_={prefix:c,matchedKeys:[],truncated:!1};if(!r.includes("*"))return _;const w=c?await a`
        SELECT event_key
          FROM harness_shared.event_key_fires
         WHERE workspace_id = ${n}
           AND (event_key = ${c} OR event_key LIKE ${`${c.replace(/([\\%_])/g,"\\$1")}:%`} ESCAPE '\\')
         ORDER BY last_fired_at DESC
         LIMIT ${s}
      `:await a`
        SELECT event_key
          FROM harness_shared.event_key_fires
         WHERE workspace_id = ${n}
         ORDER BY last_fired_at DESC
         LIMIT ${s}
      `,N=[];for(const E of w){const d=typeof E?.event_key=="string"?E.event_key:null;d&&h(r,d)&&N.push(d)}return{prefix:c,matchedKeys:N,truncated:w.length>=s}}async function Qe(e){const{sql:t}=i(),a=o();return t.begin(async n=>{const r=await n`
      SELECT * FROM harness_shared.event_awaits
       WHERE workspace_id = ${a} AND event_key = ${e} AND policy = 'announce'
       ORDER BY causal_generation DESC NULLS LAST, created_at DESC
       LIMIT 50
    `,s=await n`
      SELECT * FROM harness_shared.event_awaits
       WHERE workspace_id = ${a} AND event_key = ${e} AND policy <> 'announce'
       ORDER BY created_at DESC
       LIMIT 200
    `,c=await n`
      SELECT * FROM harness_shared.event_wake_deliveries
       WHERE workspace_id = ${a} AND event_key = ${e}
       ORDER BY created_at DESC
       LIMIT 200
    `,_=await n`
      SELECT * FROM harness_shared.event_key_fires
       WHERE workspace_id = ${a} AND event_key = ${e}
       LIMIT 1
    `;return{announcements:r.map(l),waiters:s.map(l),deliveries:c.map(D),fireLatch:_.length>0?k(_[0]):null}})}var o,m,Ze=f((()=>{y(),g(),b(),O(),H(),K(),j(),o=()=>U,m="coord:inbox-wake:"}));export{x as $,De as A,Oe as B,je as C,Ae as D,Se as E,be as F,Me as G,ce as H,$e as I,Ke as J,Ge as K,Xe as L,ge as M,me as N,Pe as O,Te as P,oe as Q,ze as R,Re as S,fe as T,Ue as U,qe as V,Fe as W,P as X,F as Y,K as Z,Ve as _,ue as a,Qe as b,ke as c,ye as d,H as et,We as f,xe as g,ve as h,we as i,Ie as j,pe as k,Ce as l,Ye as m,He as n,h as nt,_e as o,Be as p,de as q,Ee as r,A as rt,le as s,m as t,ie as tt,he as u,Ze as v,Ne as w,V as x,Le as y,Je as z};
