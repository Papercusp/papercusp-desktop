import{n as A}from"./chunk-ChpBd9eV.js";import{c as m,r as g}from"./workspace-registry-Du2UbhlH.js";import{i as E,u as f}from"./work-item-dispatch-states-jkwfzC7Z.js";import{i as T,n as w}from"./stale-claims-CvlDeLCd.js";import{c as l,o as R,t as N}from"./work-items-stale-claims-CWsRbCeR.js";async function U(e,a,s){await e`
    INSERT INTO harness_shared.periodic_sweep_runs (sweep_name, last_run_at, last_released, updated_at, workspace_id)
    VALUES (${a}, now(), ${s}, now(), ${g()})
    ON CONFLICT (sweep_name)
      DO UPDATE SET last_run_at = now(), last_released = ${s}, updated_at = now()`}async function p(e,a){const s=await e`
    SELECT extract(epoch from last_run_at) * 1000 AS last_run_ms, last_released
      FROM harness_shared.periodic_sweep_runs WHERE sweep_name = ${a}`;return s[0]?{lastRunMs:Number(s[0].last_run_ms),lastReleased:Number(s[0].last_released)}:null}async function v(e,a={}){const s=Math.max(1,Math.round((a.graceMs??N)/1e3)),n=Math.max(1,Math.round((a.assignmentGraceMs??w)/1e3)),r=a.stalenessMs??S,i=a.nowMs??Date.now(),t=a.workspaceId??null,h=[...E],[_]=await e`
    WITH live_holder AS (${l(e,s)}),
         live_holder_asg AS (${l(e,n)})
    SELECT
      (SELECT count(*) FROM harness_shared.harness_features_consolidated f
         WHERE (${t}::text IS NULL OR f.workspace_id = ${t})
           AND f.taken_by IS NULL
           AND f.status IS NOT NULL
           AND f.status <> ALL(${h}::text[]))::int AS stuck_features,
      (SELECT count(*) FROM harness_shared.harness_features_consolidated f
         WHERE (${t}::text IS NULL OR f.workspace_id = ${t})
           AND f.taken_by IS NOT NULL AND f.taken_by <> ''
           -- A NULL taken_at counts as past grace (the dead-holder signal alone
           -- governs), matching the reaper's DEAD leg + the fleet_assignment
           -- view's orphaned state so the alarm SEES the EI-2534 strand class.
           AND (f.taken_at IS NULL OR (now() - f.taken_at) > make_interval(secs => ${s}))
           AND NOT EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = f.taken_by))::int AS dead_held_features,
      (SELECT count(*) FROM harness_shared.engineer_issues e
         WHERE (${t}::text IS NULL OR e.workspace_id = ${t})
           AND e.state = 'open' AND e.kind IN ('bug', 'change')
           AND e.assignee IS NOT NULL AND e.assignee <> ''
           AND e.assigned_at IS NOT NULL
           AND (now() - e.assigned_at) > make_interval(secs => ${s})
           AND NOT EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = e.assignee))::int AS dead_assigned_issues,
      -- The assignment analog (EI-2535): active reservations past the ASSIGNMENT
      -- grace whose name-aware holder is dead (neither the name nor any adopting
      -- session is a live alias). Mirrors reclaimStaleDeadHolderPlanItemAssignments.
      (SELECT count(*) FROM harness_shared.plan_item_assignments asg
         WHERE (${t}::text IS NULL OR asg.workspace_id = ${t})
           AND asg.released_ts IS NULL
           AND asg.assignee_name IS NOT NULL AND asg.assignee_name <> ''
           AND asg.assigned_ts IS NOT NULL
           AND (now() - asg.assigned_ts) > make_interval(secs => ${n})
           AND NOT EXISTS (SELECT 1 FROM live_holder_asg h WHERE h.alias = asg.assignee_name)
           AND NOT EXISTS (
             SELECT 1 FROM harness_shared.agent_name_sessions s
               JOIN live_holder_asg h ON h.alias = s.session_owner_id
              WHERE s.workspace_id = asg.workspace_id AND s.agent_name = asg.assignee_name
           ))::int AS dead_held_assignments`,u=await p(e,c),d=u?.lastRunMs??null,o=d==null?null:Math.max(0,i-d),L=o==null?!0:o>r;return{stuckFeatures:Number(_?.stuck_features??0),deadHeldFeatures:Number(_?.dead_held_features??0),deadAssignedIssues:Number(_?.dead_assigned_issues??0),deadHeldAssignments:Number(_?.dead_held_assignments??0),reaperLastRunMs:d,reaperAgeMs:o,reaperStale:L,reaperLastReleased:u?.lastReleased??null}}async function C(e,a,s,n={}){const r=Math.max(1,Math.round((n.graceMs??N)/1e3)),i=[...E],[t]=await e`
    WITH live_holder AS (${l(e,r)})
    SELECT
      (SELECT count(*) FROM harness_shared.harness_features_consolidated f
         WHERE f.workspace_id = ${a} AND f.harness_slug = ${s}
           AND f.taken_by IS NULL
           AND f.status IS NOT NULL
           AND f.status <> ALL(${i}::text[]))::int AS stuck_features,
      (SELECT count(*) FROM harness_shared.harness_features_consolidated f
         WHERE f.workspace_id = ${a} AND f.harness_slug = ${s}
           AND f.taken_by IS NOT NULL AND f.taken_by <> ''
           -- NULL taken_at counts as past grace (parity with the reaper + the
           -- fleet_assignment view's orphaned state, EI-2534).
           AND (f.taken_at IS NULL OR (now() - f.taken_at) > make_interval(secs => ${r}))
           AND NOT EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = f.taken_by))::int AS dead_held_features`;return{stuckFeatures:Number(t?.stuck_features??0),deadHeldFeatures:Number(t?.dead_held_features??0)}}var c,S,k=A((()=>{R(),T(),f(),m(),c="stale-claim-sweep",S=(()=>{const e=Number({}.PAPERCUSP_SWEEP_STALENESS_MS??3e5);return Number.isFinite(e)&&e>0?e:300*1e3})()}));k();export{c as STALE_CLAIM_SWEEP_NAME,C as readHarnessStuckFeatures,v as readWorkQueueHealth,U as recordSweepRun};
