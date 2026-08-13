import{n as f}from"./chunk-ChpBd9eV.js";import{c as m,d as R,f as $,t as T}from"./src-DZqanng7.js";import{st as r,t as S}from"./src-BmBNODK0.js";import{r as b,t as g}from"./coordination-event-log-browser-s_EyGDm7.js";import{n as h,r as U}from"./pg-bounded-txn-XpvwFDFc.js";import{a as D,i as O}from"./announce-key-DMKjmeb6.js";function ie(e){return typeof e=="string"&&(e.includes("*")||e.startsWith("@"))}function x(e){if(typeof e!="string"||!e.startsWith("@"))return e;const t=/^@plan:(.+)$/.exec(e);if(t)return`plan-item:done:${t[1]}:*`;const a=/^@fleet:(.+)$/.exec(e);if(a)return`fleet:*:${a[1]}`;throw new Error(`events:await — unknown pattern macro '${e}'. Known macros: @plan:<slug>, @fleet:<slug>. Or pass a raw glob, e.g. 'work-item:done:*'.`)}function C(e){return e.replace(/[.+?^${}()|[\]\\]/g,"\\$&")}function M(e){return{matches:"^"+C(e).replace(/\*/g,".*")+"$"}}function v(e,t){if(typeof e!="string")return!1;const a=x(e);return a.includes("*")?$(M(a),t):a===t}function p(e,t){if(e==null)return!0;if(!R(e))return!1;try{return m(e,t)}catch{return!1}}function W(e){if(typeof e!="string")return"";const t=e.indexOf("*"),a=t===-1?e:e.slice(0,t),n=a.lastIndexOf(":");return n===-1?t===-1?a:"":a.slice(0,n)}function oe(e){if(e.replace(/[*:]/g,"").length<3)throw new Error(`events:await — pattern '${e}' is too broad (it would wake on nearly every event). Anchor it with a concrete prefix, e.g. 'work-item:done:*' or '@plan:<slug>'.`)}var H=f((()=>{T()})),F,P,L,K=f((()=>{F=1800,P=10080*60,L=["pty-inject","psu-socket-inject","psu-socket-reset","psu-socket-recycle","psu-socket-reset-unconfirmed","psu-socket-recycle-unconfirmed","resume","resume-headless","hive-fresh-wake","plan-run-resume"]}));function q(e,t){return e.map(a=>{if(a.expiresTs!=null||a.rootId==null)return a;const n=t.get(a.rootId);return n?.expiresTs?{...a,expiresTs:n.expiresTs}:a})}function B(e){const t=new Set;for(const a of e)a.expiresTs==null&&a.rootId!=null&&Number.isFinite(a.rootId)&&t.add(a.rootId);return[...t]}function Y(e,t=Date.now()){if(e.expiresTs==null)return!0;const a=Date.parse(e.expiresTs);return!Number.isFinite(a)||a>t}async function G(e,t={}){const a=[...new Set(e.filter(n=>Number.isFinite(n)))];if(a.length===0)return new Map;try{const{sql:n}=r(),s=await n`
      SELECT id, expires_ts, timeout_behavior
        FROM harness_shared.event_await_nodes
       WHERE id = ANY(${a}::bigint[])
         ${t.workspaceId?n`AND workspace_id = ${t.workspaceId}`:n``}
    `;return new Map(s.map(i=>[Number(i.id),{expiresTs:i.expires_ts?new Date(i.expires_ts).toISOString():null,timeoutBehavior:i.timeout_behavior??null}]))}catch{return new Map}}async function A(e,t={}){const a=B(e),n=q(e,a.length>0?await G(a,t):new Map);if(!t.dropExpired)return n;const s=t.nowMs??Date.now();return n.filter(i=>Y(i,s))}var j=f((()=>{S()}));function u(e){if(e==null)return null;if(typeof e=="string")try{return JSON.parse(e)}catch{return null}return e}function _(e){return{id:Number(e.id),workspaceId:e.workspace_id,subscriberId:e.subscriber_id,eventKey:e.event_key,policy:e.policy,note:e.note??null,wakeHandle:u(e.wake_handle),timeoutBehavior:e.timeout_behavior,expiresTs:e.expires_ts?new Date(e.expires_ts).toISOString():null,createdAt:new Date(e.created_at).toISOString(),firedAt:e.fired_at?new Date(e.fired_at).toISOString():null,firedReason:e.fired_reason??null,cancelledAt:e.cancelled_at?new Date(e.cancelled_at).toISOString():null,once:e.once??!0,minSleepSec:e.min_sleep_sec!=null?Number(e.min_sleep_sec):null,urgency:e.urgency??!1,payloadFilter:u(e.payload_filter),scopeKind:e.scope_kind??null,scopeRef:e.scope_ref??null,causalGeneration:e.causal_generation!=null?Number(e.causal_generation):null,expectedCondition:u(e.expected_condition),supersededAt:e.superseded_at?new Date(e.superseded_at).toISOString():null,firedBy:e.fired_by??null,firedPayload:u(e.fired_payload),nodeId:e.node_id!=null?Number(e.node_id):null,rootId:e.root_id!=null?Number(e.root_id):null,memberFiredAt:e.member_fired_at?new Date(e.member_fired_at).toISOString():null,memberPayload:u(e.member_payload)}}function y(e){return{id:Number(e.id),workspaceId:e.workspace_id,awaitId:Number(e.await_id),subscriberId:e.subscriber_id,eventKey:e.event_key,payload:u(e.payload),summary:e.summary??null,status:e.status,channel:e.channel??null,attempts:Number(e.attempts),lastError:e.last_error??null,nextAttemptAt:new Date(e.next_attempt_at).toISOString(),createdAt:new Date(e.created_at).toISOString(),deliveredAt:e.delivered_at?new Date(e.delivered_at).toISOString():null,urgent:e.urgent??!1,minSleepSec:e.min_sleep_sec!=null?Number(e.min_sleep_sec):null,coalescedCount:e.coalesced_count!=null?Number(e.coalesced_count):1,source:e.source??null}}function J(e){return{...y(e),wakeHandle:u(e.wake_handle),note:e.await_note??null}}async function ce(e){const{sql:t}=r(),a=o(),n=e.timeoutBehavior??"wake";return _((await t`
    INSERT INTO harness_shared.event_awaits
      (workspace_id, subscriber_id, event_key, policy, note, wake_handle, timeout_behavior, expires_ts, once, min_sleep_sec, urgency, payload_filter)
    VALUES
      (${a}, ${e.subscriberId}, ${e.eventKey}, ${e.policy??"wake"},
       ${e.note??null}, ${e.wakeHandle?JSON.stringify(e.wakeHandle):null}::text::jsonb,
       ${n},
       ${e.timeoutSec!=null?new Date(Date.now()+e.timeoutSec*1e3).toISOString():null},
       ${e.once??!0}, ${e.minSleepSec??null}, ${e.urgency??!1},
       ${e.payloadFilter!=null?JSON.stringify(e.payloadFilter):null}::text::jsonb)
    RETURNING *
  `)[0])}async function le(e){const{sql:t}=r();return _((await t`
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
  `)[0])}async function de(e){const{sql:t}=r();return(await t`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()} AND subscriber_id = ${e}
       AND policy = 'wake' AND once = false AND fired_at IS NULL AND cancelled_at IS NULL
       AND event_key LIKE 'coord:inbox-wake:%'
    RETURNING id
  `).length}async function _e(e){const{sql:t}=r();return(await t`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()} AND subscriber_id = ${e}
       AND event_key = 'work-item:claimable'
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}async function ue(e,t){if(e.length===0||t.length===0)return 0;const{sql:a}=r();return(await a`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()}
       AND subscriber_id = ANY(${a.array([...e])}::text[])
       AND event_key = ANY(${a.array([...t])}::text[])
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}async function Ee(e){if(e.length===0)return 0;const{sql:t}=r();return(await t`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()} AND id = ANY(${[...e]})
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}async function we(e){const{sql:t}=r();return(await t`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${o()} AND id = ${e.awaitId}
       AND subscriber_id = ${e.subscriberId}
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length>0}async function Ne(e){const{sql:t}=r(),a=o();return A((await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${a} AND subscriber_id = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at DESC
     LIMIT 100
  `).map(_),{workspaceId:a})}async function fe(e){const{sql:t}=r();return(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${o()} AND event_key LIKE ${e+"%"}
       AND fired_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at ASC
     LIMIT 200
  `).map(_)}async function pe(e){const t=[...new Set(e.filter(s=>!!s))];if(t.length===0)return[];const{sql:a}=r(),n=o();return A((await a`
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
  `).map(s=>({subscriberId:s.subscriber_id,eventKey:s.event_key,note:s.note??null,expiresTs:s.expires_ts?new Date(s.expires_ts).toISOString():null,createdAt:new Date(s.created_at).toISOString(),rootId:s.root_id!=null?Number(s.root_id):null})),{workspaceId:n,dropExpired:!0})}async function Ae(e,t=5){const a=o();return A((await h(n=>n`
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
  `)).map(n=>({eventKey:n.event_key,expiresTs:n.expires_ts?new Date(n.expires_ts).toISOString():null,rootId:n.root_id!=null?Number(n.root_id):null})),{workspaceId:a,dropExpired:!0})}async function ye(e){const t=o();return(await h(a=>a`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${t} AND event_key = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL
       AND policy <> 'announce'
     ORDER BY created_at ASC
  `)).map(_)}async function De(e){const t=[...new Set(e.filter(i=>i.length>0))],a=new Map;if(t.length===0)return a;for(const i of t)a.set(i,0);const{sql:n}=r(),s=await n`
    SELECT p.prefix AS prefix, count(a.id)::int AS n
      FROM unnest(${t}::text[]) AS p(prefix)
      LEFT JOIN harness_shared.event_awaits a
        ON a.workspace_id = ${o()}
       AND a.event_key LIKE p.prefix || '%'
       AND a.fired_at IS NULL AND a.cancelled_at IS NULL
       AND a.policy <> 'announce'
     GROUP BY p.prefix
  `;for(const i of s)a.set(i.prefix,Number(i.n)||0);return a}async function Se(e){const{sql:t}=r(),a=o(),n=await t`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = ${e.reason??"event"}
     WHERE workspace_id = ${a} AND event_key = ${e.eventKey}
       AND once = true AND fired_at IS NULL AND cancelled_at IS NULL
       AND payload_filter IS NULL
       AND policy <> 'announce'
    RETURNING *
  `,s=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${a} AND event_key = ${e.eventKey}
       AND once = true AND fired_at IS NULL AND cancelled_at IS NULL
       AND payload_filter IS NOT NULL
       AND policy <> 'announce'
  `).filter(l=>p(u(l.payload_filter),e.payload)).map(l=>Number(l.id)),i=s.length>0?await t`
          UPDATE harness_shared.event_awaits
             SET fired_at = now(), fired_reason = ${e.reason??"event"}
           WHERE id = ANY(${s})
             AND fired_at IS NULL AND cancelled_at IS NULL
          RETURNING *
        `:[],c=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${a} AND event_key = ${e.eventKey}
       AND once = false AND cancelled_at IS NULL
       AND (expires_ts IS NULL OR expires_ts > now())
       AND policy <> 'announce'
  `).filter(l=>p(u(l.payload_filter),e.payload)),d=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${a}
       AND event_key LIKE '%*%'
       AND fired_at IS NULL AND cancelled_at IS NULL
       AND (once = true OR expires_ts IS NULL OR expires_ts > now())
       AND policy <> 'announce'
  `).filter(l=>typeof l.event_key=="string"&&v(l.event_key,e.eventKey)&&p(u(l.payload_filter),e.payload)),E=d.filter(l=>(l.once??!0)===!0).map(l=>Number(l.id)),N=d.filter(l=>(l.once??!0)===!1),w=E.length>0?await t`
          UPDATE harness_shared.event_awaits
             SET fired_at = now(), fired_reason = ${e.reason??"event"}
           WHERE id = ANY(${E})
             AND fired_at IS NULL AND cancelled_at IS NULL
          RETURNING *
        `:[];return[...n,...i,...c,...w,...N].map(_)}async function he(e,t="event"){if(e.length===0)return[];const{sql:a}=r();return(await a`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = ${t}
     WHERE workspace_id = ${o()} AND id = ANY(${e})
       AND once = true AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING *
  `).map(_)}async function ve(e){if(e.awaits.length===0)return 0;const{sql:t}=r(),a=o(),n=e.payload===void 0?null:JSON.stringify(e.payload);let s=0;for(const i of e.awaits){const c=(e.urgent??!1)||i.urgency;await t`
      INSERT INTO harness_shared.event_wake_deliveries
        (workspace_id, await_id, subscriber_id, event_key, payload, summary, urgent, min_sleep_sec, source)
      VALUES (${a}, ${i.id}, ${i.subscriberId}, ${i.eventKey}, ${n}::text::jsonb,
              ${e.summary??null}, ${c}, ${i.minSleepSec??null}, ${e.source??null})
    `,s++}return s}async function Le(e){const{sql:t}=r();return(await t`
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
  `).map(J)}async function ke(e,t,a=1){const{sql:n}=r();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = ${t}, delivered_at = now(), last_error = NULL,
           coalesced_count = ${a}
     WHERE id = ${e}
  `}async function Ie(e,t){if(e.length===0)return;const{sql:a}=r();await a`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = 'coalesced', delivered_at = now(),
           last_error = ${`coalesced into wake #${t}`}
     WHERE id = ANY(${e})
  `}async function me(e){const t=new Map;if(e.length===0)return t;const{sql:a}=r(),n=await a`
    SELECT subscriber_id, max(delivered_at) AS last_woken_at
      FROM harness_shared.event_wake_deliveries
     WHERE workspace_id = ${o()}
       AND subscriber_id = ANY(${e})
       AND status = 'delivered'
       AND channel = ANY(${L})
       AND delivered_at IS NOT NULL
     GROUP BY subscriber_id
  `;for(const s of n)s.last_woken_at&&t.set(s.subscriber_id,new Date(s.last_woken_at).getTime());return t}async function Re(e,t,a){const{sql:n}=r();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'parked', last_error = ${t},
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(a/1e3)})
     WHERE id = ${e}
  `}async function $e(e,t){const{sql:a}=r();await a`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'dropped', last_error = ${t}
     WHERE id = ${e}
  `}async function Te(e){const{sql:t}=r();return e.attempts>=e.maxAttempts?(await t`
      UPDATE harness_shared.event_wake_deliveries
         SET status = 'dead', last_error = ${e.error}
       WHERE id = ${e.id}
    `,"dead"):(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending', last_error = ${e.error},
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(e.backoffMs/1e3)})
     WHERE id = ${e.id}
  `,"retrying")}async function be(e){const{sql:t}=r(),a=(await t`
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
  `)[0]?.status;return a==="dead"?"dead":a==="pending"?"retrying":"ignored"}async function ge(e,t){const{sql:a}=r();await a`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending', attempts = greatest(attempts - 1, 0),
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(t/1e3)})
     WHERE id = ${e}
  `}async function Ue(e){const{sql:t}=r();return(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending'
     WHERE workspace_id = ${o()} AND status = 'delivering'
       AND next_attempt_at < now() - make_interval(secs => ${Math.ceil(e.olderThanMs/1e3)})
    RETURNING id
  `).length}async function Oe(){const{sql:e}=r();return(await e`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'timeout'
     WHERE workspace_id = ${o()} AND timeout_behavior = 'wake'
       AND expires_ts IS NOT NULL AND expires_ts <= now()
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING *
  `).map(_)}async function xe(){const{sql:e}=r();return(await e`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'expired'
     WHERE workspace_id = ${o()} AND timeout_behavior = 'expire'
       AND expires_ts IS NOT NULL AND expires_ts <= now()
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}async function Ce(e){const{sql:t}=r();return(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = COALESCE(channel, 'inbox'), delivered_at = now(),
           last_error = 'acked by subscriber while awake'
     WHERE id = ${e.deliveryId} AND subscriber_id = ${e.subscriberId}
       AND status IN ('pending', 'parked', 'delivering')
    RETURNING id
  `).length>0}async function Me(e){const{sql:t}=r(),a=o(),n=`${I}${e.subscriberId}`;return(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = 'coalesced', delivered_at = now(),
           last_error = 'caught up at turn-end cursor settle — already seen in a bulk coord:inbox read (EI-9389)'
     WHERE workspace_id = ${a} AND subscriber_id = ${e.subscriberId}
       AND event_key = ${n}
       AND status IN ('pending', 'parked')
       AND created_at <= ${e.cutoffTs}
    RETURNING id
  `).length}async function We(e,t=10){const{sql:a}=r();return(await a`
    SELECT * FROM harness_shared.event_wake_deliveries
     WHERE subscriber_id = ${e}
     ORDER BY created_at DESC
     LIMIT ${t}
  `).map(y)}async function He(e={}){const{sql:t}=r();return(await t`
    SELECT subscriber_id, status, channel, count(*)::int AS count
      FROM harness_shared.event_wake_deliveries
     WHERE workspace_id = ${o()}
       AND created_at > now() - make_interval(hours => ${e.sinceHours??24})
     GROUP BY subscriber_id, status, channel
     ORDER BY count DESC
     LIMIT 50
  `).map(a=>({subscriberId:a.subscriber_id,status:a.status,channel:a.channel??null,count:Number(a.count)}))}async function Fe(e){const{sql:t}=r(),a=o(),n=e.expiresSec!=null?new Date(Date.now()+e.expiresSec*1e3).toISOString():null;return t.begin(async s=>{await s`SELECT pg_advisory_xact_lock(hashtextextended(${"event-announce:"+e.eventKey}, 0))`;const i=await s`
      SELECT COALESCE(MAX(causal_generation), 0)::bigint + 1 AS next_generation
        FROM harness_shared.event_awaits
       WHERE workspace_id = ${a} AND policy = 'announce' AND event_key = ${e.eventKey}
    `,c=Number(i[0]?.next_generation??1);return await s`
      UPDATE harness_shared.event_awaits
         SET superseded_at = COALESCE(superseded_at, now())
       WHERE workspace_id = ${a} AND policy = 'announce' AND event_key = ${e.eventKey}
         AND superseded_at IS NULL
    `,_((await s`
      INSERT INTO harness_shared.event_awaits
        (workspace_id, subscriber_id, event_key, policy, note, wake_handle, timeout_behavior, expires_ts,
         once, min_sleep_sec, urgency, payload_filter, scope_kind, scope_ref, causal_generation,
         expected_condition)
      VALUES
        (${a}, ${e.subscriberId}, ${e.eventKey}, 'announce', ${e.note??null}, NULL,
         'expire', ${n}, false, NULL, false, NULL, ${e.scopeKind}, ${e.scopeRef??null},
         ${c}, ${e.expectedCondition!=null?JSON.stringify(e.expectedCondition):null}::text::jsonb)
      RETURNING *
    `)[0])})}async function Pe(e){const{sql:t}=r();return(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${o()} AND policy = 'announce' AND event_key = ${e}
       AND cancelled_at IS NULL AND superseded_at IS NULL
     ORDER BY causal_generation DESC NULLS LAST, created_at DESC
     LIMIT 1
  `).map(_)}async function Ke(e,t){const a=D(e);if(!a)return[];const{sql:n}=r(),s=await n`
    SELECT event_key, policy, subscriber_id FROM harness_shared.event_awaits
     WHERE workspace_id = ${o()} AND cancelled_at IS NULL AND fired_at IS NULL
       AND event_key <> ${e}
       AND position('*' in event_key) = 0
     ORDER BY created_at DESC
     LIMIT 200
  `,i=new Map;for(const c of s){const d=String(c.event_key),E=String(c.subscriber_id);if(t?.excludeOwner&&E===t.excludeOwner||D(d)!==a)continue;const N=String(c.policy)==="announce"?"announce":"await",w=i.get(d);w?(w.holders.add(E),N==="announce"&&(w.kind="announce")):i.set(d,{kind:N,holders:new Set([E])})}return[...i.entries()].slice(0,5).map(([c,d])=>({eventKey:c,kind:d.kind,holders:d.holders.size}))}async function qe(e,t={}){const{sql:a}=r(),n=o();return(await a`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'event', fired_by = ${t.firedBy??null},
           fired_payload = ${t.payload!==void 0?JSON.stringify(t.payload):null}::text::jsonb
     WHERE workspace_id = ${n} AND policy = 'announce' AND event_key = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL
    RETURNING id
  `).length}async function Be(e={}){const{sql:t}=r();return(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${o()} AND policy = 'announce'
       AND cancelled_at IS NULL AND superseded_at IS NULL
       AND (expires_ts IS NULL OR expires_ts > now())
       AND (${e.unfiredOnly===!1} OR fired_at IS NULL)
     ORDER BY created_at DESC
     LIMIT ${Math.min(e.limit??100,200)}
  `).map(_)}function k(e){return{workspaceId:e.workspace_id,eventKey:e.event_key,firstFiredAt:e.first_fired_at,lastFiredAt:e.last_fired_at,lastFiredBy:e.last_fired_by??null,lastPayload:e.last_payload??null,fireCount:Number(e.fire_count)||0}}async function Ye(e){const{sql:t}=r();await t`
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
  `}async function Ge(e){const{sql:t}=r(),a=await t`
    SELECT * FROM harness_shared.event_key_fires
     WHERE workspace_id = ${o()} AND event_key = ${e}
     LIMIT 1
  `;return a.length>0?k(a[0]):null}function X(e){const t=String(e??"").trim().split(":");return t.length<=2?t.join(":"):t.slice(0,2).join(":")}async function je(e){const{sql:t}=r(),a=o(),n=String(e??"").trim(),s=X(n),i={prefix:s,exact:!1,distinctKeys:0,fires:0,lastFiredAt:null};if(!s)return i;const c=(await t`
    SELECT count(*)::int                                             AS distinct_keys,
           coalesce(sum(fire_count), 0)::bigint                      AS fires,
           max(last_fired_at)                                        AS last_fired_at,
           bool_or(event_key = ${n})                               AS exact
      FROM harness_shared.event_key_fires
     WHERE workspace_id = ${a}
       AND (event_key = ${s} OR event_key LIKE ${`${s.replace(/([\\%_])/g,"\\$1")}:%`} ESCAPE '\\')
  `)[0];return c?{prefix:s,exact:c.exact===!0,distinctKeys:Number(c.distinct_keys)||0,fires:Number(c.fires)||0,lastFiredAt:c.last_fired_at?String(c.last_fired_at):null}:i}async function Je(e,t){const{sql:a}=r(),n=o(),s=String(e??"").trim(),i=Math.max(1,Math.min(500,t?.limit??200)),c=W(s),d={prefix:c,matchedKeys:[],truncated:!1};if(!s.includes("*"))return d;const E=c?await a`
        SELECT event_key
          FROM harness_shared.event_key_fires
         WHERE workspace_id = ${n}
           AND (event_key = ${c} OR event_key LIKE ${`${c.replace(/([\\%_])/g,"\\$1")}:%`} ESCAPE '\\')
         ORDER BY last_fired_at DESC
         LIMIT ${i}
      `:await a`
        SELECT event_key
          FROM harness_shared.event_key_fires
         WHERE workspace_id = ${n}
         ORDER BY last_fired_at DESC
         LIMIT ${i}
      `,N=[];for(const w of E){const l=typeof w?.event_key=="string"?w.event_key:null;l&&v(s,l)&&N.push(l)}return{prefix:c,matchedKeys:N,truncated:E.length>=i}}async function Xe(e){const{sql:t}=r(),a=o();return t.begin(async n=>{const s=await n`
      SELECT * FROM harness_shared.event_awaits
       WHERE workspace_id = ${a} AND event_key = ${e} AND policy = 'announce'
       ORDER BY causal_generation DESC NULLS LAST, created_at DESC
       LIMIT 50
    `,i=await n`
      SELECT * FROM harness_shared.event_awaits
       WHERE workspace_id = ${a} AND event_key = ${e} AND policy <> 'announce'
       ORDER BY created_at DESC
       LIMIT 200
    `,c=await n`
      SELECT * FROM harness_shared.event_wake_deliveries
       WHERE workspace_id = ${a} AND event_key = ${e}
       ORDER BY created_at DESC
       LIMIT 200
    `,d=await n`
      SELECT * FROM harness_shared.event_key_fires
       WHERE workspace_id = ${a} AND event_key = ${e}
       LIMIT 1
    `;return{announcements:s.map(_),waiters:i.map(_),deliveries:c.map(y),fireLatch:d.length>0?k(d[0]):null}})}var o,I,Ve=f((()=>{S(),U(),b(),O(),H(),K(),j(),o=()=>g,I="coord:inbox-wake:"}));export{v as $,ge as A,ce as B,Ne as C,We as D,pe as E,je as F,He as G,Me as H,Je as I,K as J,F as K,Ye as L,$e as M,Te as N,Ae as O,Re as P,ie as Q,Ue as R,Be as S,ye as T,qe as U,be as V,le as W,x as X,oe as Y,H as Z,Ve as _,ue as a,X as b,Le as c,xe as d,p as et,Pe as f,Ge as g,Oe as h,Ee as i,ke as j,Ie as k,he as l,Se as m,Ce as n,_e as o,Ke as p,P as q,we as r,de as s,I as t,De as u,ve as v,fe as w,me as x,Xe as y,Fe as z};
