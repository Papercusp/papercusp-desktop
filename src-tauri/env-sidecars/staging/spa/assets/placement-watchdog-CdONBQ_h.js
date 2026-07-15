const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/messages-C_tjUcq7.js","assets/inbox-wake-FHA4AOMR.js","assets/chunk-CMxvf4Kt.js","assets/preload-helper-B_k_wMTD.js","assets/coordination-event-log-browser-Dq_4i-_C.js","assets/server-Dbwl6Oih.js","assets/types-qZw2Z8cE.js","assets/src-C_84UHfx.js","assets/src-CXfdPlCB.js","assets/resource-profile-CXmc9pS7.js","assets/node-module-browser-BIpJATUS.js","assets/__vite-browser-external-CM3Eme-n.js","assets/capabilities-BpsWJoOK.js","assets/core-CjsvDKdj.js","assets/presence-CCK7Qlg-.js","assets/src-C4H77EbW.js","assets/postgres-browser-zd-i1BMX.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js","assets/fleet-membership-store-BDt16a06.js","assets/loop-B4UipG2-.js","assets/cron-wBe2AScZ.js","assets/adv-sessions-C2D_r2j4.js","assets/workspace-registry-Bu1Yy540.js","assets/workspace-als-DigME466.js","assets/async-hooks-browser-DZKl_0H0.js","assets/workspace-id-constant-E7VkkAiJ.js","assets/store-D0vO-4u5.js","assets/src-C0H6dNEO.js","assets/src-DiYBo7B9.js","assets/pg-stores-CWOX7LyR.js","assets/src-JzXh1jLw.js","assets/src-9yr5ozZ_.js","assets/state-delta--NOtocKv.js","assets/dist-my0R2Zxl.js","assets/ajv-CnoU_sk2.js","assets/fast-deep-equal-Dcq5VDmq.js","assets/v4-C8N3IZYz.js","assets/agent-hnpgBZja.js","assets/no-subagent-deny-Bbj-DFPz.js","assets/session-launch-dirs-B6qZOuj4.js","assets/agent-fleets-store-D1kSKHkg.js","assets/fanout-delivery-BlO1aGZE.js","assets/log-Dva9zheJ.js","assets/flag-distinct-id-BZ5cCTSq.js","assets/federation-scope-BmspdCpl.js","assets/harness-registry-BDAgv6Ft.js","assets/operator-state-pg-MCzytYT1.js","assets/db-encryption-Cexy6VC7.js","assets/hive-directory-meta-DmRa3Q28.js","assets/hive-store-Cna6O5v1.js","assets/machine-authored-CZmWpnxp.js","assets/pending-wakes-o1Fp3nNV.js","assets/presence-fleet-D2ptcnAX.js","assets/wake-mode-DyaLMmOY.js","assets/carry-note-BwBOWEpq.js","assets/context-doors-config-Dz_9IMEG.js","assets/registry-BQViYXxW.js","assets/context-doors-B739ZILn.js","assets/store-B2H8hvQI.js","assets/psu-pty-discovery-CVTxiPp2.js","assets/assignments-Lq8xFte3.js","assets/omp-sessions-Cl5quld_.js","assets/pg-transient-retry-DaH-NVVQ.js","assets/rate-limit-config-CTyiGEjK.js","assets/src-9yZgxa51.js","assets/session-archive-CenpJ8wA.js","assets/session-presence-store-BQ94-Q4k.js","assets/turn-provenance-DGDbthsM.js","assets/workspace-als-B8q-suND.js"])))=>i.map(i=>d[i]);
import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{n,t as r}from"./preload-helper-B_k_wMTD.js";import{s as i}from"./types-qZw2Z8cE.js";import{t as a}from"./src-C_84UHfx.js";import{a as o,c as s}from"./server-Dbwl6Oih.js";import{t as c}from"./__vite-browser-external-CM3Eme-n.js";import{J as l,t as u}from"./src-C4H77EbW.js";import{a as d,r as f,t as p}from"./operator-state-pg-MCzytYT1.js";import{n as m,t as h}from"./registry-BQViYXxW.js";import{r as g,t as _}from"./coordination-event-log-browser-Dq_4i-_C.js";import{a as v,n as y,o as b}from"./escalations-DWR_ntNy.js";import{c as x,o as S}from"./inbox-wake-FHA4AOMR.js";import{i as C,o as w}from"./started-DGJ4xoBr.js";import{d as ee,m as te}from"./spawn-reclaim-CJ2fItsi.js";import{n as ne,r as T,t as re}from"./work-items-stale-claims-BSoj6Sxt.js";function ie(){return O}async function ae(){try{O=await f(`operator_pot_control_policy`)??{}}catch{}}async function oe(){return await f(`operator_pot_control_policy`)??{}}async function E(e){await d(`operator_pot_control_policy`,e),O=e}async function se(){await E({})}var D,O,ce=e((()=>{p(),h(),D={breakerThreshold:3,recoveryDebounceMs:5*6e4,dormancyGraceMs:10*6e4,infraBreakerThreshold:12},O={},ae(),m({name:`pot-control-policy`,description:`pot placement-watchdog thresholds (breaker / recovery-debounce / dormancy-grace / infra-breaker)`,auditAction:`pot:control_policy`,diff:async()=>{let e=await oe(),t=[];for(let n of Object.keys(D))e[n]!==void 0&&t.push({key:n,effective:e[n],default:D[n],layer:`pg-settings`});return t},capture:()=>oe(),reset:()=>se(),restore:e=>E(e??{})})}));function k(e){return e!=null&&U.has(e)}function A(e){return e!=null&&K.has(e)}function le(){let e=Number({}.PAPERCUSP_POT_PLACEMENT_BREAKER??{}.PAPERCUSP_POT_PLACEMENT_BREAKER??3),t=Number({}.PAPERCUSP_POT_PLACEMENT_DEBOUNCE_MS??{}.PAPERCUSP_POT_PLACEMENT_DEBOUNCE_MS??5*6e4),n=Number({}.PAPERCUSP_POT_PLACEMENT_DORMANCY_MS??{}.PAPERCUSP_POT_PLACEMENT_DORMANCY_MS??10*6e4),r=Number({}.PAPERCUSP_POT_PLACEMENT_INFRA_BREAKER??{}.PAPERCUSP_POT_PLACEMENT_INFRA_BREAKER??12);return{breakerThreshold:Number.isFinite(e)&&e>=1?e:3,recoveryDebounceMs:Number.isFinite(t)&&t>=0?t:5*6e4,dormancyGraceMs:Number.isFinite(n)&&n>=0?n:10*6e4,infraBreakerThreshold:Number.isFinite(r)&&r>=1?r:12,...ie()}}function ue(e,t){return e===`reaped`?!0:e===`failed`&&t!=null&&t.startsWith(`reclaimed:`)}function j(e){if(G.has(e.status))return`dead`;let{heartbeatAtMs:t,lastOutputAtMs:n,now:r,confirmedAliveSameHost:i}=e;return t!=null&&r-t>3e5&&!i?`dead`:n!=null&&r-n>6e5?`wedged`:`live`}function M(e,t){if(!e.unitExists)return{kind:`abandon`,reason:`unit no longer exists`};if(e.unitTerminal)return{kind:`completed`};if(e.hasLiveHolder)return{kind:`healthy`};if(e.unitParked)return{kind:`parked`,reason:`unit status is a deliberate park (e.g. blocked) — no holder expected`};if(e.placementStatus===`cursed`||e.placementStatus===`stranded`)return{kind:`latched`};if(e.placementStatus===`recovering`&&e.recoveryStartedAtMs!=null&&e.now-e.recoveryStartedAtMs>=$)return{kind:`stale-recovery`,reason:`recovery made no progress for at least ${Math.round($/36e5)}h`};if(e.placementStatus===`recovering`&&e.lastRecoveryAtMs!=null&&e.now-e.lastRecoveryAtMs<t.recoveryDebounceMs)return{kind:`debounced`};if(e.servingCupReclaimedWhileActive)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,reason:`serving cup reaper-reclaimed while still active (slow-but-alive) — re-placing, not counting toward any breaker`};if(e.postDormancySweep)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,infraAttributed:!0,reason:`post-dormancy recovery sweep (operator/bg-host was down) — item-independent infra loss, fully exempt from both breakers (re-placing, not counting)`};if(e.hasServingCup===!1)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,reason:`no serving-cup attempt since the last loss — re-place only, nothing to count`};if(e.servingCupSpawnId!=null&&e.lastLossSpawnId!=null&&e.servingCupSpawnId===e.lastLossSpawnId)return{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:e.infraLossCount,reason:`dead attempt ${e.servingCupSpawnId} already counted — re-place only`};if(e.servingCupMadeNoToolCalls){let n=e.infraLossCount+1;return n>=t.infraBreakerThreshold?{kind:`breaker`,nextFailCount:e.failCount,nextInfraLossCount:n,infraAttributed:!0,reason:`${n} no-fair-attempt (zombie) losses (>= infra breaker ${t.infraBreakerThreshold}) — serving cup made 0 tool calls`}:{kind:`recover`,nextFailCount:e.failCount,nextInfraLossCount:n,infraAttributed:!0,reason:`serving cup made 0 tool calls (no-fair-attempt / zombie) — counted toward the bounded infra breaker, not the pathology breaker`}}let n=e.failCount+1;return n>=t.breakerThreshold?{kind:`breaker`,nextFailCount:n,nextInfraLossCount:e.infraLossCount,reason:`${n} failed placements (>= breaker threshold ${t.breakerThreshold})`}:{kind:`recover`,nextFailCount:n,nextInfraLossCount:e.infraLossCount,reason:`serving cup dead/stalled and the unit is not terminal`}}function N(e){return Z.has(e.placementStatus)?e.unitExists?e.unitTerminal?`resolve-completed`:`keep`:`resolve-abandoned`:`keep`}function P(e){if(e==null)return null;let t=typeof e==`number`?e:Number(e);return Number.isFinite(t)?t:null}async function de(e,t,n){return(await e`
    SELECT coord_owner_id
      FROM harness_shared.adv_sessions
     WHERE workspace_id = ${t}
       AND label LIKE ${`pot · `+n+`/%`}
       AND coord_owner_id IS NOT NULL
     ORDER BY started_at DESC
     LIMIT 1`)[0]?.coord_owner_id??null}async function F(e){let t={logicalAlias:Q,concreteOwnerId:e.mugOwner,source:e.source};if(e.mugOwner)try{await x([e.mugOwner],{summary:e.summary,payload:{...typeof e.payload==`object`&&e.payload!==null?e.payload:{},mugWake:t},source:e.source,workspaceId:e.workspaceId})}catch(t){console.warn(`[mug-wake] direct wake failed for ${e.mugOwner}: ${t instanceof Error?t.message:t}`)}try{let[{sendMessage:n},{runWithWorkspace:i}]=await Promise.all([r(()=>import(`./messages-C_tjUcq7.js`),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68])),r(()=>import(`./workspace-als-B8q-suND.js`),__vite__mapDeps([69,24,2,25]))]);await i(e.workspaceId,()=>n({ownerId:e.source,ownerLabel:e.source,source:`static-client`,workspaceId:e.workspaceId,userId:null},{to:[Q],summary:e.summary,body:e.body??e.summary,harnessSlug:e.harnessSlug,extra:{mugWake:t}}))}catch(e){console.warn(`[mug-wake] ${Q} park failed: ${e instanceof Error?e.message:e}`)}}async function I(e,t,n){return(await e`
    SELECT DISTINCT coord_owner_id, max(started_at) AS started_at
      FROM harness_shared.adv_sessions
     WHERE workspace_id = ${t}
       AND label LIKE ${`pot · `+n+`/%`}
       AND coord_owner_id IS NOT NULL
     GROUP BY coord_owner_id
     ORDER BY started_at DESC`).map(e=>e.coord_owner_id)}async function L(e,t){let n=t.bumpRecovery?new Date(t.now).toISOString():null,r=t.status===`recovering`?new Date(t.now).toISOString():null;await e`
    INSERT INTO harness_shared.pot_placements
      (workspace_id, install_slug, work_item_id, harness_slug, mug_owner_id,
       cup_spawn_id, cup_owner_id, status, fail_count, infra_loss_count, last_loss_spawn_id, last_disposition,
       escalation_msg_id, last_recovery_at, recovery_started_at, last_seen_at, updated_at)
    VALUES (
      ${t.workspaceId}, ${t.installSlug}, ${t.workItemId}, ${t.harnessSlug}, ${t.mugOwnerId},
      ${t.cupSpawnId}, ${t.cupOwnerId}, ${t.status}, ${t.failCount}, ${t.infraLossCount??0}, ${t.lastLossSpawnId}, ${t.disposition},
      ${t.escalationMsgId??null}, ${n}, ${r}, ${new Date(t.now).toISOString()}, ${new Date(t.now).toISOString()}
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
      recovery_started_at = CASE
        WHEN EXCLUDED.status = 'recovering' THEN
          CASE
            WHEN harness_shared.pot_placements.status = 'recovering'
              THEN COALESCE(harness_shared.pot_placements.recovery_started_at, EXCLUDED.recovery_started_at)
            ELSE EXCLUDED.recovery_started_at
          END
        ELSE NULL
      END,
      last_seen_at      = EXCLUDED.last_seen_at,
      updated_at        = EXCLUDED.updated_at`}async function fe(e={}){let t=[],n=e.deps?.getFlag??o,r=e.deps?.listStartedPots??w,a=e.deps?.getOrgPg??l,s=e.deps?.reconcileOnePot??R;try{if(!await n(i.POT_PLACEMENT_WATCHDOG,`system`))return t;let o=await r();if(o.length===0)return t;let{sql:c}=a(),l=e.now??Date.now(),u=le();for(let{workspaceId:e,installSlug:n}of o)try{t.push(...await s(c,e,n,u,l))}catch(e){console.warn(`[pot-placement-watchdog] pot ${n} failed: ${e instanceof Error?e.message:e}`)}}catch(e){console.warn(`[pot-placement-watchdog] sweep failed: ${e instanceof Error?e.message:e}`)}return t}async function R(e,t,n,r,i,a=te){let o=[],s=await I(e,t,n);if(s.length===0)return o;let c=s[0],l=await e`
    SELECT spawn_id, session_owner, feature_id, status, run_id, error_message, pid, launcher_host,
           extract(epoch from heartbeat_at) * 1000 AS heartbeat_ms,
           extract(epoch from last_output_at) * 1000 AS last_output_ms
      FROM harness_shared.spawned_agents
     WHERE workspace_id = ${t}
       AND child_role = 'cup'
       AND parent_spawn_id = ANY(${s})`,u=(0,H.hostname)(),d=new Map;for(let e of l){let t=e.session_owner||e.spawn_id;if(e.launcher_host!==u||e.pid==null)continue;let n=(e.run_id??``).startsWith(`launch-`)||e.spawn_id.startsWith(`durable-spawn:`)?`launch`:`spawn`;a(e.pid,n)&&(d.set(t,!0),d.set(e.spawn_id,!0))}let f=[...new Set(l.map(e=>e.run_id).filter(e=>!!e))],p=new Set;if(f.length>0){let n=await e`
      SELECT DISTINCT run_id
        FROM harness_shared.agent_usage_samples
       WHERE workspace_id = ${t}
         AND run_id = ANY(${f})
         AND ts >= ${i-X}`;for(let e of n)e.run_id&&p.add(e.run_id)}let m=[...new Set(l.map(e=>e.session_owner||e.spawn_id))],h=new Set;if(m.length>0){let n=await e`
      SELECT DISTINCT owner_id
        FROM harness_shared.agent_activity
       WHERE workspace_id = ${t}
         AND owner_id = ANY(${m})
         AND kind = 'tool'`;for(let e of n)h.add(e.owner_id)}let g=l.map(e=>e.spawn_id),_=new Set;if(g.length>0){let n=await e`
      SELECT DISTINCT spawn_id
        FROM harness_shared.tool_invocations
       WHERE workspace_id = ${t}
         AND spawn_id = ANY(${g})`;for(let e of n)_.add(e.spawn_id)}let v=new Map;for(let e of l){let t=e.session_owner||e.spawn_id,n=e.run_id!=null&&p.has(e.run_id),r={spawnId:e.spawn_id,ownerId:t,featureId:e.feature_id,liveness:j({status:e.status,heartbeatAtMs:P(e.heartbeat_ms),lastOutputAtMs:P(e.last_output_ms),now:i,confirmedAliveSameHost:d.get(e.spawn_id)===!0}),reclaimedWhileActive:n&&(e.status===`running`||e.status===`restarting`||ue(e.status,e.error_message)),madeNoToolCalls:!h.has(t)&&!_.has(e.spawn_id)};v.set(t,r),v.set(e.spawn_id,r)}let y=[...new Set(l.map(e=>e.session_owner||e.spawn_id))],b=new Set;for(let e of l)e.feature_id&&b.add(e.feature_id);if(y.length>0){let n=await e`
      SELECT feature_id FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t} AND taken_by = ANY(${y})`;for(let e of n)b.add(e.feature_id)}let x=await e`
    SELECT work_item_id, status, fail_count, infra_loss_count,
           extract(epoch from last_recovery_at) * 1000 AS last_recovery_ms,
           extract(epoch from recovery_started_at) * 1000 AS recovery_started_ms,
           last_loss_spawn_id,
           escalation_msg_id,
           extract(epoch from last_seen_at) * 1000 AS last_seen_ms
      FROM harness_shared.pot_placements
     WHERE workspace_id = ${t} AND install_slug = ${n}`,S=new Map(x.map(e=>[e.work_item_id,e]));for(let e of x)Z.has(e.status)&&b.add(e.work_item_id);let C=x.reduce((e,t)=>Math.max(e,P(t.last_seen_ms)??0),0),w=C>0&&i-C>r.dormancyGraceMs;if(b.size>0){let a=[...b],s=await e`
      SELECT feature_id, harness_slug, status, taken_by
        FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t} AND feature_id = ANY(${a})`,u=new Map(s.map(e=>[e.feature_id,e]));for(let s of a){let a=u.get(s),d=S.get(s),f=a?.taken_by?v.get(a.taken_by):void 0,p=l.find(e=>e.feature_id===s),m=p?v.get(p.session_owner||p.spawn_id):void 0,h=f??m,g=f?.liveness===`live`||m?.liveness===`live`,_=!g&&(f?.reclaimedWhileActive===!0||m?.reclaimedWhileActive===!0),y=!g&&(f?.madeNoToolCalls===!0||m?.madeNoToolCalls===!0),b={workItemId:s,unitExists:!!a,unitTerminal:k(a?.status),hasLiveHolder:g,failCount:d?.fail_count??0,infraLossCount:d?.infra_loss_count??0,placementStatus:d?.status??null,lastRecoveryAtMs:d?.last_recovery_ms??null,recoveryStartedAtMs:d?.recovery_started_ms??null,hasServingCup:h!=null,servingCupSpawnId:h?.spawnId??null,lastLossSpawnId:d?.last_loss_spawn_id??null,servingCupReclaimedWhileActive:_,servingCupMadeNoToolCalls:y,postDormancySweep:w,unitParked:A(a?.status),now:i},x=M(b,r),C={workspaceId:t,installSlug:n,workItemId:s,harnessSlug:a?.harness_slug??null,mugOwnerId:c,cupSpawnId:h?.spawnId??null,cupOwnerId:h?.ownerId??null,now:i};switch(x.kind){case`healthy`:d?.status===`stranded`&&d.escalation_msg_id&&await z(d.escalation_msg_id,s,`auto-resolved: work-item ${s} has a live serving cup; recovery is making progress again`),await L(e,{...C,status:`working`,failCount:b.failCount,infraLossCount:b.infraLossCount,lastLossSpawnId:null,disposition:`working`});break;case`stale-recovery`:{let r=Math.max(0,Math.floor((i-(b.recoveryStartedAtMs??i))/36e5)),a=await _e(s,C.harnessSlug,r);await L(e,{...C,status:`stranded`,failCount:b.failCount,infraLossCount:b.infraLossCount,lastLossSpawnId:d?.last_loss_spawn_id??null,disposition:`recovery-timeout`,escalationMsgId:a}),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`stale-recovery`,detail:x.reason});break}case`completed`:if(d?.status!==`completed`&&(d?.escalation_msg_id&&await B(d.escalation_msg_id,s),await L(e,{...C,status:`completed`,failCount:b.failCount,infraLossCount:b.infraLossCount,lastLossSpawnId:null,disposition:`completed`}),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`completed`}),C.harnessSlug)){let r=await me(e,t,C.harnessSlug,s);r>0&&(await he(t,c,s,C.harnessSlug,r),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`unblocked`,detail:`${r} downstream`}))}break;case`parked`:d?.status!==`blocked`&&(d?.escalation_msg_id&&await B(d.escalation_msg_id,s),await L(e,{...C,status:`blocked`,failCount:b.failCount,infraLossCount:b.infraLossCount,lastLossSpawnId:null,disposition:`parked`}));break;case`recover`:await L(e,{...C,status:`recovering`,failCount:x.nextFailCount,infraLossCount:x.nextInfraLossCount,lastLossSpawnId:x.nextFailCount>b.failCount||x.nextInfraLossCount>b.infraLossCount?h?.spawnId??d?.last_loss_spawn_id??null:d?.last_loss_spawn_id??null,disposition:`recover`,bumpRecovery:!0}),x.infraAttributed||await pe(t,c,s,C.harnessSlug,x.nextFailCount),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`recover`,detail:`attempt ${x.nextFailCount}`});break;case`breaker`:{let r=x.infraAttributed?null:await ge(s,C.harnessSlug,x.nextFailCount);await L(e,{...C,status:`cursed`,failCount:x.nextFailCount,lastLossSpawnId:h?.spawnId??d?.last_loss_spawn_id??null,infraLossCount:x.nextInfraLossCount,disposition:`breaker`,escalationMsgId:r}),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`breaker`,detail:x.reason});break}case`latched`:await L(e,{...C,status:b.placementStatus===`stranded`?`stranded`:`cursed`,failCount:b.failCount,lastLossSpawnId:d?.last_loss_spawn_id??null,infraLossCount:b.infraLossCount,disposition:b.placementStatus===`stranded`?`recovery-timeout`:`breaker`}),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`latched`,detail:`${b.placementStatus}, halted (fail_count ${b.failCount} frozen)`});break;case`debounced`:await L(e,{...C,status:`recovering`,failCount:b.failCount,lastLossSpawnId:d?.last_loss_spawn_id??null,infraLossCount:b.infraLossCount,disposition:`recover`});break;case`abandon`:d&&d.status!==`abandoned`&&d.status!==`completed`&&(d.escalation_msg_id&&await z(d.escalation_msg_id,s,`auto-resolved: work-item ${s} no longer exists; the ${d.status} advisory is no longer relevant`),await L(e,{...C,status:`abandoned`,failCount:b.failCount,infraLossCount:b.infraLossCount,lastLossSpawnId:null,disposition:`abandoned`}),o.push({workspaceId:t,installSlug:n,workItemId:s,decision:`abandon`,detail:x.reason}));break}}}return o.push(...await ye(e,t,n,c,S,i)),o.push(...await ve(e,t,n,i)),o}async function pe(e,t,n,r,i){await F({workspaceId:e,mugOwner:t,summary:`Placement watchdog: work-item ${n}${r?` (${r})`:``} is not terminal but its cup is dead/stalled (placement attempt ${i}) — re-place or recover it.`,payload:{kind:`placement-recovery`,workItemId:n,harness:r,attempt:i},source:`pot-placement-watchdog`,harnessSlug:r})}async function me(e,t,n,r){return(await e`
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
       AND d.status <> ALL(${[...U]})`)[0]?.downstream??0}async function he(e,t,n,r,i){await F({workspaceId:e,mugOwner:t,summary:`Placement watchdog: ${n}${r?` (${r})`:``} completed and un-gated ${i} downstream lane(s) — survey + place the next wave batch.`,payload:{kind:`placement-unblocked`,workItemId:n,harness:r,downstream:i},source:`pot-placement-watchdog`,harnessSlug:r})}async function ge(e,t,n){try{return(await v(Y,{severity:`advisory`,summary:`Cursed placement: ${e} failed ${n}× — stopped auto-re-placing`,body:`Work-item ${e}${t?` (${t})`:``} has been placed and lost ${n} times without reaching a terminal state. Per the cursed-item circuit breaker (mug-autonomous-execution B-09 / P-021) the Mug has STOPPED auto-re-placing it. Investigate it (ill-specified? wedging cups?) then re-place, deprecate, or split it. Re-placing clears the breaker when it next completes.`})).msg_id}catch(t){return console.warn(`[pot-placement-watchdog] cursed escalation failed for ${e}: ${t instanceof Error?t.message:t}`),null}}async function _e(e,t,n){try{return(await v(Y,{severity:`advisory`,summary:`Placement recovery stalled: ${e} made no progress for ${n}h`,body:`Work-item ${e}${t?` (${t})`:``} remained in placement recovery for ${n} hours without acquiring a live cup or reaching a terminal state. The watchdog has stopped automatic recovery and marked the placement stranded. Verify the work, then re-place, split, deprecate, or resolve it.`})).msg_id}catch(t){return console.warn(`[pot-placement-watchdog] stale-recovery escalation failed for ${e}: ${t instanceof Error?t.message:t}`),null}}async function z(e,t,n){if(e)try{await b({msg_id:e,choice:`item-now-terminal`,resolver:J,note:n})}catch(e){console.warn(`[pot-placement-watchdog] resolving placement escalation failed for ${t}: ${e instanceof Error?e.message:e}`)}}async function B(e,t){await z(e,t,`auto-resolved: work-item ${t} reached terminal state, cursed advisory is no longer relevant`)}async function ve(e,t,n,r){let i=[],a=await e`
    SELECT work_item_id, status, escalation_msg_id, harness_slug, fail_count
      FROM harness_shared.pot_placements
     WHERE workspace_id = ${t}
       AND install_slug = ${n}
       AND status IN ('working', 'recovering', 'cursed', 'stranded')`;if(a.length===0)return i;let o=await e`
    SELECT feature_id, status
      FROM harness_shared.harness_features_consolidated
     WHERE workspace_id = ${t} AND feature_id = ANY(${[...new Set(a.map(e=>e.work_item_id))]})`,s=new Map(o.map(e=>[e.feature_id,e.status]));for(let o of a){let a=s.get(o.work_item_id),c=N({placementStatus:o.status,unitExists:a!=null,unitTerminal:k(a)});if(c===`keep`)continue;let l=c===`resolve-completed`;o.escalation_msg_id&&await z(o.escalation_msg_id,o.work_item_id,l?`auto-resolved (placement GC, EI-1524): work-item ${o.work_item_id} reached terminal state (${a}); the ${o.status} advisory is no longer relevant`:`auto-resolved (placement GC, EI-1524): work-item ${o.work_item_id} no longer exists; the ${o.status} advisory is no longer relevant`),await L(e,{workspaceId:t,installSlug:n,workItemId:o.work_item_id,harnessSlug:o.harness_slug,mugOwnerId:null,lastLossSpawnId:null,cupSpawnId:null,cupOwnerId:null,status:l?`completed`:`abandoned`,failCount:o.fail_count,disposition:l?`completed`:`abandoned`,now:r}),i.push({workspaceId:t,installSlug:n,workItemId:o.work_item_id,decision:l?`completed`:`abandon`,detail:`gc: stale ${o.status} placement reconciled (unit ${l?a:`gone`})`})}return i}async function ye(e,t,n,r,i,a){let o=[],s=await e`
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
     WHERE l.workspace_id = ${_}
       AND l.rel = 'blocks'
       AND l.src_kind = 'feature'
       AND l.dst_kind = 'feature'
       AND b.status = ANY(${[...W]})
       AND d.status <> ALL(${[...U]})
     GROUP BY b.feature_id, b.harness_slug, b.status`;for(let c of s){let s=i.get(c.blocker_id);if(s&&s.escalation_msg_id&&(s.status===`stranded`||s.status===`cursed`))continue;let l=null;try{l=(await v(Y,{severity:`blocker`,summary:`Stuck blocker ${c.blocker_id} is stranding ${c.downstream} downstream work-item(s)`,body:`Blocker ${c.blocker_id} (${c.blocker_harness}) is ${c.blocker_status} and gating ${c.downstream} non-terminal downstream work-item(s) — they cannot proceed until it resolves. Resolve, deprecate, or re-place the blocker to un-gate the downstream work. (mug-autonomous-execution B-09 / P-022)`})).msg_id}catch(e){console.warn(`[pot-placement-watchdog] stranded escalation failed for ${c.blocker_id}: ${e instanceof Error?e.message:e}`);continue}await L(e,{workspaceId:t,installSlug:n,workItemId:c.blocker_id,harnessSlug:c.blocker_harness,mugOwnerId:r,lastLossSpawnId:null,cupSpawnId:null,cupOwnerId:null,status:`stranded`,failCount:s?.fail_count??0,infraLossCount:s?.infra_loss_count??0,disposition:`stranded`,escalationMsgId:l,now:a}),o.push({workspaceId:t,installSlug:n,workItemId:c.blocker_id,decision:`stranded`,detail:`${c.downstream} downstream`})}return o}function V(e,t,n=Date.now()){let r={recovering:0,cursed:0,stranded:0,workingTracked:0,items:[]};for(let t of e){let e=Number(t.count)||0;t.status===`recovering`?r.recovering=e:t.status===`cursed`?r.cursed=e:t.status===`stranded`?r.stranded=e:t.status===`working`&&(r.workingTracked=e)}for(let e of t)if(e.status!==`working`){let t=e.updated_at==null?NaN:new Date(e.updated_at).getTime(),i=Number.isFinite(t)?Math.max(0,(n-t)/36e5):void 0,a=e.status===`recovering`&&i!=null&&i*36e5>=$,o=e.source_plan_item_ids?.[0],s=e.source_plan_slug&&o?`${e.source_plan_slug}#${o}`:null;r.items.push({workItemId:e.work_item_id,status:e.status,failCount:e.fail_count,harness:e.harness_slug,...i==null?{}:{ageHours:i},...a?{stale:!0}:{},...s?{planItem:s}:{}})}let i={recovering:0,stranded:1,cursed:2};return r.items.sort((e,t)=>(i[e.status]??3)-(i[t.status]??3)),r}async function be(e,t,n=20){let r={recovering:0,cursed:0,stranded:0,workingTracked:0,items:[]};try{let{sql:r}=l(),i=Math.max(1,Math.round(re/1e3));return V(await r`
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
           AND f.status <> ALL(${q}::text[])
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
           AND f.status <> ALL(${q}::text[])
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
       LIMIT ${n}`)}catch{return r}}var H,U,W,G,K,q,J,Y,X,Z,Q,$,xe=e((()=>{H=t(c(),1),u(),a(),s(),g(),ee(),ce(),S(),y(),ne(),C(),n(),U=new Set([`passed`,`deprecated`,`resolved`,`closed`]),W=new Set([`failing`,`failed`]),G=new Set([`done`,`failed`,`cancelled`,`reaped`]),K=new Set([`blocked`,`needs-human`]),q=[...U,...K],J=`system:pot-placement-watchdog`,Y={ownerId:J},X=(()=>{let e=Number({}.PAPERCUSP_POT_ACTIVE_RECLAIM_WINDOW_MS??{}.PAPERCUSP_POT_ACTIVE_RECLAIM_WINDOW_MS??15*6e4);return Number.isFinite(e)&&e>=0?e:15*6e4})(),Z=new Set([`working`,`recovering`,`cursed`,`stranded`]),Q=`@role:mug`,$=(()=>{let e=Number({}.PAPERCUSP_POT_PLACEMENT_STALE_MS??1440*6e4);return Number.isFinite(e)&&e>=0?e:1440*6e4})()}));export{de as _,q as a,F as b,M as c,ue as d,A as f,fe as g,R as h,Z as i,N as l,le as m,$ as n,V as o,k as p,Q as r,j as s,X as t,xe as u,I as v,be as y};