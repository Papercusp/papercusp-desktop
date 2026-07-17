import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CwW4br4q.js";import{s as r}from"./workspace-registry-Bu1Yy540.js";import{n as i,o as a}from"./adv-sessions-B7zhvQwB.js";import{n as o}from"./cron-wBe2AScZ.js";function s(e){let t=e.capCents;return t==null||!Number.isFinite(t)||t<=0?{breach:!1}:{breach:e.spendCents>t}}async function c(e){try{let n=e.sql??t().sql,r=(await i()).get(e.targetOwnerId)?.sessionId;if(!r)return 0;let a=(await n`
      SELECT COALESCE(SUM(cost_usd), 0)::float8 AS usd
        FROM harness_shared.agent_usage_samples
       WHERE session_id = ${r}
         AND ts >= ${e.sinceMs}
    `)[0]?.usd??0;return Math.max(0,Math.round(a*100))}catch{return 0}}async function l(e,t,n){await e`
    UPDATE harness_shared.routines
       SET active = FALSE,
           next_fire_at = NULL,
           metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('loop_paused_reason', ${n}::text, 'loop_paused_at', now()::text),
           updated_at = now()
     WHERE id = ${t}
  `}async function u(e,n={}){let r=e.capCents;if(r==null||!Number.isFinite(r)||r<=0)return{breach:!1,spendCents:0,capCents:null};let i=e.sql??t().sql,a=n.readSpend??c,o=n.autoPause??l,u=await i`
    SELECT (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS armed_ms
      FROM harness_shared.routines
     WHERE id = ${e.routineId}
  `,d=Number(u[0]?.armed_ms??0),f=await a({sql:i,targetOwnerId:e.targetOwnerId,sinceMs:d}),{breach:p}=s({spendCents:f,capCents:r});return p&&await o(i,e.routineId,`cost-cap breached: ${f}¢ > ${r}¢ (cumulative since arm)`),{breach:p,spendCents:f,capCents:r}}var d=e((()=>{n(),a()}));function f(e){let{armedAtMs:t,nowMs:n,fireCount:r,maxFires:i,maxDurationSec:a}=e;return a!=null&&a>0&&n-t>a*1e3?{breach:!0,reason:`max-duration ${Math.round((n-t)/1e3)}s > ${a}s (since arm)`}:i!=null&&i>0&&r>=i?{breach:!0,reason:`max-fires ${r} >= ${i}`}:{breach:!1}}async function p(e,n={}){let r=e.maxFires!=null&&e.maxFires>0,i=e.maxDurationSec!=null&&e.maxDurationSec>0;if(!r&&!i)return{breach:!1};let a=e.sql??t().sql,o=n.autoPause??l,s=e.nowMs??Date.now(),c=await a`
    SELECT (EXTRACT(EPOCH FROM COALESCE((metadata->>'armed_at')::timestamptz, created_at)) * 1000)::bigint AS armed_ms,
           COALESCE((metadata->>'fire_count')::int, 0)    AS fire_count
      FROM harness_shared.routines
     WHERE id = ${e.routineId}`,u=f({armedAtMs:Number(c[0]?.armed_ms??s),nowMs:s,fireCount:Number(c[0]?.fire_count??0),maxFires:e.maxFires,maxDurationSec:e.maxDurationSec});return u.breach&&await o(a,e.routineId,`dead-man guard: ${u.reason}`),u}async function m(e,n){let r=await(e??t().sql)`
    SELECT COALESCE((metadata->>'fire_count')::int, 0) AS fire_count
      FROM harness_shared.routines
     WHERE id = ${n}`;return Number(r[0]?.fire_count??0)}async function h(e,n){await(e??t().sql)`
    UPDATE harness_shared.routines
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('fire_count', COALESCE((metadata->>'fire_count')::int, 0) + 1)
     WHERE id = ${n}`}var g=e((()=>{n(),d()}));function _(e){let t=Math.max(30*6e4,(e.intervalSec??60)*4*1e3);return!e.parked||e.parkedMs==null||e.hasCompletionSinceFire||e.activeSinceFire?{stalled:!1,stalledSinceMs:null}:e.parkedMs>=t?{stalled:!0,stalledSinceMs:e.parkedMs}:{stalled:!1,stalledSinceMs:null}}function v(e,t){let n=e.payload_template??{},r=n?.costCapCents,i=e.reschedule_interval_sec==null?null:Number(e.reschedule_interval_sec),a=!!e.parked,o=e.parked_ms==null?null:Number(e.parked_ms),s=e.last_fired_at?new Date(e.last_fired_at).getTime():null,c=e.lifecycle_completed_at?new Date(e.lifecycle_completed_at).getTime():null,l=e.presence_last_active_at?new Date(e.presence_last_active_at).getTime():null,u=_({parked:a,parkedMs:o,intervalSec:i,hasCompletionSinceFire:c!=null,activeSinceFire:l!=null&&s!=null&&l>s});return{name:e.name,ownerId:e.target_owner_id??t,harnessSlug:e.install_slug,active:e.active,intervalSec:i,carry:n?.carry===`cold`?`cold`:`warm`,continuation:n?.continuation===`gated`?`gated`:`settle`,fireCount:e.fire_count==null?0:Number(e.fire_count),parked:a,nextFireAt:e.next_fire_at?new Date(e.next_fire_at).toISOString():null,lastFiredAt:e.last_fired_at?new Date(e.last_fired_at).toISOString():null,costCapCents:typeof r==`number`?r:null,maxFires:typeof n?.maxFires==`number`?n.maxFires:null,maxDurationSec:typeof n?.maxDurationSec==`number`?n.maxDurationSec:null,stalled:u.stalled,stalledSinceMs:u.stalledSinceMs,lastDeliveryOutcome:e.last_delivery_outcome??null,consecutiveErrors:e.consecutive_errors==null?0:Number(e.consecutive_errors)}}async function y(e,n={}){let r=new Map,i=[...new Set(e.filter(Boolean))];if(i.length===0)return r;let a=await(n.sql??t().sql)`
    SELECT DISTINCT ON (r.target_owner_id)
           r.install_slug,
           r.name,
           r.active,
           r.reschedule_interval_sec,
           r.target_owner_id,
           r.payload_template,
           COALESCE((r.metadata->>'fire_count')::int, 0)                  AS fire_count,
           r.last_fired_at,
           (r.next_fire_at = 'infinity'::timestamptz)                    AS parked,
           CASE WHEN r.next_fire_at = 'infinity'::timestamptz THEN NULL
                ELSE r.next_fire_at END                                  AS next_fire_at,
           CASE WHEN r.last_fired_at IS NULL THEN NULL
                ELSE (EXTRACT(EPOCH FROM (now() - r.last_fired_at)) * 1000)::bigint END AS parked_ms,
           a.last_status         AS last_delivery_outcome,
           a.consecutive_errors  AS consecutive_errors,
           (SELECT max(ag.created_at) FROM harness_shared.agent_activity ag
             WHERE ag.owner_id = r.target_owner_id AND ag.kind = 'lifecycle'
               AND ag.summary ILIKE '%end%' AND ag.created_at > r.last_fired_at) AS lifecycle_completed_at,
           (SELECT max(p.last_active_at) FROM harness_shared.coord_presence p
             WHERE p.owner_id = r.target_owner_id) AS presence_last_active_at
      FROM harness_shared.routines r
      LEFT JOIN harness_shared.autoloop_state a
        ON a.workspace_id = r.workspace_id AND a.harness_slug = r.install_slug AND a.role = r.name
     WHERE r.target_owner_id = ANY(${i}::text[])
       AND r.reschedule_interval_sec IS NOT NULL
     ORDER BY r.target_owner_id, r.active DESC, r.updated_at DESC
  `;for(let e of a){let t=String(e.target_owner_id);r.set(t,v(e,t))}return r}async function b(e,t={}){return(await y([e],t)).get(e)??null}var x=e((()=>{n(),r(),o(),g(),[`🔁 Loop wake (every ~{intervalSec}s after each turn settles). You are continuing your OWN warm session toward: {goal}`,``,`Each wake:`,"1. Decide the next concrete unit(s) of work. If the goal is DONE or there's nothing left to do, call `loop:end` and stop — do not spin on empty wakes. An idle SELF-PULLER (your scheduler:get_next / work_items:claim_next came back empty) parks on events instead of polling: register ONE `events:await { event: \"work-item:claimable\", payload_filter: <your claim spec's view>, timeout_sec: 1800 }`, then `loop:end` — the wake re-invokes you; your pull stays the authoritative claim (re-register on a re-miss).",'2. Work it per your persona\'s "Working as a fleet MEMBER — the member operating loop" contract — create + self-assign the unit atomically, pick `kind` by what it IS, finish with `work_items:complete { completion }` evidence (never a bare "done" assertion). harness:{harness}, assign_to:{ownerId}.',`3. When this iteration's work is done (or you are blocked), END YOUR TURN. The loop re-wakes this same session ~{intervalSec}s after the turn settles.`,``,"To stop: `loop:end`. If you are blocked on something external (a build, another agent, an owner decision), call `loop:end` and say why rather than burning wakes spinning. `loop:status` shows the loop state."].join(`
`),[`🔁 Monitor wake (every ~{intervalSec}s after each turn settles). You are continuing your OWN warm session, MONITORING: {goal}`,``,`Each wake:`,'1. Check the watched state (coord:orient { mode:"monitor" } for a fleet; the relevant status tool otherwise). If the thing you are watching is FINISHED or no longer needs a monitor, call `loop:end` and stop — do not spin on empty wakes.',`2. Act ONLY on deltas: something stalled/failed/blocked → unblock it, re-steer, or escalate. Nothing changed → write a one-line loop:checkpoint and END YOUR TURN — a quiet wake is a SUCCESS, not a license to invent work. Do NOT create work_items for routine checks; only file one when a delta needs real follow-up work.`,`3. END YOUR TURN when this check settles. The loop re-wakes this same session ~{intervalSec}s after the turn settles.`,``,"To stop: `loop:end`. `loop:status` shows the loop state."].join(`
`),[``,`❄️ This is a COLD loop (carry:'cold'): once a carry-note anchor exists, each wake RESETS your context`,`(a periodic RECYCLE) to that note instead of carrying this transcript — so your transcript will NOT persist.`,`Therefore, before you END this turn you MUST write/refresh your carry-note so the next (cold) wake can continue:`,`    loop:checkpoint { did, left, insight, next }   (compressed facts — what you did, what is left, the key`,`    non-obvious insight, and the single next action). This is REQUIRED on a cold loop: with no carry-note the`,`    loop silently stays warm (and grows unbounded); a stale note makes the next wake repeat work.`,`The carry-note is NOT the only thing to persist — it is LOST if your session dies, so also, before ending:`,`  • if you hold a work-item, REFRESH work_items:checkpoint { id, checkpoint } at least as often as the`,`    carry-note — the ITEM checkpoint is INHERITED by a successor/reclaimer when your session dies, while the`,`    loop-note is not; it is your real death-resilience anchor, not a nice-to-have.`,`  • reached a DURABLE conclusion this wake (a confirmed root cause / repro, a decision, a system bug)? You MUST`,`    facts:assert it. ⚠ A work-item COMMENT (or a checkpoint) does NOT satisfy this and is the exact trap to`,`    avoid: a comment is NEVER folded into orient, so the next cold wake and every peer start BLIND to your`,`    conclusion. The reflex "I already wrote it up in a comment" is precisely why conclusions get lost — a fact`,`    is the ONLY write folded VERBATIM into every future orient/brief. Comment too if you want an audit trail,`,`    but the facts:assert is the non-negotiable one; a conclusion left only in a comment/carry-note dies with the loop.`].join(`
`),[``,`🔀 This is a GATED loop (continuation:'gated'): unlike the default one-unit-per-wake cadence, the`,`runtime EXPECTS you to run MULTIPLE units in a single turn — gated per unit by the CONTINUATION GATE.`,`After you SETTLE each unit (live-verified or explicitly deferred-with-reason):`,`  1. FLUSH first — every work-item claim you hold gets a fresh work_items:checkpoint (never carry`,`     unexternalized state across a unit boundary; the P-002 flush gate enforces this).`,"  2. READ THE GATE — loop:checkpoint returns a `continuation` verdict (context headroom < ceiling?",`     any unread inbox / pending owner input?). CONTINUE in this same turn ONLY when the gate is OPEN`,`     AND your next unit is already scoped; otherwise END THE TURN.`,`  3. On any pending owner input, an inbox interrupt, or context past the ceiling — settle now; the`,`     next wake re-opens the gate on fresh context.`,`Because a gated turn does more work, arm a LONGER interval than a one-unit loop — the boundary-tax`,`win comes from N-units-per-turn, not from a faster wake cadence.`].join(`
`)}));export{p as a,m as c,d,x as i,l,b as n,h as o,y as r,g as s,_ as t,u};