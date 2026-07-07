import{n as e}from"./chunk-CMxvf4Kt.js";import{c as t,t as n}from"./src-CFOeSMcp2.js";import{q as r,t as i}from"./src-DTtGQmae.js";import{n as a,t as o}from"./event-log-DlTwD7ps.js";function s(e){if(!e.startsWith(`@`))return e;let t=/^@plan:(.+)$/.exec(e);if(t)return`plan-item:done:${t[1]}:*`;let n=/^@fleet:(.+)$/.exec(e);if(n)return`fleet:*:${n[1]}`;throw Error(`events:await — unknown pattern macro '${e}'. Known macros: @plan:<slug>, @fleet:<slug>. Or pass a raw glob, e.g. 'work-item:done:*'.`)}function c(e){return e.replace(/[.+?^${}()|[\]\\]/g,`\\$&`)}function l(e){return{matches:`^`+c(e).replace(/\*/g,`.*`)+`$`}}function u(e,n){let r=s(e);return r.includes(`*`)?t(l(r),n):r===n}var d=e((()=>{n()})),f,p=e((()=>{f=[`pty-inject`,`psu-socket-inject`,`psu-socket-reset`,`psu-socket-recycle`,`resume`,`resume-headless`,`hive-fresh-wake`,`plan-run-resume`]}));function m(e){if(e==null)return null;if(typeof e==`string`)try{return JSON.parse(e)}catch{return null}return e}function h(e){return{id:Number(e.id),workspaceId:e.workspace_id,subscriberId:e.subscriber_id,eventKey:e.event_key,policy:e.policy,note:e.note??null,wakeHandle:m(e.wake_handle),timeoutBehavior:e.timeout_behavior,expiresTs:e.expires_ts?new Date(e.expires_ts).toISOString():null,createdAt:new Date(e.created_at).toISOString(),firedAt:e.fired_at?new Date(e.fired_at).toISOString():null,firedReason:e.fired_reason??null,cancelledAt:e.cancelled_at?new Date(e.cancelled_at).toISOString():null,once:e.once??!0,minSleepSec:e.min_sleep_sec==null?null:Number(e.min_sleep_sec),urgency:e.urgency??!1}}function g(e){return{id:Number(e.id),workspaceId:e.workspace_id,awaitId:Number(e.await_id),subscriberId:e.subscriber_id,eventKey:e.event_key,payload:m(e.payload),summary:e.summary??null,status:e.status,channel:e.channel??null,attempts:Number(e.attempts),lastError:e.last_error??null,nextAttemptAt:new Date(e.next_attempt_at).toISOString(),createdAt:new Date(e.created_at).toISOString(),deliveredAt:e.delivered_at?new Date(e.delivered_at).toISOString():null,urgent:e.urgent??!1,minSleepSec:e.min_sleep_sec==null?null:Number(e.min_sleep_sec),coalescedCount:e.coalesced_count==null?1:Number(e.coalesced_count),source:e.source??null}}function _(e){return{...g(e),wakeHandle:m(e.wake_handle),note:e.await_note??null}}async function v(e,t){let{sql:n}=r();return(await n`
    UPDATE harness_shared.event_awaits
       SET cancelled_at = now()
     WHERE workspace_id = ${P(t)} AND subscriber_id = ${e}
       AND policy = 'wake' AND once = false AND fired_at IS NULL AND cancelled_at IS NULL
       AND event_key LIKE 'coord:inbox-wake:%'
    RETURNING id
  `).length}async function y(e,t){let{sql:n}=r();return(await n`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${P(t)} AND subscriber_id = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at DESC
     LIMIT 100
  `).map(h)}async function b(e,t){let{sql:n}=r();return(await n`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${P(t)} AND event_key = ${e}
       AND fired_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at ASC
  `).map(h)}async function x(e){let{sql:t}=r(),n=P(e.workspaceId),i=await t`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = ${e.reason??`event`}
     WHERE workspace_id = ${n} AND event_key = ${e.eventKey}
       AND once = true AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING *
  `,a=await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${n} AND event_key = ${e.eventKey}
       AND once = false AND cancelled_at IS NULL
       AND (expires_ts IS NULL OR expires_ts > now())
  `,o=(await t`
    SELECT * FROM harness_shared.event_awaits
     WHERE workspace_id = ${n}
       AND event_key LIKE '%*%'
       AND fired_at IS NULL AND cancelled_at IS NULL
       AND (once = true OR expires_ts IS NULL OR expires_ts > now())
  `).filter(t=>u(t.event_key,e.eventKey)),s=o.filter(e=>(e.once??!0)===!0).map(e=>Number(e.id)),c=o.filter(e=>(e.once??!0)===!1),l=s.length>0?await t`
          UPDATE harness_shared.event_awaits
             SET fired_at = now(), fired_reason = ${e.reason??`event`}
           WHERE id = ANY(${s})
             AND fired_at IS NULL AND cancelled_at IS NULL
          RETURNING *
        `:[];return[...i,...a,...l,...c].map(h)}async function S(e){if(e.awaits.length===0)return 0;let{sql:t}=r(),n=P(e.workspaceId),i=e.payload===void 0?null:JSON.stringify(e.payload),a=0;for(let r of e.awaits){let o=(e.urgent??!1)||r.urgency;await t`
      INSERT INTO harness_shared.event_wake_deliveries
        (workspace_id, await_id, subscriber_id, event_key, payload, summary, urgent, min_sleep_sec, source)
      VALUES (${n}, ${r.id}, ${r.subscriberId}, ${r.eventKey}, ${i}::text::jsonb,
              ${e.summary??null}, ${o}, ${r.minSleepSec??null}, ${e.source??null})
    `,a++}return a}async function C(e){let{sql:t}=r();return(await t`
    WITH due AS (
      SELECT id FROM harness_shared.event_wake_deliveries
       WHERE workspace_id = ${P(e.workspaceId)}
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
  `).map(_)}async function w(e,t,n=1){let{sql:i}=r();await i`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = ${t}, delivered_at = now(), last_error = NULL,
           coalesced_count = ${n}
     WHERE id = ${e}
  `}async function T(e,t){if(e.length===0)return;let{sql:n}=r();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'delivered', channel = 'coalesced', delivered_at = now(),
           last_error = ${`coalesced into wake #${t}`}
     WHERE id = ANY(${e})
  `}async function E(e,t){let n=new Map;if(e.length===0)return n;let{sql:i}=r(),a=await i`
    SELECT subscriber_id, max(delivered_at) AS last_woken_at
      FROM harness_shared.event_wake_deliveries
     WHERE workspace_id = ${P(t)}
       AND subscriber_id = ANY(${e})
       AND status = 'delivered'
       AND channel = ANY(${f})
       AND delivered_at IS NOT NULL
     GROUP BY subscriber_id
  `;for(let e of a)e.last_woken_at&&n.set(e.subscriber_id,new Date(e.last_woken_at).getTime());return n}async function D(e,t,n){let{sql:i}=r();await i`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'parked', last_error = ${t},
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(n/1e3)})
     WHERE id = ${e}
  `}async function O(e,t){let{sql:n}=r();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'dropped', last_error = ${t}
     WHERE id = ${e}
  `}async function k(e){let{sql:t}=r();return e.attempts>=e.maxAttempts?(await t`
      UPDATE harness_shared.event_wake_deliveries
         SET status = 'dead', last_error = ${e.error}
       WHERE id = ${e.id}
    `,`dead`):(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending', last_error = ${e.error},
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(e.backoffMs/1e3)})
     WHERE id = ${e.id}
  `,`retrying`)}async function A(e,t){let{sql:n}=r();await n`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending', attempts = greatest(attempts - 1, 0),
           next_attempt_at = now() + make_interval(secs => ${Math.ceil(t/1e3)})
     WHERE id = ${e}
  `}async function j(e){let{sql:t}=r();return(await t`
    UPDATE harness_shared.event_wake_deliveries
       SET status = 'pending'
     WHERE workspace_id = ${P(e.workspaceId)} AND status = 'delivering'
       AND next_attempt_at < now() - make_interval(secs => ${Math.ceil(e.olderThanMs/1e3)})
    RETURNING id
  `).length}async function M(e){let{sql:t}=r();return(await t`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'timeout'
     WHERE workspace_id = ${P(e)} AND timeout_behavior = 'wake'
       AND expires_ts IS NOT NULL AND expires_ts <= now()
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING *
  `).map(h)}async function N(e){let{sql:t}=r();return(await t`
    UPDATE harness_shared.event_awaits
       SET fired_at = now(), fired_reason = 'expired'
     WHERE workspace_id = ${P(e)} AND timeout_behavior = 'expire'
       AND expires_ts IS NOT NULL AND expires_ts <= now()
       AND fired_at IS NULL AND cancelled_at IS NULL
    RETURNING id
  `).length}var P,F=e((()=>{i(),o(),d(),p(),P=e=>a}));export{j as _,M as a,E as c,T as d,A as f,D as g,k as h,x as i,y as l,O as m,C as n,F as o,w as p,N as r,S as s,v as t,b as u};