import{n as X}from"./chunk-ChpBd9eV.js";import{st as H,t as de}from"./src-BmBNODK0.js";import{a as T,n as ue}from"./workspace-als-CSW21ZcE.js";import{Bn as _e,Nn as he,Pn as fe,Rn as pe}from"./messages-DA3ma2xE.js";import{J as me,K as we,W as ge,q as Ee}from"./loop-C_kE1D5g.js";import{n as Se,r as ye,t as Ae}from"./lifecycle-markers-Be9qmSzA.js";import{U as be,t as ke}from"./agent-C_2PutXi.js";import{c as ve,g as Ie,h as J,o as Te,t as Oe,u as Re}from"./autoloop-CkpeKHzg.js";import{c as V,i as Me,o as Z,s as ee}from"./escalations-CSuTxsbD.js";import{n as Le,t as Ne}from"./wake-reachability-CZpK3xsM.js";function x(e){const r=Number({}.PAPERCUSP_LOOP_TERMINAL_UNREACHABLE_MS);return Math.max(Number.isFinite(r)&&r>0?r:re,e*8)}function L(){const e=Number({}.PAPERCUSP_LOOP_TERMINAL_MIN_STUCK_FIRES);return Number.isFinite(e)&&e>=1?Math.floor(e):3}function te(e){const r=Number({}.PAPERCUSP_LOOP_STUCK_PARK_MS);return Math.max(Number.isFinite(r)&&r>0?r:P,e*4)}function $e(){const e=Number({}.PAPERCUSP_LOOP_COMATOSE_WINDOW_MS);return Number.isFinite(e)&&e>0?e:U}function De(e=0){const r=Number({}.PAPERCUSP_LOOP_COMATOSE_STUCK_FIRES);if(Number.isFinite(r)&&r>=1)return Math.max(Math.floor(r),L()*3);const n=Math.ceil($e()/te(e));return Math.max(n,L())}function Fe(e){const r=e.reachable&&e.durableWhileAlive===!1&&e.circuitOpen===!0,n=e.reachable&&e.circuitOpen===!0&&e.stuckFireCount>=De(e.intervalMs);if(e.reachable&&!r&&!n)return{breach:!1};if(!e.circuitOpen){const s=x(e.intervalMs);if(e.parkedForMs<s)return{breach:!1}}const c=L();if(e.stuckFireCount<c)return{breach:!1};const o=r?"RESUMABLE-DEAD (probe reports reachable via `claude --resume`, but the resume turns never settle)":n?`COMATOSE-HOST (WI-6639: the injectable channel is genuinely live, but the agent behind it has settled no turn across ${e.stuckFireCount} consecutive stuck-backstop fires)`:"unreachable (no injectable/resumable wake channel)";return{breach:!0,reason:e.circuitOpen?`dead-owner: ${o} with fire-circuit OPEN across ${e.stuckFireCount} consecutive failures — auto-paused (WI-1399 / EI-7006 circuit-open fast path, dwell window decoupled${r?"; WI-2339 resumable-dead":""}${n?"; WI-6639 comatose-host":""})`:`dead-owner: ${o}, parked ${Math.round(e.parkedForMs/1e3)}s (≥${Math.round(x(e.intervalMs)/1e3)}s terminal window) across ${e.stuckFireCount} consecutive stuck-backstop fires — auto-paused (WI-1399, dead-owner loop terminal guard)`}}async function Ce(e,r={}){const n=r.probeReachability??Le,c=r.autoPause??ge;let o;try{o=await n(e.targetOwnerId)}catch{return{breach:!1}}const s=Fe({reachable:o.reachable,durableWhileAlive:o.durableWhileAlive,parkedForMs:e.parkedForMs,intervalMs:e.intervalMs,stuckFireCount:e.stuckFireCount,circuitOpen:e.circuitOpen});return s.breach&&await c(e.sql,e.routineId,s.reason),{...s,reachability:o}}var re,xe,P,U,Pe,Ue=X((()=>{Ne(),we(),re=2*36e5,xe=3,P=30*6e4,U=12*36e5,Pe=Math.ceil(U/P)}));function y(e){if(e==null)return null;const r=(e instanceof Date?e:new Date(e)).getTime();return Number.isNaN(r)?null:r}function We(e){const r=Number({}.PAPERCUSP_LOOP_QUICK_RETRY_MS);return Math.max(Number.isFinite(r)&&r>0?r:oe,e*3)}function B(){const e=Number({}.PAPERCUSP_LOOP_QUICK_RETRY_MAX_ATTEMPTS);return Number.isFinite(e)?e:ie}async function He(e){await ee(N,{severity:"advisory",summary:`Loop '${e.name}' auto-paused — owner session ${e.targetOwnerId} is durably dead (wakes stopped landing).`,body:`The loop death/respawn watchdog (WI-2339) confirmed loop '${e.name}' (routine ${e.routineId}, harness ${e.installSlug}, owner ${e.targetOwnerId}) can no longer be reached as a fresh turn, and AUTO-PAUSED it (active=false) instead of re-firing into a dead session forever.

Reason: ${e.reason}

This is inform-only: the watchdog does NOT auto-respawn (owner policy). To resume the work, relaunch the owner session and re-arm the loop (loop:arm), or reclaim its work-items.`,harness_slug:e.installSlug,meta:{subjectSignature:`${q}:${e.installSlug}:${e.routineId}`}})}function Q(e,r,n){if(!e||!e.trim())return null;const c=he({lastAssistantText:e,lastTsMs:n,nowMs:n,activeWithinMs:0});if(!ce.has(c.reason))return null;let o=r;if(c.reason==="usage_limit"){const s=be(e,n);s!=null&&s>n&&(o=Math.min(Math.max(s-n,r),le))}return{reason:c.reason,evidence:c.evidence,rearmDelayMs:o}}async function qe(e){const r=Math.round(e.verdict.rearmDelayMs/6e4);await ee($,{severity:"advisory",meta:{subjectSignature:`${j}:${e.installSlug}:${e.routineId}`},summary:`Loop '${e.name}' wake died on a provider '${e.verdict.reason}' — re-arming instead of the bare interval.`,body:`The loop-lifecycle-death watchdog (EI-13818) found that loop '${e.name}' (routine ${e.routineId}, harness ${e.installSlug}, owner ${e.targetOwnerId})'s most recently woken turn completed CLEANLY (the Stop hook fired normally) but its own text was a provider kill signature, not real work:

${e.verdict.evidence??"(no evidence captured)"}

Without this check the loop would have recorded a false 'ok' and kept re-firing at its bare interval into the same wall. Instead this fire was recorded as an 'error' (feeding the existing failure-streak circuit) and the loop is re-armed ~${r}m out instead of immediately. This is inform-only — no action needed unless the reason recurs after the re-arm.`,harness_slug:e.installSlug})}function ae(e){const r=e.subjectSignature;return typeof r=="string"&&r.length>0?r:null}function ne(e,r){if(!e.startsWith(`${r}:`))return null;const n=e.slice(r.length+1),c=n.lastIndexOf(":");return c<=0||c>=n.length-1?null:{installSlug:n.slice(0,c),routineId:n.slice(c+1)}}async function at(e={}){const r=e.sql??H().sql,n=e.listOpen??(async()=>{const{escalations:l}=await Z({status:"open",from:N.ownerId,maxRecords:500});return l}),c=e.resolve??((l,a,i)=>V({msg_id:l,choice:a,note:i,resolver:N.ownerId})),o={scanned:0,resolved:0,stillOpen:0,unparseable:0};let s;try{s=await n()}catch{return o}if(o.scanned=s.length,s.length===0)return o;const _=s.map(l=>{const a=ae(l);return{rec:l,parts:a?ne(a,q):null}});o.unparseable=_.filter(l=>!l.parts).length;const h=Array.from(new Set(_.map(l=>l.parts?.routineId).filter(l=>!!l)));if(h.length===0)return o.stillOpen=_.length-o.unparseable,o;let E=new Map;try{const l=await r`
      SELECT id, active FROM harness_shared.routines WHERE id = ANY(${h})
    `;E=new Map(l.map(a=>[a.id,a.active]))}catch{return o.stillOpen+=_.filter(l=>l.parts).length,o}for(const{rec:l,parts:a}of _){if(!a)continue;const i=E.get(a.routineId);if(i!==!0&&i!==void 0){o.stillOpen+=1;continue}const p=i===void 0?`loop-death watchdog: routine ${a.routineId} no longer exists — nothing left to auto-pause`:`loop-death watchdog: routine ${a.routineId} is active again — a human re-armed it`;try{const w=await c(l.msg_id,"auto-resolved",p);if(w==="not_found"||w==="already_resolved"||w==="requires_spawn_approve"){o.stillOpen+=1;continue}o.resolved+=1}catch{o.stillOpen+=1}}return o}async function nt(e={}){const r=e.sql??H().sql,n=e.readFireState??J,c=e.listOpen??(async()=>{const{escalations:a}=await Z({status:"open",from:$.ownerId,maxRecords:500});return a}),o=e.resolve??((a,i,p)=>V({msg_id:a,choice:i,note:p,resolver:$.ownerId})),s={scanned:0,resolved:0,stillOpen:0,unparseable:0};let _;try{_=await c()}catch{return s}if(s.scanned=_.length,_.length===0)return s;const h=_.map(a=>{const i=ae(a);return{rec:a,parts:i?ne(i,j):null}});s.unparseable=h.filter(a=>!a.parts).length;const E=Array.from(new Set(h.map(a=>a.parts?.routineId).filter(a=>!!a)));if(E.length===0)return s;let l=new Map;try{const a=await r`
      SELECT id, active, install_slug, name FROM harness_shared.routines WHERE id = ANY(${E})
    `;l=new Map(a.map(i=>[i.id,{active:i.active,installSlug:i.install_slug,name:i.name}]))}catch{return s.stillOpen+=h.filter(a=>a.parts).length,s}for(const{rec:a,parts:i}of h){if(!i)continue;const p=l.get(i.routineId);let w=null;if(!p)w=`loop-lifecycle-death watchdog: routine ${i.routineId} no longer exists`;else if(!p.active)w=`loop-lifecycle-death watchdog: routine ${i.routineId} was subsequently auto-paused (superseded by the loop-death watchdog's stronger escalation)`;else{const t=await n(p.installSlug,p.name).catch(()=>null);(!t||t.consecutiveErrors===0)&&(w=`loop-lifecycle-death watchdog: routine ${i.routineId} has since fired successfully (consecutive_errors reset to 0) — the provider wall cleared`)}if(w===null){s.stillOpen+=1;continue}try{const t=await o(a.msg_id,"auto-resolved",w);if(t==="not_found"||t==="already_resolved"||t==="requires_spawn_approve"){s.stillOpen+=1;continue}s.resolved+=1}catch{s.stillOpen+=1}}return s}function je(e,r,n){if(e.carry==="cold"){const h=y(e.lifecycle_completed_at),E=y(e.lifecycle_started_at),l=h!=null&&E!=null&&h>E?h:null,a=e.note_updated_ts==null?null:Number(e.note_updated_ts),i=a!=null&&Number.isFinite(a)&&a>r?a:null;return l!=null&&(i==null||l>=i)?{completedAt:l,via:"lifecycle"}:i!=null?{completedAt:i,via:"note-refresh"}:null}const c=y(e.lifecycle_completed_at),o=y(e.lifecycle_started_at);if(c!=null&&(o==null||o<c))return{completedAt:c,via:"lifecycle"};const s=y(e.turn_journal_completed_at);if(s!=null)return{completedAt:s,via:"turn-journal"};const _=y(e.presence_last_active_at);if(_!=null&&_>r&&n-_>=se){if(e.last_assistant_text_after_fire==null){const h=y(e.turns_ingest_watermark);if(h!=null&&h<_)return null}return{completedAt:_,via:"presence-quiescence"}}return null}async function st(e={}){const r=e.sql??H().sql,n=e.nowMs??Date.now(),c=e.recordFire??Ie,o=e.readFireState??J,s=e.checkUnreachableTerminalGuard??Ce,_=e.circuitThreshold??Te,h=e.evaluateFireGate??ve,E=e.escalateDeadLoop??He,l=e.cancelInboxWake??pe,a=e.escalateLifecycleDeath??qe,i=await r`
    SELECT r.id,
           r.target_owner_id,
           r.reschedule_interval_sec AS interval_sec,
           (r.next_fire_at = 'infinity'::timestamptz) AS parked,
           jsonb_exists(r.trigger_config, 'cron') AS is_cron,
           r.install_slug,
           r.name,
           r.workspace_id AS routine_workspace_id,
           r.last_fired_at,
           (SELECT max(a.created_at)
              FROM harness_shared.agent_activity a
             WHERE a.owner_id = r.target_owner_id
               AND a.kind = 'lifecycle'
               AND a.summary = ${Ae}
               AND a.created_at > r.last_fired_at) AS lifecycle_completed_at,
           -- WI-6069: the Stop hook's journal write (P-012) — see the layer-1.5 module-header
           -- note. Cheap: indexed on (owner_id, created_at DESC).
           --
           -- ⚠ EI-19316779460752535 — WI-6069's stated premise, that this write "fires at the
           -- end of EVERY ordinary turn, restart or not, across every CLI", is FALSE.
           -- The journal:record-turn tool writes a row ONLY when extractJournalFromAssistantText()
           -- finds an extractable note in the turn text; otherwise it returns no_note and
           -- writes nothing. Measured 2026-08-02 over 24h: 17 rows vs 750 ingested assistant
           -- turns for one owner (2.3%); 746 rows / 61 owners fleet-wide, 100% flagged=true.
           -- Consequence for THIS file: the layer-1.5 'turn-journal' completion signal — added
           -- precisely so a warm push-wake session settles promptly instead of degrading to the
           -- weaker layer-2 fallback — fires for a small minority of turns, so most loop settles
           -- still go through presence-quiescence (which is why WI-6852's ingest-watermark
           -- deferral had to be added THERE). Do not treat a missing journal row as evidence
           -- that no turn completed.
           (SELECT max(j.created_at)
              FROM harness_shared.session_turn_journal j
             WHERE j.owner_id = r.target_owner_id
               AND j.created_at > r.last_fired_at) AS turn_journal_completed_at,
           (SELECT max(a.created_at)
              FROM harness_shared.agent_activity a
             WHERE a.owner_id = r.target_owner_id
               AND a.kind = 'lifecycle'
               AND a.summary = ${Se}
               AND a.created_at > r.last_fired_at) AS lifecycle_started_at,
           (r.payload_template->>'carry') AS carry,
           (SELECT max(cn.updated_ts)
              FROM harness_shared.carry_notes cn
             WHERE cn.scope = ('loop:' || r.install_slug || ':' || r.target_owner_id)
               AND cn.note IS NOT NULL) AS note_updated_ts,
           (SELECT max(p.last_active_at)
              FROM harness_shared.coord_presence p
             WHERE p.owner_id = r.target_owner_id) AS presence_last_active_at,
           -- EI-13818: the most recent assistant turn text after this fire — the lifecycle-death
           -- reclassification's only evidence source. Cheap: one correlated single-row lookup per
           -- in-scope loop, ordered by ts (falls back to turn_idx on a tie) so a multi-session
           -- (cold-spawn) owner still resolves to its TRUE most-recent turn, not an arbitrary one.
           (SELECT st.text
              FROM harness_shared.session_turns st
             WHERE st.owner = r.target_owner_id
               AND st.speaker = 'assistant'
               AND st.ts > r.last_fired_at
             ORDER BY st.ts DESC, st.turn_idx DESC
             LIMIT 1) AS last_assistant_text_after_fire,
           -- WI-6852: the session_turns INGEST WATERMARK for this owner — the newest turn ts
           -- indexed so far, any speaker. Answers the question the text lookup above cannot:
           -- is a NULL last_assistant_text_after_fire a REAL absence, or merely a turn that
           -- has not been ingested yet? Index-backed (session_turns_owner_ts_idx on (owner, ts)),
           -- same correlated single-row cost class as the lookup above. Deliberately NOT
           -- speaker-filtered: this is "how far has the ingest got", not "what did it say".
           (SELECT max(st2.ts)
              FROM harness_shared.session_turns st2
             WHERE st2.owner = r.target_owner_id) AS turns_ingest_watermark
      FROM harness_shared.routines r
     WHERE r.active = TRUE
       AND r.reschedule_interval_sec IS NOT NULL
       AND r.target_owner_id IS NOT NULL
       AND (
             r.next_fire_at = 'infinity'::timestamptz
             OR jsonb_exists(r.trigger_config, 'cron')
             -- EI-11407: an ARMED pure loop that has fired at least once — previously excluded
             -- entirely, the gap this fix closes (see the class-4 header note above).
             OR (r.last_fired_at IS NOT NULL AND NOT jsonb_exists(r.trigger_config, 'cron'))
           )
  `,p={rearmed:0,loops:[],terminated:[]};async function w(t,u){p.terminated.push({id:t.id,targetOwnerId:t.target_owner_id,reason:u}),await T(t.routine_workspace_id,()=>c(t.install_slug,t.name,Oe,"error")).catch(d=>console.warn(`[loop-reconcile] recordFire('error') failed for terminated loop '${t.id}': ${d instanceof Error?d.message:d}`)),await T(t.routine_workspace_id,()=>l(t.target_owner_id,t.routine_workspace_id)).catch(d=>console.warn(`[loop-reconcile] cancelInboxWake failed for dead owner '${t.target_owner_id}': ${d instanceof Error?d.message:d}`)),await T(t.routine_workspace_id,()=>E({routineId:t.id,targetOwnerId:t.target_owner_id,installSlug:t.install_slug,name:t.name,reason:u})).catch(d=>console.warn(`[loop-reconcile] escalateDeadLoop failed for terminated loop '${t.id}': ${d instanceof Error?d.message:d}`)),console.warn(`[loop-reconcile] loop '${t.id}' (owner ${t.target_owner_id}) TERMINATED (auto-paused, not re-armed): ${u}`)}for(const t of i)try{const u=y(t.last_fired_at);if(u==null)continue;const d=t.interval_sec*1e3;if(!t.parked&&!t.is_cron){const b=y(t.presence_last_active_at),A=n-Math.max(u,b??u);if(A>=x(d)){const f=await s({sql:r,routineId:t.id,targetOwnerId:t.target_owner_id,parkedForMs:A,intervalMs:d,stuckFireCount:L(),circuitOpen:!1}).catch(g=>(console.warn(`[loop-reconcile] armed-loop unreachable-guard check failed for '${t.id}' — leaving it armed: ${g instanceof Error?g.message:g}`),{breach:!1}));f.breach&&await w(t,f.reason??"unreachable dead-owner loop (armed, EI-11407 sweep)")}continue}let k,m,R=!1,D=null,K=0;const F=je(t,u,n);let S=null;if(F)k=F.completedAt,m=F.via,(m==="lifecycle"||m==="turn-journal"||m==="presence-quiescence")&&(S=Q(t.last_assistant_text_after_fire,d,n));else{const b=y(t.presence_last_active_at)??0;if(!(t.parked&&(b<=u||n-b>=W(d))))continue;const A=await T(t.routine_workspace_id,()=>o(t.install_slug,t.name)).catch(()=>null),f=A?.consecutiveErrors??0,g=f>=_(),M=n-u>=W(d),G=n-u>=We(d)&&!M&&!g&&B()>0&&f<B();if(g||M){const I=g?f:f+1,z=await s({sql:r,routineId:t.id,targetOwnerId:t.target_owner_id,parkedForMs:n-u,intervalMs:d,stuckFireCount:I,circuitOpen:g}).catch(C=>(console.warn(`[loop-reconcile] unreachable-terminal-guard check failed for '${t.id}' — falling back to stuck-backstop retry: ${C instanceof Error?C.message:C}`),{breach:!1}));if(z.breach){await w(t,z.reason??"unreachable dead-owner loop");continue}}if(!M&&!G){const I=h(A,new Date(n));if(!t.parked||I.allow||!I.retryAfterSec||I.retryAfterSec<=0)continue;k=n,m="gate-backoff",D=I.retryAfterSec*1e3,K=f}else k=u,m="stuck-backstop",G&&!M&&(R=!0),S=Q(t.last_assistant_text_after_fire,d,n)}const O=D!=null?Math.max(D,d):S?.rearmDelayMs??d,v=new Date(k+O).toISOString(),Y=S?.reason==="usage_limit"&&O>d;if((Y?await r`
            UPDATE harness_shared.routines
               SET next_fire_at = CASE
                     WHEN next_fire_at = 'infinity'::timestamptz THEN ${v}::timestamptz
                     ELSE GREATEST(next_fire_at, ${v}::timestamptz)
                   END,
                   updated_at = now()
             WHERE id = ${t.id}
               AND reschedule_interval_sec IS NOT NULL
               AND ( next_fire_at = 'infinity'::timestamptz
                     OR next_fire_at < ${v}::timestamptz )
            RETURNING id
          `:await r`
        UPDATE harness_shared.routines
           SET next_fire_at = LEAST(next_fire_at, ${v}::timestamptz), updated_at = now()
         WHERE id = ${t.id}
           AND reschedule_interval_sec IS NOT NULL
           AND ( next_fire_at = 'infinity'::timestamptz
                 OR next_fire_at > ${v}::timestamptz )
        RETURNING id
      `).length>0){p.rearmed++,p.loops.push({id:t.id,targetOwnerId:t.target_owner_id,completedAt:k,nextFireAt:k+O,via:m,...R?{quickRetry:!0}:{}});const b=t.last_fired_at?new Date(t.last_fired_at).getTime():NaN;me(r,{workspaceId:t.routine_workspace_id,installSlug:t.install_slug,routineId:t.id,routineName:t.name,targetOwnerId:t.target_owner_id,event:"rearmed",actor:"reconcile-loop-routines",newNextFireAt:v,intervalSec:t.interval_sec,detail:{via:m,wasParked:!!t.parked,...Y?{deferPastWall:!0}:{},...R?{quickRetry:!0}:{},...Number.isFinite(b)?{parkedMs:Date.now()-b}:{}}});const A=m==="gate-backoff"?null:S||m==="stuck-backstop"?"error":"ok";if(A!=null){const f=S?`loop-lifecycle-death:${S.reason}`:`loop-${m}`;await T(t.routine_workspace_id,()=>c(t.install_slug,t.name,f,A)).catch(g=>console.warn(`[loop-reconcile] recordFire('${A}') failed for '${t.id}': ${g instanceof Error?g.message:g}`))}S&&(console.warn(`[loop-reconcile] loop '${t.id}' (owner ${t.target_owner_id}) turn completed CLEANLY but its text was a provider kill ('${S.reason}') — recorded 'error' + re-armed +${Math.round(O/1e3)}s instead of the bare interval`),await T(t.routine_workspace_id,()=>a({routineId:t.id,targetOwnerId:t.target_owner_id,installSlug:t.install_slug,name:t.name,verdict:S})).catch(f=>console.warn(`[loop-reconcile] escalateLifecycleDeath failed for '${t.id}': ${f instanceof Error?f.message:f}`))),m==="stuck-backstop"&&console.warn(`[loop-reconcile] loop '${t.id}' (owner ${t.target_owner_id}) parked ${Math.round((n-u)/1e3)}s with no completion signal — re-armed to retry (circuit fed 'error'${R?", WI-2714 quick-retry leg":""})`),m==="gate-backoff"&&console.warn(`[loop-reconcile] loop '${t.id}' (owner ${t.target_owner_id}) was parked at 'infinity' with the fire-gate withholding (consecutive_errors=${K}) — re-armed +${Math.round(O/1e3)}s to the moment the backoff expires; circuit left UNTOUCHED`)}}catch(u){console.warn(`[loop-reconcile] row '${t.id}' (owner ${t.target_owner_id}) failed to rebase — SKIPPED (other loops unaffected): ${u instanceof Error?u.stack??u.message:String(u)}`)}return p}var se,W,oe,ie,N,q,le,ce,$,j,Ke=X((()=>{de(),Re(),ue(),Ue(),_e(),Me(),ye(),fe(),ke(),Ee(),se=6e4,W=te,oe=10*6e4,ie=3,N={ownerId:"system:loop-death-watchdog",ownerLabel:"system · loop-death-watchdog",source:"principal",workspaceId:null,userId:null},q="loop-death",le=6*36e5,ce=new Set(["auth_wall","usage_limit","model_error","context_limit"]),$={ownerId:"system:loop-lifecycle-death-watchdog",ownerLabel:"system · loop-lifecycle-death-watchdog",source:"principal",workspaceId:null,userId:null},j="loop-lifecycle-death"}));Ke();export{at as reconcileDeadLoopEscalations,nt as reconcileLoopLifecycleDeathEscalations,st as reconcileLoopRoutines};
