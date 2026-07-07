import{n as e}from"./chunk-CMxvf4Kt.js";import{a as t}from"./types-DCZF4nMP.js";import{t as n}from"./src-yYIF6EjN.js";import{a as r,c as i}from"./server-DI0C3bh-.js";import{q as a,t as o}from"./src-DTtGQmae.js";import{a as s,r as c,t as l}from"./operator-state-pg-CuOVF3AN.js";import{n as u,t as d}from"./registry-BQViYXxW.js";import{n as f,t as p}from"./event-log-DlTwD7ps.js";import{a as m,i as h,n as g}from"./escalations-SmNYpHZ6.js";import{c as _,o as v}from"./inbox-wake-CB2LXy1I.js";import{i as y,o as b}from"./started-MpHacYLq.js";import{u as x}from"./spawn-reclaim-B3SV6oDM.js";import{n as S,r as C,t as w}from"./work-items-stale-claims-Dzbus2Zl.js";function ee(){return k}async function te(){try{k=await c(`operator_hive_control_policy`)??{}}catch{}}async function T(){return await c(`operator_hive_control_policy`)??{}}async function E(e){await s(`operator_hive_control_policy`,e),k=e}async function D(){await E({})}var O,k,ne=e((()=>{l(),d(),O={breakerThreshold:3,recoveryDebounceMs:5*6e4,dormancyGraceMs:10*6e4,infraBreakerThreshold:12},k={},te(),u({name:`hive-control-policy`,description:`hive placement-watchdog thresholds (breaker / recovery-debounce / dormancy-grace / infra-breaker)`,auditAction:`pot:control_policy`,diff:async()=>{let e=await T(),t=[];for(let n of Object.keys(O))e[n]!==void 0&&t.push({key:n,effective:e[n],default:O[n],layer:`pg-settings`});return t},capture:()=>T(),reset:()=>D(),restore:e=>E(e??{})})}));function A(e){return e!=null&&G.has(e)}function j(e){return e!=null&&J.has(e)}function M(){let e=Number({}.PAPERCUSP_HIVE_PLACEMENT_BREAKER??3),t=Number({}.PAPERCUSP_HIVE_PLACEMENT_DEBOUNCE_MS??5*6e4),n=Number({}.PAPERCUSP_HIVE_PLACEMENT_DORMANCY_MS??10*6e4),r=Number({}.PAPERCUSP_HIVE_PLACEMENT_INFRA_BREAKER??12);return{breakerThreshold:Number.isFinite(e)&&e>=1?e:3,recoveryDebounceMs:Number.isFinite(t)&&t>=0?t:5*6e4,dormancyGraceMs:Number.isFinite(n)&&n>=0?n:10*6e4,infraBreakerThreshold:Number.isFinite(r)&&r>=1?r:12,...ee()}}function N(e,t){return e===`reaped`?!0:e===`failed`&&t!=null&&t.startsWith(`reclaimed:`)}function P(e){if(q.has(e.status))return`dead`;let{heartbeatAtMs:t,lastOutputAtMs:n,now:r}=e;return t!=null&&r-t>3e5?`dead`:n!=null&&r-n>6e5?`wedged`:`live`}function F(e,t){if(!e.unitExists)return{kind:`abandon`,reason:`unit no longer exists`};if(e.unitTerminal)return{kind:`completed`};if(e.hasLiveHolder)return{kind:`healthy`};if(e.unitParked)return{kind:`parked`,reason:`unit status is a deliberate park (e.g. blocked) — no holder expected`};if(e.placementStatus===`cursed`)return{kind:`latched`};if(e.placementStatus===`recovering`&&e.lastRecoveryAtMs!=null&&e.now-e.lastRecoveryAtMs<t.recoveryDebounceMs)return{kind:`debounced`};if(e.servingBeeReclaimedWhileActive)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,reason:`serving bee reaper-reclaimed while still active (slow-but-alive) — re-placing, not counting toward any breaker`};if(e.postDormancySweep)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,infraAttributed:!0,reason:`post-dormancy recovery sweep (operator/bg-host was down) — item-independent infra loss, fully exempt from both breakers (re-placing, not counting)`};if(e.hasServingBee===!1)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,reason:`no serving-bee attempt since the last loss — re-place only, nothing to count`};if(e.servingBeeSpawnId!=null&&e.lastLossSpawnId!=null&&e.servingBeeSpawnId===e.lastLossSpawnId)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,reason:`dead attempt ${e.servingBeeSpawnId} already counted — re-place only`};if(e.servingBeeMadeNoToolCalls){let n=e.infraLossCount+1;return n>=t.infraBreakerThreshold?{kind:`breaker`,nextFailCount:e.failCount,nextInfraLossCount:n,infraAttributed:!0,reason:`${n} no-fair-attempt (zombie) losses (>= infra breaker ${t.infraBreakerThreshold}) — serving bee made 0 tool calls`}:{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:n,infraAttributed:!0,reason:`serving bee made 0 tool calls (no-fair-attempt / zombie) — counted toward the bounded infra breaker, not the pathology breaker`}}let n=e.failCount+1;return n>=t.breakerThreshold?{kind:`breaker`,nextFailCount:n,nextInfraLossCount:e.infraLossCount,reason:`${n} failed placements (>= breaker threshold ${t.breakerThreshold})`}:{kind:`recover`,nextFailCount:n,nextInfraLossCount:e.infraLossCount,reason:`serving bee dead/stalled and the unit is not terminal`}}function I(e){return $.has(e.placementStatus)?e.unitExists?e.unitTerminal?`resolve-completed`:`keep`:`resolve-abandoned`:`keep`}function L(e){if(e==null)return null;let t=typeof e==`number`?e:Number(e);return Number.isFinite(t)?t:null}async function re(e,t,n){return(await e`
    SELECT coord_owner_id
      FROM harness_shared.adv_sessions
     WHERE workspace_id = ${t}
       AND label LIKE ${`hive · `+n+`/%`}
       AND coord_owner_id IS NOT NULL
     ORDER BY started_at DESC
     LIMIT 1`)[0]?.coord_owner_id??null}async function R(e,t,n){return(await e`
    SELECT DISTINCT coord_owner_id, max(started_at) AS started_at
      FROM harness_shared.adv_sessions
     WHERE workspace_id = ${t}
       AND label LIKE ${`hive · `+n+`/%`}
       AND coord_owner_id IS NOT NULL
     GROUP BY coord_owner_id
     ORDER BY started_at DESC`).map(e=>e.coord_owner_id)}async function z(e,t){let n=t.bumpRecovery?new Date(t.now).toISOString():null;await e`
    INSERT INTO harness_shared.hive_placements
      (workspace_id, install_slug, work_item_id, harness_slug, queen_owner_id,
       bee_spawn_id, bee_owner_id, status, fail_count, infra_loss_count, last_loss_spawn_id, last_disposition,
       escalation_msg_id, last_recovery_at, last_seen_at, updated_at)
    VALUES (
      ${t.workspaceId}, ${t.installSlug}, ${t.workItemId}, ${t.harnessSlug}, ${t.queenOwnerId},
      ${t.beeSpawnId}, ${t.beeOwnerId}, ${t.status}, ${t.failCount}, ${t.infraLossCount??0}, ${t.lastLossSpawnId}, ${t.disposition},
      ${t.escalationMsgId??null}, ${n}, ${new Date(t.now).toISOString()}, ${new Date(t.now).toISOString()}
    )
    ON CONFLICT (workspace_id, install_slug, work_item_id) DO UPDATE SET
      harness_slug      = COALESCE(EXCLUDED.harness_slug, harness_shared.hive_placements.harness_slug),
      queen_owner_id    = COALESCE(EXCLUDED.queen_owner_id, harness_shared.hive_placements.queen_owner_id),
      bee_spawn_id      = COALESCE(EXCLUDED.bee_spawn_id, harness_shared.hive_placements.bee_spawn_id),
      bee_owner_id      = COALESCE(EXCLUDED.bee_owner_id, harness_shared.hive_placements.bee_owner_id),
      status            = EXCLUDED.status,
      fail_count        = EXCLUDED.fail_count,
      infra_loss_count  = EXCLUDED.infra_loss_count,
      last_loss_spawn_id = EXCLUDED.last_loss_spawn_id,
      last_disposition  = EXCLUDED.last_disposition,
      escalation_msg_id = COALESCE(EXCLUDED.escalation_msg_id, harness_shared.hive_placements.escalation_msg_id),
      last_recovery_at  = COALESCE(EXCLUDED.last_recovery_at, harness_shared.hive_placements.last_recovery_at),
      last_seen_at      = EXCLUDED.last_seen_at,
      updated_at        = EXCLUDED.updated_at`}async function B(e={}){let n=[],i=e.deps?.getFlag??r,o=e.deps?.listStartedHives??b,s=e.deps?.getOrgPg??a,c=e.deps?.reconcileOneHive??V;try{if(!await i(t.HIVE_PLACEMENT_WATCHDOG,`system`))return n;let r=await o();if(r.length===0)return n;let{sql:a}=s(),l=e.now??Date.now(),u=M();for(let{workspaceId:e,installSlug:t}of r)try{n.push(...await c(a,e,t,u,l))}catch(e){console.warn(`[hive-placement-watchdog] hive ${t} failed: ${e instanceof Error?e.message:e}`)}}catch(e){console.warn(`[hive-placement-watchdog] sweep failed: ${e instanceof Error?e.message:e}`)}return n}async function V(e,t,n,r,i){let a=[],o=await R(e,t,n);if(o.length===0)return a;let s=o[0],c=await e`
    SELECT spawn_id, session_owner, feature_id, status, run_id, error_message,
           extract(epoch from heartbeat_at) * 1000 AS heartbeat_ms,
           extract(epoch from last_output_at) * 1000 AS last_output_ms
      FROM harness_shared.spawned_agents
     WHERE workspace_id = ${t}
       AND child_role IN ('bee', 'cup')
       AND parent_spawn_id = ANY(${o})`,l=[...new Set(c.map(e=>e.run_id).filter(e=>!!e))],u=new Set;if(l.length>0){let n=await e`
      SELECT DISTINCT run_id
        FROM harness_shared.agent_usage_samples
       WHERE workspace_id = ${t}
         AND run_id = ANY(${l})
         AND ts >= ${i-Q}`;for(let e of n)e.run_id&&u.add(e.run_id)}let d=[...new Set(c.map(e=>e.session_owner||e.spawn_id))],f=new Set;if(d.length>0){let n=await e`
      SELECT DISTINCT owner_id
        FROM harness_shared.agent_activity
       WHERE workspace_id = ${t}
         AND owner_id = ANY(${d})
         AND kind = 'tool'`;for(let e of n)f.add(e.owner_id)}let p=c.map(e=>e.spawn_id),m=new Set;if(p.length>0){let n=await e`
      SELECT DISTINCT spawn_id
        FROM harness_shared.tool_invocations
       WHERE workspace_id = ${t}
         AND spawn_id = ANY(${p})`;for(let e of n)m.add(e.spawn_id)}let h=new Map;for(let e of c){let t=e.session_owner||e.spawn_id,n=e.run_id!=null&&u.has(e.run_id),r={spawnId:e.spawn_id,ownerId:t,featureId:e.feature_id,liveness:P({status:e.status,heartbeatAtMs:L(e.heartbeat_ms),lastOutputAtMs:L(e.last_output_ms),now:i}),reclaimedWhileActive:n&&(e.status===`running`||e.status===`restarting`||N(e.status,e.error_message)),madeNoToolCalls:!f.has(t)&&!m.has(e.spawn_id)};h.set(t,r),h.set(e.spawn_id,r)}let g=[...new Set(c.map(e=>e.session_owner||e.spawn_id))],_=new Set;for(let e of c)e.feature_id&&_.add(e.feature_id);if(g.length>0){let n=await e`
      SELECT feature_id FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t} AND taken_by = ANY(${g})`;for(let e of n)_.add(e.feature_id)}let v=await e`
    SELECT work_item_id, status, fail_count, infra_loss_count,
           extract(epoch from last_recovery_at) * 1000 AS last_recovery_ms,
           last_loss_spawn_id,
           escalation_msg_id,
           extract(epoch from last_seen_at) * 1000 AS last_seen_ms
      FROM harness_shared.hive_placements
     WHERE workspace_id = ${t} AND install_slug = ${n}`,y=new Map(v.map(e=>[e.work_item_id,e])),b=v.reduce((e,t)=>Math.max(e,L(t.last_seen_ms)??0),0),x=b>0&&i-b>r.dormancyGraceMs;if(_.size>0){let o=[..._],l=await e`
      SELECT feature_id, harness_slug, status, taken_by
        FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t} AND feature_id = ANY(${o})`,u=new Map(l.map(e=>[e.feature_id,e]));for(let l of o){let o=u.get(l),d=y.get(l),f=o?.taken_by?h.get(o.taken_by):void 0,p=c.find(e=>e.feature_id===l),m=p?h.get(p.session_owner||p.spawn_id):void 0,g=f??m,_=f?.liveness===`live`||m?.liveness===`live`,v=!_&&(f?.reclaimedWhileActive===!0||m?.reclaimedWhileActive===!0),b=!_&&(f?.madeNoToolCalls===!0||m?.madeNoToolCalls===!0),S={workItemId:l,unitExists:!!o,unitTerminal:A(o?.status),hasLiveHolder:_,failCount:d?.fail_count??0,infraLossCount:d?.infra_loss_count??0,placementStatus:d?.status??null,lastRecoveryAtMs:d?.last_recovery_ms??null,hasServingBee:g!=null,servingBeeSpawnId:g?.spawnId??null,lastLossSpawnId:d?.last_loss_spawn_id??null,servingBeeReclaimedWhileActive:v,servingBeeMadeNoToolCalls:b,postDormancySweep:x,unitParked:j(o?.status),now:i},C=F(S,r),w={workspaceId:t,installSlug:n,workItemId:l,harnessSlug:o?.harness_slug??null,queenOwnerId:s,beeSpawnId:g?.spawnId??null,beeOwnerId:g?.ownerId??null,now:i};switch(C.kind){case`healthy`:await z(e,{...w,status:`working`,failCount:S.failCount,infraLossCount:S.infraLossCount,lastLossSpawnId:null,disposition:`working`});break;case`completed`:if(d?.status!==`completed`&&(d?.escalation_msg_id&&await U(d.escalation_msg_id,l),await z(e,{...w,status:`completed`,failCount:S.failCount,infraLossCount:S.infraLossCount,lastLossSpawnId:null,disposition:`completed`}),a.push({workspaceId:t,installSlug:n,workItemId:l,decision:`completed`}),w.harnessSlug)){let r=await ae(e,t,w.harnessSlug,l);r>0&&(await oe(t,s,l,w.harnessSlug,r),a.push({workspaceId:t,installSlug:n,workItemId:l,decision:`unblocked`,detail:`${r} downstream`}))}break;case`parked`:d?.status!==`blocked`&&(d?.escalation_msg_id&&await U(d.escalation_msg_id,l),await z(e,{...w,status:`blocked`,failCount:S.failCount,infraLossCount:S.infraLossCount,lastLossSpawnId:null,disposition:`parked`}));break;case`recover`:await z(e,{...w,status:`recovering`,failCount:C.nextFailCount,infraLossCount:C.nextInfraLossCount,lastLossSpawnId:C.nextFailCount>S.failCount||C.nextInfraLossCount>S.infraLossCount?g?.spawnId??d?.last_loss_spawn_id??null:d?.last_loss_spawn_id??null,disposition:`recover`,bumpRecovery:!0}),C.infraAttributed||await ie(t,s,l,w.harnessSlug,C.nextFailCount),a.push({workspaceId:t,installSlug:n,workItemId:l,decision:`recover`,detail:`attempt ${C.nextFailCount}`});break;case`breaker`:{let r=C.infraAttributed?null:await se(l,w.harnessSlug,C.nextFailCount);await z(e,{...w,status:`cursed`,failCount:C.nextFailCount,lastLossSpawnId:g?.spawnId??d?.last_loss_spawn_id??null,infraLossCount:C.nextInfraLossCount,disposition:`breaker`,escalationMsgId:r}),a.push({workspaceId:t,installSlug:n,workItemId:l,decision:`breaker`,detail:C.reason});break}case`latched`:await z(e,{...w,status:`cursed`,failCount:S.failCount,lastLossSpawnId:d?.last_loss_spawn_id??null,infraLossCount:S.infraLossCount,disposition:`breaker`}),a.push({workspaceId:t,installSlug:n,workItemId:l,decision:`latched`,detail:`cursed, halted (fail_count ${S.failCount} frozen)`});break;case`debounced`:await z(e,{...w,status:`recovering`,failCount:S.failCount,lastLossSpawnId:d?.last_loss_spawn_id??null,infraLossCount:S.infraLossCount,disposition:`recover`});break;case`abandon`:d&&d.status!==`abandoned`&&d.status!==`completed`&&await z(e,{...w,status:`abandoned`,failCount:S.failCount,infraLossCount:S.infraLossCount,lastLossSpawnId:null,disposition:`abandoned`});break}}}return a.push(...await le(e,t,n,s,y,i)),a.push(...await ce(e,t,n,i)),a}async function ie(e,t,n,r,i){try{await _([t],{summary:`Placement watchdog: work-item ${n}${r?` (${r})`:``} is not terminal but its bee is dead/stalled (placement attempt ${i}) — re-place or recover it.`,payload:{kind:`placement-recovery`,workItemId:n,harness:r,attempt:i},source:`hive-placement-watchdog`,workspaceId:e})}catch(e){console.warn(`[hive-placement-watchdog] recovery wake failed for ${n}: ${e instanceof Error?e.message:e}`)}}async function ae(e,t,n,r){return(await e`
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
       AND d.status <> ALL(${[...G]})`)[0]?.downstream??0}async function oe(e,t,n,r,i){try{await _([t],{summary:`Placement watchdog: ${n}${r?` (${r})`:``} completed and un-gated ${i} downstream lane(s) — survey + place the next wave batch.`,payload:{kind:`placement-unblocked`,workItemId:n,harness:r,downstream:i},source:`hive-placement-watchdog`,workspaceId:e})}catch(e){console.warn(`[hive-placement-watchdog] unblock wake failed for ${n}: ${e instanceof Error?e.message:e}`)}}async function se(e,t,n){try{return(await h(Z,{severity:`advisory`,summary:`Cursed placement: ${e} failed ${n}× — stopped auto-re-placing`,body:`Work-item ${e}${t?` (${t})`:``} has been placed and lost ${n} times without reaching a terminal state. Per the cursed-item circuit breaker (queen-autonomous-execution B-09 / P-021) the Queen has STOPPED auto-re-placing it. Investigate it (ill-specified? wedging bees?) then re-place, deprecate, or split it. Re-placing clears the breaker when it next completes.`})).msg_id}catch(t){return console.warn(`[hive-placement-watchdog] cursed escalation failed for ${e}: ${t instanceof Error?t.message:t}`),null}}async function H(e,t,n){if(e)try{await m({msg_id:e,choice:`item-now-terminal`,resolver:X,note:n})}catch(e){console.warn(`[hive-placement-watchdog] resolving placement escalation failed for ${t}: ${e instanceof Error?e.message:e}`)}}async function U(e,t){await H(e,t,`auto-resolved: work-item ${t} reached terminal state, cursed advisory is no longer relevant`)}async function ce(e,t,n,r){let i=[],a=await e`
    SELECT work_item_id, status, escalation_msg_id, harness_slug, fail_count
      FROM harness_shared.hive_placements
     WHERE workspace_id = ${t}
       AND install_slug = ${n}
       AND status IN ('working', 'recovering', 'cursed', 'stranded')`;if(a.length===0)return i;let o=await e`
    SELECT feature_id, status
      FROM harness_shared.harness_features_consolidated
     WHERE workspace_id = ${t} AND feature_id = ANY(${[...new Set(a.map(e=>e.work_item_id))]})`,s=new Map(o.map(e=>[e.feature_id,e.status]));for(let o of a){let a=s.get(o.work_item_id),c=I({placementStatus:o.status,unitExists:a!=null,unitTerminal:A(a)});if(c===`keep`)continue;let l=c===`resolve-completed`;o.escalation_msg_id&&await H(o.escalation_msg_id,o.work_item_id,l?`auto-resolved (placement GC, EI-1524): work-item ${o.work_item_id} reached terminal state (${a}); the ${o.status} advisory is no longer relevant`:`auto-resolved (placement GC, EI-1524): work-item ${o.work_item_id} no longer exists; the ${o.status} advisory is no longer relevant`),await z(e,{workspaceId:t,installSlug:n,workItemId:o.work_item_id,harnessSlug:o.harness_slug,queenOwnerId:null,lastLossSpawnId:null,beeSpawnId:null,beeOwnerId:null,status:l?`completed`:`abandoned`,failCount:o.fail_count,disposition:l?`completed`:`abandoned`,now:r}),i.push({workspaceId:t,installSlug:n,workItemId:o.work_item_id,decision:l?`completed`:`abandon`,detail:`gc: stale ${o.status} placement reconciled (unit ${l?a:`gone`})`})}return i}async function le(e,t,n,r,i,a){let o=[],s=await e`
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
     WHERE l.workspace_id = ${f}
       AND l.rel = 'blocks'
       AND l.src_kind = 'feature'
       AND l.dst_kind = 'feature'
       AND b.status = ANY(${[...K]})
       AND d.status <> ALL(${[...G]})
     GROUP BY b.feature_id, b.harness_slug, b.status`;for(let c of s){let s=i.get(c.blocker_id);if(s&&s.escalation_msg_id&&(s.status===`stranded`||s.status===`cursed`))continue;let l=null;try{l=(await h(Z,{severity:`blocker`,summary:`Stuck blocker ${c.blocker_id} is stranding ${c.downstream} downstream work-item(s)`,body:`Blocker ${c.blocker_id} (${c.blocker_harness}) is ${c.blocker_status} and gating ${c.downstream} non-terminal downstream work-item(s) — they cannot proceed until it resolves. Resolve, deprecate, or re-place the blocker to un-gate the downstream work. (queen-autonomous-execution B-09 / P-022)`})).msg_id}catch(e){console.warn(`[hive-placement-watchdog] stranded escalation failed for ${c.blocker_id}: ${e instanceof Error?e.message:e}`);continue}await z(e,{workspaceId:t,installSlug:n,workItemId:c.blocker_id,harnessSlug:c.blocker_harness,queenOwnerId:r,lastLossSpawnId:null,beeSpawnId:null,beeOwnerId:null,status:`stranded`,failCount:s?.fail_count??0,infraLossCount:s?.infra_loss_count??0,disposition:`stranded`,escalationMsgId:l,now:a}),o.push({workspaceId:t,installSlug:n,workItemId:c.blocker_id,decision:`stranded`,detail:`${c.downstream} downstream`})}return o}function W(e,t){let n={recovering:0,cursed:0,stranded:0,workingTracked:0,items:[]};for(let t of e){let e=Number(t.count)||0;t.status===`recovering`?n.recovering=e:t.status===`cursed`?n.cursed=e:t.status===`stranded`?n.stranded=e:t.status===`working`&&(n.workingTracked=e)}for(let e of t)e.status!==`working`&&n.items.push({workItemId:e.work_item_id,status:e.status,failCount:e.fail_count,harness:e.harness_slug});let r={recovering:0,stranded:1,cursed:2};return n.items.sort((e,t)=>(r[e.status]??3)-(r[t.status]??3)),n}async function ue(e,t,n=20){let r={recovering:0,cursed:0,stranded:0,workingTracked:0,items:[]};try{let{sql:r}=a(),i=Math.max(1,Math.round(w/1e3));return W(await r`
      WITH live_holder AS (${C(r,i)}),
      live_open AS (
        SELECT p.status
          FROM harness_shared.hive_placements p
          LEFT JOIN harness_shared.harness_features_consolidated f
            ON f.workspace_id = p.workspace_id
           AND f.feature_id = p.work_item_id
         WHERE p.workspace_id = ${e}
           AND p.install_slug = ${t}
           AND p.status IN ('recovering', 'cursed', 'stranded', 'working')
           AND f.feature_id IS NOT NULL
           AND f.status <> ALL(${Y}::text[])
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
      WITH live_holder AS (${C(r,i)}),
      live_open AS (
        SELECT p.work_item_id, p.status, p.fail_count, p.harness_slug, p.updated_at
          FROM harness_shared.hive_placements p
          LEFT JOIN harness_shared.harness_features_consolidated f
            ON f.workspace_id = p.workspace_id
           AND f.feature_id = p.work_item_id
         WHERE p.workspace_id = ${e}
           AND p.install_slug = ${t}
           AND p.status IN ('recovering', 'cursed', 'stranded', 'working')
           AND f.feature_id IS NOT NULL
           AND f.status <> ALL(${Y}::text[])
           AND (
             p.status <> 'working'
             OR (
               f.taken_by IS NOT NULL
               AND f.taken_by <> ''
               AND EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = f.taken_by)
             )
           )
      )
      SELECT work_item_id, status, fail_count, harness_slug
        FROM live_open
       ORDER BY (status = 'cursed') DESC, (status = 'stranded') DESC, (status = 'recovering') DESC, updated_at DESC
       LIMIT ${n}`)}catch{return r}}var G,K,q,J,Y,X,Z,Q,$,de=e((()=>{o(),n(),i(),p(),x(),ne(),v(),g(),S(),y(),G=new Set([`passed`,`deprecated`,`resolved`,`closed`]),K=new Set([`failing`,`failed`]),q=new Set([`done`,`failed`,`cancelled`,`reaped`]),J=new Set([`blocked`,`needs-human`]),Y=[...G,...J],X=`system:hive-placement-watchdog`,Z={ownerId:X},Q=(()=>{let e=Number({}.PAPERCUSP_HIVE_ACTIVE_RECLAIM_WINDOW_MS??15*6e4);return Number.isFinite(e)&&e>=0?e:15*6e4})(),$=new Set([`working`,`recovering`,`cursed`,`stranded`])}));export{ue as _,P as a,de as c,A as d,M as f,R as g,re as h,W as i,N as l,V as m,$ as n,F as o,B as p,Y as r,I as s,Q as t,j as u};