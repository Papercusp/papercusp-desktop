import{n as e}from"./chunk-CMxvf4Kt.js";import{l as t,o as n,t as r,u as i}from"./src-Cb6BZxhR2.js";import{q as a,t as o}from"./src-C8OEUO3c.js";import{n as s,t as c}from"./event-log-DlTwD7ps.js";function l(e){if(typeof e!=`string`||!e.startsWith(`@`))return e;let t=/^@plan:(.+)$/.exec(e);if(t)return`plan-item:done:${t[1]}:*`;let n=/^@fleet:(.+)$/.exec(e);if(n)return`fleet:*:${n[1]}`;throw Error(`events:await — unknown pattern macro '${e}'. Known macros: @plan:<slug>, @fleet:<slug>. Or pass a raw glob, e.g. 'work-item:done:*'.`)}function u(e){return e.replace(/[.+?^${}()|[\]\\]/g,`\\$&`)}function d(e){return{matches:`^`+u(e).replace(/\*/g,`.*`)+`$`}}function f(e,t){if(typeof e!=`string`)return!1;let n=l(e);return n.includes(`*`)?i(d(n),t):n===t}function p(e,r){if(e==null)return!0;if(!t(e))return!1;try{return n(e,r)}catch{return!1}}var m=e((()=>{r()})),h,g=e((()=>{h=[`pty-inject`,`psu-socket-inject`,`psu-socket-reset`,`psu-socket-recycle`,`resume`,`resume-headless`,`hive-fresh-wake`,`plan-run-resume`]}));function _(e){if(e==null)return null;if(typeof e==`string`)try{return JSON.parse(e)}catch{return null}return e}function v(e){return{id:Number(e.id),workspaceId:e.workspace_id,subscriberId:e.subscriber_id,eventKey:e.event_key,policy:e.policy,note:e.note??null,wakeHandle:_(e.wake_handle),timeoutBehavior:e.timeout_behavior,expiresTs:e.expires_ts?new Date(e.expires_ts).toISOString():null,createdAt:new Date(e.created_at).toISOString(),firedAt:e.fired_at?new Date(e.fired_at).toISOString():null,firedReason:e.fired_reason??null,cancelledAt:e.cancelled_at?new Date(e.cancelled_at).toISOString():null,once:e.once??!0,minSleepSec:e.min_sleep_sec==null?null:Number(e.min_sleep_sec),urgency:e.urgency??!1,payloadFilter:_(e.payload_filter)}}function y(e){return{id:Number(e.id),workspaceId:e.workspace_id,awaitId:Number(e.await_id),subscriberId:e.subscriber_id,eventKey:e.event_key,payload:_(e.payload),summary:e.summary??null,status:e.status,channel:e.channel??null,attempts:Number(e.attempts),lastError:e.last_error??null,nextAttemptAt:new Date(e.next_attempt_at).toISOString(),createdAt:new Date(e.created_at).toISOString(),deliveredAt:e.delivered_at?new Date(e.delivered_at).toISOString():null,urgent:e.urgent??!1,minSleepSec:e.min_sleep_sec==null?null:Number(e.min_sleep_sec),coalescedCount:e.coalesced_count==null?1:Number(e.coalesced_count),source:e.source??null}}function b(e){return{...y(e),wakeHandle:_(e.wake_handle),note:e.await_note??null}}async function x(e){let{sql:t}=a();return(await t`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${R()} AND subscriber_id = ${e}
       AND policy = 'wake' AND once = false AND fired_at IS NULL AND cancelled_at IS NULL
       AND event_key LIKE 'coord:inbox-wake:%'
    RETURNING id
  `).length}async function S(e){let{sql:t}=a();return(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${R()} AND subscriber_id = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at DESC
     LIMIT 100
  `).map(v)}async function C(e){let t=[...new Set(e.filter(e=>!!e))];if(t.length===0)return[];let{sql:n}=a();return(await n`
    SELECT subscriber_id, event_key, note, expires_ts, created_at
      FROM harness_shared.event_awaits
     WHERE workspace_id = ${R()}
       AND subscriber_id = ANY(${t}::text[])
       AND fired_at IS NULL AND cancelled_at IS NULL
       AND event_key NOT LIKE ${`coord:inbox-wake:%`}
       AND (expires_ts IS NULL OR expires_ts > now())
     ORDER BY created_at DESC
     LIMIT 500
  `).map(e=>({subscriberId:e.subscriber_id,eventKey:e.event_key,note:e.note??null,expiresTs:e.expires_ts?new Date(e.expires_ts).toISOString():null,createdAt:new Date(e.created_at).toISOString()}))}async function w(e){let{sql:t}=a();return(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${R()} AND event_key = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at ASC
  `).map(v)}async function T(e){let{sql:t}=a(),n=R(),r=await t`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = ${e.reason??`event`}
     WHERE workspace_id = ${n} AND event_key = ${e.eventKey}
       AND once = true AND fired_at IS NULL AND cancelled_at IS NULL
       AND payload_filter IS NULL
    RETURNING *
  `,i=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${n} AND event_key = ${e.eventKey}
       AND once = true AND fired_at IS NULL AND cancelled_at IS NULL
       AND payload_filter IS NOT NULL
  `).filter(t=>p(_(t.payload_filter),e.payload)).map(e=>Number(e.id)),o=i.length>0?await t`
          UPDATE harness_shared.event_awaits
             SET fired_at = now(), fired_reason = ${e.reason??`event`}
           WHERE id = ANY(${i})
             AND fired_at IS NULL AND cancelled_at IS NULL
          RETURNING *
        `:[],s=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${n} AND event_key = ${e.eventKey}
       AND once = false AND cancelled_at IS NULL
       AND (expires_ts IS NULL OR expires_ts > now())
  `).filter(t=>p(_(t.payload_filter),e.payload)),c=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${n}
       AND event_key LIKE '%*%'
       AND fired_at IS NULL AND cancelled_at IS NULL
       AND (once = true OR expires_ts IS NULL OR expires_ts > now())
  `).filter(t=>typeof t.event_key==`string`&&f(t.event_key,e.eventKey)&&p(_(t.payload_filter),e.payload)),l=c.filter(e=>(e.once??!0)===!0).map(e=>Number(e.id)),u=c.filter(e=>(e.once??!0)===!1),d=l.length>0?await t`
          UPDATE harness_shared.event_awaits
             SET fired_at = now(), fired_reason = ${e.reason??`event`}
           WHERE id = ANY(${l})
             AND fired_at IS NULL AND cancelled_at IS NULL
          RETURNING *
        `:[];return[...r,...o,...s,...d,...u].map(v)}async function E(e){if(e.awaits.length===0)return 0;let{sql:t}=a(),n=R(),r=e.payload===void 0?null:JSON.stringify(e.payload),i=0;for(let a of e.awaits){let o=(e.urgent??!1)||a.urgency;await t`
      INSERT INTO harness_shared.event_wake_deliveries
        (workspace_id, await_id, subscriber_id, event_key, payload, summary, urgent, min_sleep_sec, source)
      VALUES (${n}, ${a.id}, ${a.subscriberId}, ${a.eventKey}, ${r}::text::jsonb,
              ${e.summary??null}, ${o}, ${a.minSleepSec??null}, ${e.source??null})
    `,i++}return i}async function D(e){let{sql:t}=a();return(await t`
    WITH due AS (
      SELECT id FROM harness_shared.event_wake_deliveries
       WHERE workspace_id = ${R()}
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
  `).map(b)}async function O(e,t,n=1){let{sql:r}=a();await r`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = ${t}, delivered_at = now(), last_error = NULL,
           coalesced_count = ${n}
     WHERE id = ${e}
  `}async function k(e,t){if(e.length===0)return;let{sql:n}=a();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = 'coalesced', delivered_at = now(),
           last_error = ${`coalesced into wake #${t}`}
     WHERE id = ANY(${e})
  `}async function A(e){let t=new Map;if(e.length===0)return t;let{sql:n}=a(),r=await n`
    SELECT subscriber_id, max(delivered_at) AS last_woken_at
      FROM harness_shared.event_wake_deliveries
     WHERE workspace_id = ${R()}
       AND subscriber_id = ANY(${e})
       AND status = 'delivered'
       AND channel = ANY(${h})
       AND delivered_at IS NOT NULL
     GROUP BY subscriber_id
  `;for(let e of r)e.last_woken_at&&t.set(e.subscriber_id,new Date(e.last_woken_at).getTime());return t}async function j(e,t,n){let{sql:r}=a();await r`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'parked', last_error = ${t},
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(n/1e3)})
     WHERE id = ${e}
  `}async function M(e,t){let{sql:n}=a();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'dropped', last_error = ${t}
     WHERE id = ${e}
  `}async function N(e){let{sql:t}=a();return e.attempts>=e.maxAttempts?(await t`
      UPDATE harness_shared.event_wake_deliveries
         SET status = 'dead', last_error = ${e.error}
       WHERE id = ${e.id}
    `,`dead`):(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending', last_error = ${e.error},
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(e.backoffMs/1e3)})
     WHERE id = ${e.id}
  `,`retrying`)}async function P(e,t){let{sql:n}=a();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending', attempts = greatest(attempts - 1, 0),
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(t/1e3)})
     WHERE id = ${e}
  `}async function F(e){let{sql:t}=a();return(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending'
     WHERE workspace_id = ${R()} AND status = 'delivering'
       AND next_attempt_at < now() - make_interval(secs => ${Math.ceil(e.olderThanMs/1e3)})
    RETURNING id
  `).length}async function I(){let{sql:e}=a();return(await e`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'timeout'
     WHERE workspace_id = ${R()} AND timeout_behavior = 'wake'
       AND expires_ts IS NOT NULL AND expires_ts <= now()
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING *
  `).map(v)}async function L(){let{sql:e}=a();return(await e`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'expired'
     WHERE workspace_id = ${R()} AND timeout_behavior = 'expire'
       AND expires_ts IS NOT NULL AND expires_ts <= now()
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}var R,z=e((()=>{o(),c(),m(),g(),R=()=>s}));export{j as _,I as a,A as c,C as d,k as f,N as g,M as h,T as i,S as l,O as m,D as n,z as o,P as p,L as r,E as s,x as t,w as u,F as v};