import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{a as n}from"./types-DWFvb24U.js";import{t as r}from"./src-CufTLG1h.js";import{a as i,c as a}from"./server-WINkLZx9.js";import{t as o}from"./__vite-browser-external-CM3Eme-n.js";import{J as s,t as c}from"./src-CRqYcphb.js";import{a as l,r as u,t as d}from"./operator-state-pg-DJsIxvPm.js";import{n as f,t as p}from"./registry-BQViYXxW.js";import{r as m,t as h}from"./coordination-event-log-browser-Dq_4i-_C.js";import{a as g,n as _,o as v}from"./escalations-BdfTr58s.js";import{c as y,o as b}from"./inbox-wake-D1a4i111.js";import{i as x,o as S}from"./started-b2c19sz2.js";import{d as C,m as ee}from"./spawn-reclaim-quD8F3lR.js";import{n as w,r as T,t as te}from"./work-items-stale-claims-BSoj6Sxt.js";function ne(){return k}async function re(){try{k=await u(`operator_pot_control_policy`)??{}}catch{}}async function E(){return await u(`operator_pot_control_policy`)??{}}async function D(e){await l(`operator_pot_control_policy`,e),k=e}async function ie(){await D({})}var O,k,ae=e((()=>{d(),p(),O={breakerThreshold:3,recoveryDebounceMs:5*6e4,dormancyGraceMs:10*6e4,infraBreakerThreshold:12},k={},re(),f({name:`pot-control-policy`,description:`pot placement-watchdog thresholds (breaker / recovery-debounce / dormancy-grace / infra-breaker)`,auditAction:`pot:control_policy`,diff:async()=>{let e=await E(),t=[];for(let n of Object.keys(O))e[n]!==void 0&&t.push({key:n,effective:e[n],default:O[n],layer:`pg-settings`});return t},capture:()=>E(),reset:()=>ie(),restore:e=>D(e??{})})}));function A(e){return e!=null&&W.has(e)}function j(e){return e!=null&&q.has(e)}function oe(){let e=Number({}.PAPERCUSP_POT_PLACEMENT_BREAKER??{}.PAPERCUSP_POT_PLACEMENT_BREAKER??3),t=Number({}.PAPERCUSP_POT_PLACEMENT_DEBOUNCE_MS??{}.PAPERCUSP_POT_PLACEMENT_DEBOUNCE_MS??5*6e4),n=Number({}.PAPERCUSP_POT_PLACEMENT_DORMANCY_MS??{}.PAPERCUSP_POT_PLACEMENT_DORMANCY_MS??10*6e4),r=Number({}.PAPERCUSP_POT_PLACEMENT_INFRA_BREAKER??{}.PAPERCUSP_POT_PLACEMENT_INFRA_BREAKER??12);return{breakerThreshold:Number.isFinite(e)&&e>=1?e:3,recoveryDebounceMs:Number.isFinite(t)&&t>=0?t:5*6e4,dormancyGraceMs:Number.isFinite(n)&&n>=0?n:10*6e4,infraBreakerThreshold:Number.isFinite(r)&&r>=1?r:12,...ne()}}function M(e,t){return e===`reaped`?!0:e===`failed`&&t!=null&&t.startsWith(`reclaimed:`)}function N(e){if(K.has(e.status))return`dead`;let{heartbeatAtMs:t,lastOutputAtMs:n,now:r,confirmedAliveSameHost:i}=e;return t!=null&&r-t>3e5&&!i?`dead`:n!=null&&r-n>6e5?`wedged`:`live`}function P(e,t){if(!e.unitExists)return{kind:`abandon`,reason:`unit no longer exists`};if(e.unitTerminal)return{kind:`completed`};if(e.hasLiveHolder)return{kind:`healthy`};if(e.unitParked)return{kind:`parked`,reason:`unit status is a deliberate park (e.g. blocked) — no holder expected`};if(e.placementStatus===`cursed`)return{kind:`latched`};if(e.placementStatus===`recovering`&&e.lastRecoveryAtMs!=null&&e.now-e.lastRecoveryAtMs<t.recoveryDebounceMs)return{kind:`debounced`};if(e.servingCupReclaimedWhileActive)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,reason:`serving cup reaper-reclaimed while still active (slow-but-alive) — re-placing, not counting toward any breaker`};if(e.postDormancySweep)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,infraAttributed:!0,reason:`post-dormancy recovery sweep (operator/bg-host was down) — item-independent infra loss, fully exempt from both breakers (re-placing, not counting)`};if(e.hasServingCup===!1)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,reason:`no serving-cup attempt since the last loss — re-place only, nothing to count`};if(e.servingCupSpawnId!=null&&e.lastLossSpawnId!=null&&e.servingCupSpawnId===e.lastLossSpawnId)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,reason:`dead attempt ${e.servingCupSpawnId} already counted — re-place only`};if(e.servingCupMadeNoToolCalls){let n=e.infraLossCount+1;return n>=t.infraBreakerThreshold?{kind:`breaker`,nextFailCount:e.failCount,nextInfraLossCount:n,infraAttributed:!0,reason:`${n} no-fair-attempt (zombie) losses (>= infra breaker ${t.infraBreakerThreshold}) — serving cup made 0 tool calls`}:{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:n,infraAttributed:!0,reason:`serving cup made 0 tool calls (no-fair-attempt / zombie) — counted toward the bounded infra breaker, not the pathology breaker`}}let n=e.failCount+1;return n>=t.breakerThreshold?{kind:`breaker`,nextFailCount:n,nextInfraLossCount:e.infraLossCount,reason:`${n} failed placements (>= breaker threshold ${t.breakerThreshold})`}:{kind:`recover`,nextFailCount:n,nextInfraLossCount:e.infraLossCount,reason:`serving cup dead/stalled and the unit is not terminal`}}function F(e){return Q.has(e.placementStatus)?e.unitExists?e.unitTerminal?`resolve-completed`:`keep`:`resolve-abandoned`:`keep`}function I(e){if(e==null)return null;let t=typeof e==`number`?e:Number(e);return Number.isFinite(t)?t:null}async function se(e,t,n){return(await e`
    SELECT coord_owner_id
      FROM harness_shared.adv_sessions
     WHERE workspace_id = ${t}
       AND label LIKE ${`pot · `+n+`/%`}
       AND coord_owner_id IS NOT NULL
     ORDER BY started_at DESC
     LIMIT 1`)[0]?.coord_owner_id??null}async function L(e,t,n){return(await e`
    SELECT DISTINCT coord_owner_id, max(started_at) AS started_at
      FROM harness_shared.adv_sessions
     WHERE workspace_id = ${t}
       AND label LIKE ${`pot · `+n+`/%`}
       AND coord_owner_id IS NOT NULL
     GROUP BY coord_owner_id
     ORDER BY started_at DESC`).map(e=>e.coord_owner_id)}async function R(e,t){let n=t.bumpRecovery?new Date(t.now).toISOString():null;await e`
    INSERT INTO harness_shared.pot_placements
      (workspace_id, install_slug, work_item_id, harness_slug, mug_owner_id,
       cup_spawn_id, cup_owner_id, status, fail_count, infra_loss_count, last_loss_spawn_id, last_disposition,
       escalation_msg_id, last_recovery_at, last_seen_at, updated_at)
    VALUES (
      ${t.workspaceId}, ${t.installSlug}, ${t.workItemId}, ${t.harnessSlug}, ${t.mugOwnerId},
      ${t.cupSpawnId}, ${t.cupOwnerId}, ${t.status}, ${t.failCount}, ${t.infraLossCount??0}, ${t.lastLossSpawnId}, ${t.disposition},
      ${t.escalationMsgId??null}, ${n}, ${new Date(t.now).toISOString()}, ${new Date(t.now).toISOString()}
    )
    ON CONFLICT (workspace_id, install_slug, work_item_id) DO UPDATE SET
      harness_slug      = COALESCE(EXCLUDED.harness_slug, harness_shared.pot_placements.harness_slug),
      mug_owner_id    = COALESCE(EXCLUDED.mug_owner_id, harness_shared.pot_placements.mug_owner_id),
      cup_spawn_id      = COALESCE(EXCLUDED.cup_spawn_id, harness_shared.pot_placements.cup_spawn_id),
      cup_owner_id      = COALESCE(EXCLUDED.cup_owner_id, harness_shared.pot_placements.cup_owner_id),
      status            = EXCLUDED.status,
      fail_count        = EXCLUDED.fail_count,
      infra_loss_count  = EXCLUDED.infra_loss_count,
      last_loss_spawn_id = EXCLUDED.last_loss_spawn_id,
      last_disposition  = EXCLUDED.last_disposition,
      escalation_msg_id = COALESCE(EXCLUDED.escalation_msg_id, harness_shared.pot_placements.escalation_msg_id),
      last_recovery_at  = COALESCE(EXCLUDED.last_recovery_at, harness_shared.pot_placements.last_recovery_at),
      last_seen_at      = EXCLUDED.last_seen_at,
      updated_at        = EXCLUDED.updated_at`}async function ce(e={}){let t=[],r=e.deps?.getFlag??i,a=e.deps?.listStartedPots??S,o=e.deps?.getOrgPg??s,c=e.deps?.reconcileOnePot??z;try{if(!await r(n.POT_PLACEMENT_WATCHDOG,`system`))return t;let i=await a();if(i.length===0)return t;let{sql:s}=o(),l=e.now??Date.now(),u=oe();for(let{workspaceId:e,installSlug:n}of i)try{t.push(...await c(s,e,n,u,l))}catch(e){console.warn(`[pot-placement-watchdog] pot ${n} failed: ${e instanceof Error?e.message:e}`)}}catch(e){console.warn(`[pot-placement-watchdog] sweep failed: ${e instanceof Error?e.message:e}`)}return t}async function z(e,t,n,r,i,a=ee){let o=[],s=await L(e,t,n);if(s.length===0)return o;let c=s[0],l=await e`
    SELECT spawn_id, session_owner, feature_id, status, run_id, error_message, pid, launcher_host,
           extract(epoch from heartbeat_at) * 1000 AS heartbeat_ms,
           extract(epoch from last_output_at) * 1000 AS last_output_ms
      FROM harness_shared.spawned_agents
     WHERE workspace_id = ${t}
       AND child_role = 'cup'
       AND parent_spawn_id = ANY(${s})`,u=(0,U.hostname)(),d=new Map;for(let e of l){let t=e.session_owner||e.spawn_id;if(e.launcher_host!==u||e.pid==null)continue;let n=(e.run_id??``).startsWith(`launch-`)||e.spawn_id.startsWith(`durable-spawn:`)?`launch`:`spawn`;a(e.pid,n)&&(d.set(t,!0),d.set(e.spawn_id,!0))}let f=[...new Set(l.map(e=>e.run_id).filter(e=>!!e))],p=new Set;if(f.length>0){let n=await e`
      SELECT DISTINCT run_id
        FROM harness_shared.agent_usage_samples
       WHERE workspace_id = ${t}
         AND run_id = ANY(${f})
         AND ts >= ${i-Z}`;for(let e of n)e.run_id&&p.add(e.run_id)}let m=[...new Set(l.map(e=>e.session_owner||e.spawn_id))],h=new Set;if(m.length>0){let n=await e`
      SELECT DISTINCT owner_id
        FROM harness_shared.agent_activity
       WHERE workspace_id = ${t}
         AND owner_id = ANY(${m})
         AND kind = 'tool'`;for(let e of n)h.add(e.owner_id)}let g=l.map(e=>e.spawn_id),_=new Set;if(g.length>0){let n=await e`
      SELECT DISTINCT spawn_id
        FROM harness_shared.tool_invocations
       WHERE workspace_id = ${t}
         AND spawn_id = ANY(${g})`;for(let e of n)_.add(e.spawn_id)}let v=new Map;for(let e of l){let t=e.session_owner||e.spawn_id,n=e.run_id!=null&&p.has(e.run_id),r={spawnId:e.spawn_id,ownerId:t,featureId:e.feature_id,liveness:N({status:e.status,heartbeatAtMs:I(e.heartbeat_ms),lastOutputAtMs:I(e.last_output_ms),now:i,confirmedAliveSameHost:d.get(e.spawn_id)===!0}),reclaimedWhileActive:n&&(e.status===`running`||e.status===`restarting`||M(e.status,e.error_message)),madeNoToolCalls:!h.has(t)&&!_.has(e.spawn_id)};v.set(t,r),v.set(e.spawn_id,r)}let y=[...new Set(l.map(e=>e.session_owner||e.spawn_id))],b=new Set;for(let e of l)e.feature_id&&b.add(e.feature_id);if(y.length>0){let n=await e`
      SELECT feature_id FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t} AND taken_by = ANY(${y})`;for(let e of n)b.add(e.feature_id)}let x=await e`
    SELECT work_item_id, status, fail_count, infra_loss_count,
           extract(epoch from last_recovery_at) * 1000 AS last_recovery_ms,
           last_loss_spawn_id,
           escalation_msg_id,
           extract(epoch from last_seen_at) * 1000 AS last_seen_ms
      FROM harness_shared.pot_placements
     WHERE workspace_id = ${t} AND install_slug = ${n}`,S=new Map(x.map(e=>[e.work_item_id,e])),C=x.reduce((e,t)=>Math.max(e,I(t.last_seen_ms)??0),0),w=C>0&&i-C>r.dormancyGraceMs;if(b.size>0){let a=[...b],s=await e`
      SELECT feature_id, harness_slug, status, taken_by
        FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t} AND feature_id = ANY(${a})`,u=new Map(s.map(e=>[e.feature_id,e]));for(let s of a){let a=u.get(s),d=S.get(s),f=a?.taken_by?v.get(a.taken_by):void 0,p=l.find(e=>e.feature_id===s),m=p?v.get(p.session_owner||p.spawn_id):void 0,h=f??m,g=f?.liveness===`live`||m?.liveness===`live`,_=!g&&(f?.reclaimedWhileActive===!0||m?.reclaimedWhileActive===!0),y=!g&&(f?.madeNoToolCalls===!0||m?.madeNoToolCalls===!0),b={workItemId:s,unitExists:!!a,unitTerminal:A(a?.status),hasLiveHolder:g,failCount:d?.fail_count??0,infraLossCount:d?.infra_loss_count??0,placementStatus:d?.status??null,lastRecoveryAtMs:d?.last_recovery_ms??null,hasServingCup:h!=null,servingCupSpawnId:h?.spawnId??null,lastLossSpawnId:d?.last_loss_spawn_id??null,servingCupReclaimedWhileActive:_,servingCupMadeNoToolCalls:y,postDormancySweep:w,unitParked:j(a?.status),now:i},x=P(b,r),C={workspaceId:t,installSlug:n,workItemId:s,harnessSlug:a?.harness_slug??null,mugOwnerId:c,cupSpawnId:h?.spawnId??null,cupOwnerId:h?.ownerId??null,now:i};switch(x.kind){case`healthy`:await R(e,{...C,status:`working`,failCount:b.failCount,infraLossCount:b.infraLossCount,lastLossSpawnId:null,disposition:`working`});break;case`completed`:if(d?.status!==`completed`&&(d?.escalation_msg_id&&await V(d.escalation_msg_id,s),await R(e,{...C,status:`completed`,failCount:b.failCount,infraLossCount:b.infraLossCount,lastLossSpawnId:null,disposition:`completed`}),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`completed`}),C.harnessSlug)){let r=await ue(e,t,C.harnessSlug,s);r>0&&(await de(t,c,s,C.harnessSlug,r),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`unblocked`,detail:`${r} downstream`}))}break;case`parked`:d?.status!==`blocked`&&(d?.escalation_msg_id&&await V(d.escalation_msg_id,s),await R(e,{...C,status:`blocked`,failCount:b.failCount,infraLossCount:b.infraLossCount,lastLossSpawnId:null,disposition:`parked`}));break;case`recover`:await R(e,{...C,status:`recovering`,failCount:x.nextFailCount,infraLossCount:x.nextInfraLossCount,lastLossSpawnId:x.nextFailCount>b.failCount||x.nextInfraLossCount>b.infraLossCount?h?.spawnId??d?.last_loss_spawn_id??null:d?.last_loss_spawn_id??null,disposition:`recover`,bumpRecovery:!0}),x.infraAttributed||await le(t,c,s,C.harnessSlug,x.nextFailCount),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`recover`,detail:`attempt ${x.nextFailCount}`});break;case`breaker`:{let r=x.infraAttributed?null:await fe(s,C.harnessSlug,x.nextFailCount);await R(e,{...C,status:`cursed`,failCount:x.nextFailCount,lastLossSpawnId:h?.spawnId??d?.last_loss_spawn_id??null,infraLossCount:x.nextInfraLossCount,disposition:`breaker`,escalationMsgId:r}),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`breaker`,detail:x.reason});break}case`latched`:await R(e,{...C,status:`cursed`,failCount:b.failCount,lastLossSpawnId:d?.last_loss_spawn_id??null,infraLossCount:b.infraLossCount,disposition:`breaker`}),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`latched`,detail:`cursed, halted (fail_count ${b.failCount} frozen)`});break;case`debounced`:await R(e,{...C,status:`recovering`,failCount:b.failCount,lastLossSpawnId:d?.last_loss_spawn_id??null,infraLossCount:b.infraLossCount,disposition:`recover`});break;case`abandon`:d&&d.status!==`abandoned`&&d.status!==`completed`&&await R(e,{...C,status:`abandoned`,failCount:b.failCount,infraLossCount:b.infraLossCount,lastLossSpawnId:null,disposition:`abandoned`});break}}}return o.push(...await me(e,t,n,c,S,i)),o.push(...await pe(e,t,n,i)),o}async function le(e,t,n,r,i){try{await y([t],{summary:`Placement watchdog: work-item ${n}${r?` (${r})`:``} is not terminal but its cup is dead/stalled (placement attempt ${i}) — re-place or recover it.`,payload:{kind:`placement-recovery`,workItemId:n,harness:r,attempt:i},source:`pot-placement-watchdog`,workspaceId:e})}catch(e){console.warn(`[pot-placement-watchdog] recovery wake failed for ${n}: ${e instanceof Error?e.message:e}`)}}async function ue(e,t,n,r){return(await e`
    SELECT count(*)::int AS downstream
      FROM harness_shared.coord_links l
      JOIN harness_shared.harness_features_consolidated d
        ON d.workspace_id = ${t}
       AND d.harness_slug = split_part(l.dst_ref, '#', 1)
       AND d.feature_id   = split_part(l.dst_ref, '#', 2)
     WHERE l.workspace_id = ${`default`}
       AND l.rel = 'blocks'
       AND l.src_kind = 'feature'
       AND l.dst_kind = 'feature'
       AND l.src_ref = ${`${n}#${r}`}
       AND d.status <> ALL(${[...W]})`)[0]?.downstream??0}async function de(e,t,n,r,i){try{await y([t],{summary:`Placement watchdog: ${n}${r?` (${r})`:``} completed and un-gated ${i} downstream lane(s) — survey + place the next wave batch.`,payload:{kind:`placement-unblocked`,workItemId:n,harness:r,downstream:i},source:`pot-placement-watchdog`,workspaceId:e})}catch(e){console.warn(`[pot-placement-watchdog] unblock wake failed for ${n}: ${e instanceof Error?e.message:e}`)}}async function fe(e,t,n){try{return(await g(X,{severity:`advisory`,summary:`Cursed placement: ${e} failed ${n}× — stopped auto-re-placing`,body:`Work-item ${e}${t?` (${t})`:``} has been placed and lost ${n} times without reaching a terminal state. Per the cursed-item circuit breaker (mug-autonomous-execution B-09 / P-021) the Mug has STOPPED auto-re-placing it. Investigate it (ill-specified? wedging cups?) then re-place, deprecate, or split it. Re-placing clears the breaker when it next completes.`})).msg_id}catch(t){return console.warn(`[pot-placement-watchdog] cursed escalation failed for ${e}: ${t instanceof Error?t.message:t}`),null}}async function B(e,t,n){if(e)try{await v({msg_id:e,choice:`item-now-terminal`,resolver:Y,note:n})}catch(e){console.warn(`[pot-placement-watchdog] resolving placement escalation failed for ${t}: ${e instanceof Error?e.message:e}`)}}async function V(e,t){await B(e,t,`auto-resolved: work-item ${t} reached terminal state, cursed advisory is no longer relevant`)}async function pe(e,t,n,r){let i=[],a=await e`
    SELECT work_item_id, status, escalation_msg_id, harness_slug, fail_count
      FROM harness_shared.pot_placements
     WHERE workspace_id = ${t}
       AND install_slug = ${n}
       AND status IN ('working', 'recovering', 'cursed', 'stranded')`;if(a.length===0)return i;let o=await e`
    SELECT feature_id, status
      FROM harness_shared.harness_features_consolidated
     WHERE workspace_id = ${t} AND feature_id = ANY(${[...new Set(a.map(e=>e.work_item_id))]})`,s=new Map(o.map(e=>[e.feature_id,e.status]));for(let o of a){let a=s.get(o.work_item_id),c=F({placementStatus:o.status,unitExists:a!=null,unitTerminal:A(a)});if(c===`keep`)continue;let l=c===`resolve-completed`;o.escalation_msg_id&&await B(o.escalation_msg_id,o.work_item_id,l?`auto-resolved (placement GC, EI-1524): work-item ${o.work_item_id} reached terminal state (${a}); the ${o.status} advisory is no longer relevant`:`auto-resolved (placement GC, EI-1524): work-item ${o.work_item_id} no longer exists; the ${o.status} advisory is no longer relevant`),await R(e,{workspaceId:t,installSlug:n,workItemId:o.work_item_id,harnessSlug:o.harness_slug,mugOwnerId:null,lastLossSpawnId:null,cupSpawnId:null,cupOwnerId:null,status:l?`completed`:`abandoned`,failCount:o.fail_count,disposition:l?`completed`:`abandoned`,now:r}),i.push({workspaceId:t,installSlug:n,workItemId:o.work_item_id,decision:l?`completed`:`abandon`,detail:`gc: stale ${o.status} placement reconciled (unit ${l?a:`gone`})`})}return i}async function me(e,t,n,r,i,a){let o=[],s=await e`
    SELECT b.feature_id AS blocker_id, b.harness_slug AS blocker_harness, b.status AS blocker_status,
           count(*)::int AS downstream
      FROM harness_shared.coord_links l
      JOIN harness_shared.harness_features_consolidated b
        ON b.workspace_id = ${t}
       AND b.harness_slug = split_part(l.src_ref, '#', 1)
       AND b.feature_id   = split_part(l.src_ref, '#', 2)
      JOIN harness_shared.harness_features_consolidated d
        ON d.workspace_id = ${t}
       AND d.harness_slug = split_part(l.dst_ref, '#', 1)
       AND d.feature_id   = split_part(l.dst_ref, '#', 2)
     WHERE l.workspace_id = ${h}
       AND l.rel = 'blocks'
       AND l.src_kind = 'feature'
       AND l.dst_kind = 'feature'
       AND b.status = ANY(${[...G]})
       AND d.status <> ALL(${[...W]})
     GROUP BY b.feature_id, b.harness_slug, b.status`;for(let c of s){let s=i.get(c.blocker_id);if(s&&s.escalation_msg_id&&(s.status===`stranded`||s.status===`cursed`))continue;let l=null;try{l=(await g(X,{severity:`blocker`,summary:`Stuck blocker ${c.blocker_id} is stranding ${c.downstream} downstream work-item(s)`,body:`Blocker ${c.blocker_id} (${c.blocker_harness}) is ${c.blocker_status} and gating ${c.downstream} non-terminal downstream work-item(s) — they cannot proceed until it resolves. Resolve, deprecate, or re-place the blocker to un-gate the downstream work. (mug-autonomous-execution B-09 / P-022)`})).msg_id}catch(e){console.warn(`[pot-placement-watchdog] stranded escalation failed for ${c.blocker_id}: ${e instanceof Error?e.message:e}`);continue}await R(e,{workspaceId:t,installSlug:n,workItemId:c.blocker_id,harnessSlug:c.blocker_harness,mugOwnerId:r,lastLossSpawnId:null,cupSpawnId:null,cupOwnerId:null,status:`stranded`,failCount:s?.fail_count??0,infraLossCount:s?.infra_loss_count??0,disposition:`stranded`,escalationMsgId:l,now:a}),o.push({workspaceId:t,installSlug:n,workItemId:c.blocker_id,decision:`stranded`,detail:`${c.downstream} downstream`})}return o}function H(e,t,n=Date.now()){let r={recovering:0,cursed:0,stranded:0,workingTracked:0,items:[]};for(let t of e){let e=Number(t.count)||0;t.status===`recovering`?r.recovering=e:t.status===`cursed`?r.cursed=e:t.status===`stranded`?r.stranded=e:t.status===`working`&&(r.workingTracked=e)}for(let e of t)if(e.status!==`working`){let t=e.updated_at==null?NaN:new Date(e.updated_at).getTime(),i=Number.isFinite(t)?Math.max(0,(n-t)/36e5):void 0,a=e.status===`recovering`&&i!=null&&i*36e5>=$,o=e.source_plan_item_ids?.[0],s=e.source_plan_slug&&o?`${e.source_plan_slug}#${o}`:null;r.items.push({workItemId:e.work_item_id,status:e.status,failCount:e.fail_count,harness:e.harness_slug,...i==null?{}:{ageHours:i},...a?{stale:!0}:{},...s?{planItem:s}:{}})}let i={recovering:0,stranded:1,cursed:2};return r.items.sort((e,t)=>(i[e.status]??3)-(i[t.status]??3)),r}async function he(e,t,n=20){let r={recovering:0,cursed:0,stranded:0,workingTracked:0,items:[]};try{let{sql:r}=s(),i=Math.max(1,Math.round(te/1e3));return H(await r`
      WITH live_holder AS (${T(r,i)}),
      live_open AS (
        SELECT p.status
          FROM harness_shared.pot_placements p
          LEFT JOIN harness_shared.harness_features_consolidated f
            ON f.workspace_id = p.workspace_id
           AND f.feature_id = p.work_item_id
         WHERE p.workspace_id = ${e}
           AND p.install_slug = ${t}
           AND p.status IN ('recovering', 'cursed', 'stranded', 'working')
           AND f.feature_id IS NOT NULL
           AND f.status <> ALL(${J}::text[])
           AND (
             p.status <> 'working'
             OR (
               f.taken_by IS NOT NULL
               AND f.taken_by <> ''
               AND EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = f.taken_by)
             )
           )
      )
      SELECT status, count(*)::int AS count
        FROM live_open
       GROUP BY status`,await r`
      WITH live_holder AS (${T(r,i)}),
      live_open AS (
        SELECT p.work_item_id, p.status, p.fail_count, p.harness_slug, p.updated_at,
               f.source_plan_slug, f.source_plan_item_ids
          FROM harness_shared.pot_placements p
          LEFT JOIN harness_shared.harness_features_consolidated f
            ON f.workspace_id = p.workspace_id
           AND f.feature_id = p.work_item_id
         WHERE p.workspace_id = ${e}
           AND p.install_slug = ${t}
           AND p.status IN ('recovering', 'cursed', 'stranded', 'working')
           AND f.feature_id IS NOT NULL
           AND f.status <> ALL(${J}::text[])
           AND (
             p.status <> 'working'
             OR (
               f.taken_by IS NOT NULL
               AND f.taken_by <> ''
               AND EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = f.taken_by)
             )
           )
      )
      SELECT work_item_id, status, fail_count, harness_slug, updated_at, source_plan_slug, source_plan_item_ids
        FROM live_open
       ORDER BY (status = 'cursed') DESC, (status = 'stranded') DESC, (status = 'recovering') DESC, updated_at DESC
       LIMIT ${n}`)}catch{return r}}var U,W,G,K,q,J,Y,X,Z,Q,$,ge=e((()=>{U=t(o(),1),c(),r(),a(),m(),C(),ae(),b(),_(),w(),x(),W=new Set([`passed`,`deprecated`,`resolved`,`closed`]),G=new Set([`failing`,`failed`]),K=new Set([`done`,`failed`,`cancelled`,`reaped`]),q=new Set([`blocked`,`needs-human`]),J=[...W,...q],Y=`system:pot-placement-watchdog`,X={ownerId:Y},Z=(()=>{let e=Number({}.PAPERCUSP_POT_ACTIVE_RECLAIM_WINDOW_MS??{}.PAPERCUSP_POT_ACTIVE_RECLAIM_WINDOW_MS??15*6e4);return Number.isFinite(e)&&e>=0?e:15*6e4})(),Q=new Set([`working`,`recovering`,`cursed`,`stranded`]),$=(()=>{let e=Number({}.PAPERCUSP_POT_PLACEMENT_STALE_MS??{}.PAPERCUSP_POT_PLACEMENT_STALE_MS??1440*6e4);return Number.isFinite(e)&&e>=0?e:1440*6e4})()}));export{L as _,H as a,F as c,j as d,A as f,se as g,ce as h,J as i,ge as l,z as m,$ as n,N as o,oe as p,Q as r,P as s,Z as t,M as u,he as v};