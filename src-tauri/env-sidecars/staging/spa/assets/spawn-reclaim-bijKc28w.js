const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/feature-audit-mBm-el-L.js","assets/feature-audit-DoQlcbUO.js","assets/chunk-ChpBd9eV.js","assets/preload-helper-CcgcQsTF.js"])))=>i.map(i=>d[i]);
import{n as k,o as A}from"./chunk-ChpBd9eV.js";import{n as G,t as B}from"./preload-helper-CcgcQsTF.js";import{t as S}from"./__vite-browser-external-56mrcCg8.js";import{a as Y,n as X}from"./workspace-als-CSW21ZcE.js";import{Zt as j,rn as J}from"./messages-DA3ma2xE.js";import{i as U,o as V,u as K}from"./work-item-dispatch-states-jkwfzC7Z.js";import{B as z,G as Z,Mt as Q}from"./work-items-B3XMqSf_.js";async function I(e,t,n,r){try{const i=await e`
      SELECT spawn_id, parent_spawn_id, workspace_id, session_owner, status,
             error_message, output_tail, exit_code
        FROM harness_shared.spawned_agents
       WHERE spawn_id = ${t} AND workspace_id = ${n}`;if(i.length===0)return{parentWoken:!1};const s=i[0];if(!s.parent_spawn_id)return{parentWoken:!1};const l=s.parent_spawn_id,_=`Child spawn ${t} reached terminal status: ${r}`,d={childSpawnId:t,status:r,errorMessage:s.error_message,outputTail:s.output_tail,exitCode:s.exit_code};return{parentWoken:(await J([l],{summary:_,payload:d,source:"spawn-finish",workspaceId:n})).woken>0,parentSpawnId:s.parent_spawn_id,parentOwnerId:l}}catch(i){return console.warn(`[parent-wake] failed to wake parent of spawn ${t}: ${i instanceof Error?i.message:String(i)}`),{parentWoken:!1}}}var q=k((()=>{j()}));function ee(e){return e.role==="cup"&&e.exitCode===0&&!e.aborted&&typeof e.featureId=="string"&&e.featureId.length>0&&e.featureId!=="-"}async function ae(e,t={}){const n=t.getWorkItem??z,r=t.setWorkItemState??Q,i=t.log??(d=>console.log(d)),{harnessSlug:s,featureId:l,workspaceId:_}=e;return Y(_,async()=>{const d=await n(l,s);if(!d||!W.has(d.state))return!1;const u=d.state,h=(await r(l,"passed",{harness:s,by:"hive-bee-exit",skipCompletionGate:!0}))?.state==="passed";if(h){i(`[bee-exit-reconcile] ${s}/${l} status reconciled ${u}→passed (bee exited rc=0 without landing work_items:complete)`);const o=t.audit;if(o)o(s,l,u);else try{const{auditFeatureChange:w}=await B(async()=>{const{auditFeatureChange:f}=await import("./feature-audit-mBm-el-L.js");return{auditFeatureChange:f}},__vite__mapDeps([0,1,2,3]));w(s,l,"status",u,"passed","hive-bee-exit")}catch{}}return h})}async function te(e,t={}){if(!ee(e))return!1;try{return await ae({harnessSlug:e.harnessSlug,featureId:e.featureId,workspaceId:e.workspaceId},t)}catch(n){return(t.log??(r=>console.warn(r)))(`[bee-exit-reconcile] ${e.harnessSlug}/${e.featureId} reconcile failed (non-fatal): ${n instanceof Error?n.message:String(n)}`),!1}}var W,se=k((()=>{X(),Z(),G(),W=new Set(["in_progress","validating"])}));function Ae(e,t){return(0,H.join)(e,".papercusp","spawn-results",`${t.replace(/[^A-Za-z0-9._-]/g,"_")}.log`)}function C(e){if(!e)return null;try{const t=(0,T.readFileSync)(e,"utf8"),n=t.lastIndexOf(v);if(n<0)return null;const r=t.indexOf(F,n);if(r<0)return null;const i=t.slice(n+22,r).trim(),s=JSON.parse(i);if(!Number.isInteger(s.exitCode))return null;const l=t.slice(0,n).trimEnd();return{exitCode:Number(s.exitCode),outputTail:l.slice(-2e3)}}catch{return null}}function $(e){if(e)try{(0,T.unlinkSync)(e)}catch{}}function Se(){return m}function Ie(e){m=e}async function Te(e,t,n){await e`
    UPDATE harness_shared.spawned_agents
       SET pid = ${n}, launcher_host = ${(0,E.hostname)()}, launcher_boot_id = ${m}
     WHERE spawn_id = ${t} AND status IN ('running', 'restarting')`}function b(e,t="spawn"){if(!Number.isInteger(e)||e<=1)return!1;if(e===process.pid)return!0;if(process.platform!=="linux")return!1;try{const n=(0,T.readFileSync)(`/proc/${e}/cmdline`,"utf8");return t==="launch"?n.length>0:n.includes("invoke-once")}catch{return!1}}async function ne(e,t,n){if(t.length===0)return;const r=n?t.filter(s=>n.has(s)):[],i=r.length===0?t:t.filter(s=>!n.has(s));i.length>0&&await e`
      UPDATE harness_shared.spawned_agents
         SET heartbeat_at = now()
       WHERE spawn_id = ANY(${i}::text[])
         AND status IN ('running', 'restarting')`,r.length>0&&await e`
      UPDATE harness_shared.spawned_agents AS a
         SET heartbeat_at = now(),
             last_output_at = GREATEST(coalesce(a.last_output_at, 'epoch'::timestamptz), u.output_at)
        FROM unnest(${r}::text[], ${r.map(s=>new Date(n.get(s)).toISOString())}::timestamptz[]) AS u(spawn_id, output_at)
       WHERE a.spawn_id = u.spawn_id
         AND a.status IN ('running', 'restarting')`}function re(e,t={}){const n=t.now??Date.now(),r=t.silentMs??6e5,i=t.staleMs??3e5;if(e.status!=="running"&&e.status!=="restarting"||!e.heartbeatAt)return!1;const s=d=>d instanceof Date?d.getTime():typeof d=="string"?new Date(d).getTime():typeof d=="number"?d:NaN,l=s(e.heartbeatAt);if(isNaN(l)||n-l>i||!e.lastOutputAt)return!1;const _=s(e.lastOutputAt);return!isNaN(_)&&n-_>r}async function L(e,t){if(t.length===0)return{features:0,issues:0,planClaims:0};const n=await e`
    UPDATE harness_shared.harness_features_consolidated
       SET taken_by = NULL, taken_at = NULL, last_progress_at = NULL,
           status = CASE WHEN status <> ALL(${[...U]}::text[]) THEN 'todo' ELSE status END,
           updated_ts = ${Date.now()}
     WHERE taken_by = ANY(${t}::text[])
    RETURNING feature_id`,r=await e`
    UPDATE harness_shared.engineer_issues
       SET assignee = NULL, assigned_at = NULL, origin = 'local', updated_at = now()
     WHERE assignee = ANY(${t}::text[])
    RETURNING issue_id`,i=await e`
    DELETE FROM harness_shared.plan_item_claims
     WHERE owner = ANY(${t}::text[])
    RETURNING item_id`,s={features:n.length,issues:r.length,planClaims:i.length};return(s.features||s.issues||s.planClaims)&&console.log(`[spawn-reclaim] released dead-holder claims: ${s.features} feature(s) [${n.map(l=>l.feature_id).join(", ")}], ${s.issues} issue(s), ${s.planClaims} plan claim(s)`),s}async function O(e,t){const n=[];for(const r of t){const i=C(r.result_path);if(!i)continue;const s=i.exitCode===0?"done":"failed",l=i.outputTail||null;if((await e`
      UPDATE harness_shared.spawned_agents
         SET status = ${s},
             finished_at = now(),
             duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint,
             exit_code = ${i.exitCode},
             output_tail = COALESCE(${l}::text, output_tail),
             last_output_at = CASE
               WHEN ${l}::text IS NOT NULL THEN GREATEST(COALESCE(last_output_at, now()), now())
               ELSE last_output_at
             END,
             error_message = CASE
               WHEN ${i.exitCode}::int <> 0 THEN COALESCE(
                 error_message,
                 'recovered after launcher restart: invoke-once exited ' || ${i.exitCode}::text
               )
               ELSE error_message
             END
       WHERE spawn_id = ${r.spawn_id}
         AND workspace_id = ${r.workspace_id}
         AND status IN ('running', 'restarting')
      RETURNING spawn_id`).length===0){$(r.result_path);continue}n.push({...r,exitCode:i.exitCode}),$(r.result_path),await te({role:r.child_role,exitCode:i.exitCode,aborted:!1,featureId:r.work_item_id,harnessSlug:r.harness_slug??"",workspaceId:r.workspace_id}),I(e,r.spawn_id,r.workspace_id,s).catch(()=>{})}return{rows:n,claimsReleased:await L(e,n.map(r=>r.spawn_id))}}async function y(e){const t=await e`
    UPDATE harness_shared.harness_features_consolidated f
       SET taken_by = NULL, taken_at = NULL, last_progress_at = NULL,
           status = CASE WHEN f.status <> ALL(${[...U]}::text[]) THEN 'todo' ELSE f.status END,
           updated_ts = ${Date.now()}
     WHERE f.taken_by LIKE 's-%'
       AND (
         EXISTS (SELECT 1 FROM harness_shared.spawned_agents a
                  WHERE a.spawn_id = f.taken_by AND a.status NOT IN ('running', 'restarting'))
         OR (NOT EXISTS (SELECT 1 FROM harness_shared.spawned_agents a WHERE a.spawn_id = f.taken_by)
             AND f.taken_at < now() - interval '1 hour')
       )
    RETURNING f.feature_id, f.taken_by`,n=await e`
    UPDATE harness_shared.engineer_issues i
       SET assignee = NULL, assigned_at = NULL, origin = 'local', updated_at = now()
     WHERE i.assignee LIKE 's-%'
       AND (
         EXISTS (SELECT 1 FROM harness_shared.spawned_agents a
                  WHERE a.spawn_id = i.assignee AND a.status NOT IN ('running', 'restarting'))
         OR (NOT EXISTS (SELECT 1 FROM harness_shared.spawned_agents a WHERE a.spawn_id = i.assignee)
             AND i.assigned_at < now() - interval '1 hour')
       )
    RETURNING i.issue_id`,r=await e`
    DELETE FROM harness_shared.plan_item_claims c
     WHERE c.owner LIKE 's-%'
       AND EXISTS (SELECT 1 FROM harness_shared.spawned_agents a
                    WHERE a.spawn_id = c.owner AND a.status NOT IN ('running', 'restarting'))
    RETURNING c.item_id`,i={features:t.length,issues:n.length,planClaims:r.length};return(i.features||i.issues||i.planClaims)&&console.log(`[spawn-reclaim] stale-claim backstop freed: ${i.features} feature(s) [${t.map(s=>`${s.feature_id}←${s.taken_by}`).join(", ")}], ${i.issues} issue(s), ${i.planClaims} plan claim(s)`),i}function ie(e){return e.childRole==="mug"?!0:e.childRole!=="cup"||!e.workItemId||!e.workItemStatus?!1:!V.includes(e.workItemStatus)}async function Re(e,t={}){const n=Math.max(1,Math.round((t.staleMs??3e5)/1e3)),r=t.isAlive??b,i=await e`
    SELECT spawn_id, workspace_id, harness_slug, child_role,
           COALESCE(item_id, feature_id) AS work_item_id, result_path,
           pid, launcher_host, run_id, launcher_boot_id
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
       AND heartbeat_at < now() - ${n}::int * interval '1 second'`;if(i.length===0)return{reclaimed:0,spawnIds:[],workspaces:[],claimsReleased:await y(e)};const s=(0,E.hostname)(),l=[],_=[],d=[],u=[],h=[],o=[];for(const c of i){const g=c.launcher_host!=null&&c.launcher_host===s,N=(c.run_id??"").startsWith("launch-")||c.spawn_id.startsWith("durable-spawn:")?"launch":"spawn";if(N==="spawn"&&C(c.result_path)){o.push(c);continue}if(g&&c.launcher_boot_id!=null&&c.launcher_boot_id!==m){N==="spawn"&&c.pid!=null&&r(c.pid,N)?h.push(c.spawn_id):u.push(c.spawn_id);continue}g&&c.pid!=null?r(c.pid,N)?l.push(c.spawn_id):_.push(c.spawn_id):d.push(c.spawn_id)}const w=await O(e,o);l.length>0&&await ne(e,l),h.length>0&&await e`
      UPDATE harness_shared.spawned_agents
         SET launcher_boot_id = ${m}, heartbeat_at = now()
       WHERE status IN ('running', 'restarting')
         AND spawn_id = ANY(${h}::text[])`;const f=[..._,...d,...u];if(f.length===0){const c=w.rows.map(g=>g.spawn_id);return{reclaimed:c.length,spawnIds:c,workspaces:[...new Set(w.rows.map(g=>g.workspace_id))],reattached:h,recovered:c,claimsReleased:w.claimsReleased}}const a=await e`
    UPDATE harness_shared.spawned_agents
       SET status = 'failed',
           finished_at = now(),
           duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint,
           error_message = COALESCE(
             error_message,
             CASE
               WHEN spawn_id = ANY(${u}::text[])
                 THEN 'reclaimed: launched by a prior operator incarnation (boot-id mismatch on '
                      || COALESCE(launcher_host, '?')
                      || ') — host restarted, concurrency ceiling freed by the reclaim sweep (EI-2186)'
               WHEN spawn_id = ANY(${_}::text[])
                 THEN 'reclaimed: child process (pid ' || COALESCE(pid::text, '?')
                      || ') confirmed dead on ' || COALESCE(launcher_host, '?')
                      || ' — concurrency ceiling freed by the P-011 reclaim sweep (EI-85)'
               ELSE 'reclaimed: spawn heartbeat stale > ' || ${n}::text
                      || 's (launching operator host presumed dead) — concurrency ceiling freed by the P-011 reclaim sweep'
             END
           )
     WHERE status IN ('running', 'restarting')
       AND spawn_id = ANY(${f}::text[])
    RETURNING spawn_id, workspace_id`,p=await L(e,a.map(c=>c.spawn_id)),R=await y(e);for(const c of a)I(e,c.spawn_id,c.workspace_id,"failed").catch(()=>{});return{reclaimed:a.length+w.rows.length,spawnIds:[...w.rows.map(c=>c.spawn_id),...a.map(c=>c.spawn_id)],workspaces:[...new Set([...w.rows.map(c=>c.workspace_id),...a.map(c=>c.workspace_id)].filter(Boolean))],reattached:h,recovered:w.rows.map(c=>c.spawn_id),claimsReleased:{features:w.claimsReleased.features+p.features+R.features,issues:w.claimsReleased.issues+p.issues+R.issues,planClaims:w.claimsReleased.planClaims+p.planClaims+R.planClaims}}}function D(e){return!((e.run_id??"").startsWith("launch-")||e.spawn_id.startsWith("durable-spawn:"))}function oe(e,t){if(!D({spawn_id:e.spawnId,run_id:e.runId}))return"skip";const n=s=>s instanceof Date?s.getTime():typeof s=="string"?new Date(s).getTime():NaN,r=n(e.startedAt);if(isNaN(r)||t.now-r<=t.minAgeMs)return"skip";const i=e.lastOutputAt?n(e.lastOutputAt):null;return i==null?e.launcherHost===t.me&&e.pid!=null&&!t.isAlive(e.pid,"spawn")?"proc-dead":"skip":isNaN(i)||t.now-i<=t.silentMs?"skip":"stream-silent"}async function ke(e,t={}){const n=t.minAgeMs??9e5,r=t.silentMs??9e5,i=t.now??Date.now(),s=t.isAlive??b,l=(0,E.hostname)(),_=await e`
    SELECT spawn_id, workspace_id, harness_slug, child_role,
           COALESCE(item_id, feature_id) AS work_item_id, result_path,
           run_id, started_at, last_output_at, launcher_host, pid
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
     ORDER BY started_at ASC
     LIMIT 500`;if(_.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};const d=await O(e,_.filter(a=>D(a))),u=new Set(d.rows.map(a=>a.spawn_id)),h=[],o=[];for(const a of _){if(u.has(a.spawn_id))continue;const p=oe({spawnId:a.spawn_id,runId:a.run_id,startedAt:a.started_at,lastOutputAt:a.last_output_at,launcherHost:a.launcher_host,pid:a.pid},{now:i,minAgeMs:n,silentMs:r,me:l,isAlive:s});p==="stream-silent"?h.push(a.spawn_id):p==="proc-dead"&&o.push(a.spawn_id)}const w=[...h,...o];if(w.length===0){const a=d.rows.map(p=>p.spawn_id);return{reclaimed:a.length,spawnIds:a,workspaces:[...new Set(d.rows.map(p=>p.workspace_id).filter(Boolean))],recovered:a,claimsReleased:d.claimsReleased}}const f=await e`
    UPDATE harness_shared.spawned_agents
       SET status = 'failed',
           finished_at = now(),
           duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint,
           error_message = COALESCE(
             error_message,
             CASE WHEN spawn_id = ANY(${o}::text[]) THEN ${"reclaimed: spawn-ceiling-jam — recorded child process confirmed dead on this host with no stream activity (orphaned admission debit, EI-8839) — periodic admission-debit reconcile freed the concurrency-ceiling slot without waiting for the next operator restart; any held work-item claim is released by the next stale-claim sweep"} ELSE ${`reclaimed: spawn-ceiling-jam — no stream activity for > ${Math.round(r/6e4)}min despite an apparently-fresh heartbeat (reused-pid false-alive, EI-7204/EI-7197) — periodic admission-debit reconcile freed the concurrency-ceiling slot; any held work-item claim is released by the next stale-claim sweep`} END
           )
     WHERE status IN ('running', 'restarting')
       AND spawn_id = ANY(${w}::text[])
    RETURNING spawn_id, workspace_id`;for(const a of f)I(e,a.spawn_id,a.workspace_id,"failed").catch(()=>{});return{reclaimed:f.length+d.rows.length,spawnIds:[...d.rows.map(a=>a.spawn_id),...f.map(a=>a.spawn_id)],workspaces:[...new Set([...d.rows.map(a=>a.workspace_id),...f.map(a=>a.workspace_id)].filter(Boolean))],recovered:d.rows.map(a=>a.spawn_id),claimsReleased:d.claimsReleased}}async function Ce(e,t,n={}){const r=n.silentMs??P,i=n.staleMs??3e5,s=n.now??Date.now(),l=Math.max(1,Math.round(r/1e3)),_=Math.max(1,Math.round(i/1e3)),d=await e`
    SELECT spawn_id, workspace_id, launcher_host, launcher_boot_id, pid,
           heartbeat_at, last_output_at
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
       AND launcher_host = ${(0,E.hostname)()}
       AND launcher_boot_id = ${m}
       AND pid IS NOT NULL
       AND pid <> ${process.pid}
       AND heartbeat_at >= now() - ${_}::int * interval '1 second'
       AND last_output_at IS NOT NULL
       AND last_output_at < now() - ${l}::int * interval '1 second'`;if(d.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};const u=[],h=new Set;for(const o of d){if(!re({status:"running",heartbeatAt:o.heartbeat_at,lastOutputAt:o.last_output_at},{now:s,silentMs:r,staleMs:i}))continue;const w=o.last_output_at?new Date(o.last_output_at).getTime():s;try{await t({spawnId:o.spawn_id,workspaceId:o.workspace_id,launcherHost:o.launcher_host,launcherBootId:o.launcher_boot_id,pid:o.pid,heartbeatAt:o.heartbeat_at,lastOutputAt:o.last_output_at,silentMs:Math.max(0,s-w)})&&(u.push(o.spawn_id),o.workspace_id&&h.add(o.workspace_id))}catch(f){console.warn(`[wedge-reclaim] reap failed for ${o.spawn_id} (will retry next tick): ${f instanceof Error?f.message:f}`)}}return{reclaimed:u.length,spawnIds:u,workspaces:[...h]}}function de(e,t={}){const n=t.now??Date.now(),r=t.silentMs??M,i=t.staleMs??3e5;if(e.status!=="running"&&e.status!=="restarting"||e.lastOutputAt||!e.heartbeatAt)return!1;const s=d=>d instanceof Date?d.getTime():typeof d=="string"?new Date(d).getTime():typeof d=="number"?d:NaN,l=s(e.heartbeatAt);if(isNaN(l)||n-l>i||!e.startedAt)return!1;const _=s(e.startedAt);return!isNaN(_)&&n-_>r}async function be(e,t,n={}){const r=n.silentMs??M,i=n.staleMs??3e5,s=n.now??Date.now(),l=Math.max(1,Math.round(r/1e3)),_=Math.max(1,Math.round(i/1e3)),d=(await e`
    SELECT spawn_id, workspace_id, run_id, launcher_host, launcher_boot_id, pid,
           heartbeat_at, started_at
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
       AND launcher_host = ${(0,E.hostname)()}
       AND launcher_boot_id = ${m}
       AND pid IS NOT NULL
       AND pid <> ${process.pid}
       AND heartbeat_at >= now() - ${_}::int * interval '1 second'
       AND last_output_at IS NULL
       AND started_at < now() - ${l}::int * interval '1 second'`).filter(o=>D({spawn_id:o.spawn_id,run_id:o.run_id}));if(d.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};const u=[],h=new Set;for(const o of d){if(!de({status:"running",heartbeatAt:o.heartbeat_at,lastOutputAt:null,startedAt:o.started_at},{now:s,silentMs:r,staleMs:i}))continue;const w=new Date(o.started_at).getTime();try{await t({spawnId:o.spawn_id,workspaceId:o.workspace_id,launcherHost:o.launcher_host,launcherBootId:o.launcher_boot_id,pid:o.pid,heartbeatAt:o.heartbeat_at,startedAt:o.started_at,silentMs:Math.max(0,s-w)})&&(u.push(o.spawn_id),o.workspace_id&&h.add(o.workspace_id))}catch(f){console.warn(`[first-output-stall-reclaim] reap failed for ${o.spawn_id} (will retry next tick): ${f instanceof Error?f.message:f}`)}}return{reclaimed:u.length,spawnIds:u,workspaces:[...h]}}async function Le(e,t={}){const n=Math.max(1,Math.round((t.staleMs??3e5)/1e3)),r=(0,E.hostname)(),i=t.isAlive??b,s=await e`
    SELECT a.spawn_id, a.workspace_id, a.harness_slug, a.child_role,
           COALESCE(a.item_id, a.feature_id) AS work_item_id, a.result_path,
           a.pid, a.run_id
      FROM harness_shared.spawned_agents AS a
     WHERE a.status IN ('running', 'restarting')
       AND a.launcher_host = ${r}
       AND (
             (a.launcher_boot_id IS NOT NULL AND a.launcher_boot_id <> ${m})
          OR (a.launcher_boot_id IS NULL AND a.heartbeat_at < now() - ${n}::int * interval '1 second')
         )`,l=[],_=[],d=[];for(const a of s){const p=(a.run_id??"").startsWith("launch-")?"launch":"spawn";p==="spawn"&&C(a.result_path)?d.push(a):p==="spawn"&&a.pid!=null&&i(a.pid,p)?l.push(a.spawn_id):_.push(a.spawn_id)}const u=await O(e,d),h=[];if(l.length>0){const a=await e`
      UPDATE harness_shared.spawned_agents AS a
         SET launcher_boot_id = ${m},
             heartbeat_at = now()
       WHERE a.status IN ('running', 'restarting')
         AND a.spawn_id = ANY(${l}::text[])
      RETURNING a.spawn_id`;h.push(...a.map(p=>p.spawn_id))}if(_.length===0){const a=u.rows.map(p=>p.spawn_id);return{reclaimed:a.length,spawnIds:a,workspaces:[...new Set(u.rows.map(p=>p.workspace_id))],relaunched:[],reattached:h,recovered:a,claimsReleased:u.claimsReleased}}const o=await e`
    WITH reclaimed AS (
      UPDATE harness_shared.spawned_agents AS a
         SET status = 'failed',
             finished_at = now(),
             duration_ms = (EXTRACT(EPOCH FROM (now() - a.started_at)) * 1000)::bigint,
             error_message = COALESCE(
               a.error_message,
               'reclaimed at operator boot: launched by a prior incarnation on '
                 || COALESCE(a.launcher_host, '?')
                 || ' (host/process restarted before its admission-release ran, and its child'
                 || ' process is confirmed dead) — stale spawn-ceiling debit freed by the boot'
                 || ' reconcile (EI-2186 / WI-1499)'
             )
       WHERE a.status IN ('running', 'restarting')
         AND a.spawn_id = ANY(${_}::text[])
      RETURNING a.spawn_id, a.workspace_id, a.harness_slug, a.child_role,
                a.parent_spawn_id, a.parent_role,
                COALESCE(a.item_id, a.feature_id) AS work_item_id,
                a.plan_slug, a.model_spec, a.model_tier, a.brief
    )
    SELECT r.spawn_id, r.workspace_id, r.harness_slug, r.child_role,
           r.parent_spawn_id, r.parent_role, r.work_item_id,
           f.status AS work_item_status,
           r.plan_slug, r.model_spec, r.model_tier, r.brief
      FROM reclaimed r
      LEFT JOIN harness_shared.harness_features_consolidated f
        ON f.feature_id = r.work_item_id
       AND f.workspace_id = r.workspace_id
       AND f.harness_slug = r.harness_slug`;await L(e,o.map(a=>a.spawn_id));const w=[];if(t.relaunch){for(const a of o)if(ie({childRole:a.child_role,workItemId:a.work_item_id,workItemStatus:a.work_item_status}))try{await t.relaunch({spawnId:a.spawn_id,workspaceId:a.workspace_id,harnessSlug:a.harness_slug,childRole:a.child_role,parentSpawnId:a.parent_spawn_id,parentRole:a.parent_role,workItemId:a.work_item_id,workItemStatus:a.work_item_status,planSlug:a.plan_slug,modelSpec:a.model_spec,modelTier:a.model_tier,brief:a.brief})&&w.push(a.spawn_id)}catch(p){console.warn(`[spawn-reclaim] boot re-launch failed for ${a.child_role} ${a.spawn_id} (${a.harness_slug}); left reclaimed: ${p instanceof Error?p.message:p}`)}}const f=new Set(w);for(const a of o)f.has(a.spawn_id)||I(e,a.spawn_id,a.workspace_id,"failed").catch(()=>{});return{reclaimed:o.length+u.rows.length,spawnIds:[...u.rows.map(a=>a.spawn_id),...o.map(a=>a.spawn_id)],workspaces:[...new Set([...u.rows.map(a=>a.workspace_id),...o.map(a=>a.workspace_id)].filter(Boolean))],relaunched:w,reattached:h,recovered:u.rows.map(a=>a.spawn_id)}}var E,T,x,H,v,F,ce,m,le,_e,P,ue,pe,M,Oe=k((()=>{E=A(S(),1),T=A(S(),1),x=A(S(),1),H=A(S(),1),q(),K(),se(),v="__INVOCATION_RESULT__:",F="__INVOCATION_DONE__",ce=6e4,m=(0,x.randomUUID)(),le=5*6e4,_e=10*6e4,P=(()=>{const e=Number({}.PAPERCUSP_WEDGE_REAP_MS);return Number.isFinite(e)&&e>=6e4?e:30*6e4})(),ue=15*6e4,pe=15*6e4,M=(()=>{const e=Number({}.PAPERCUSP_FIRST_OUTPUT_STALL_MS);return Number.isFinite(e)&&e>=6e4?e:5*6e4})()}));export{q as A,L as C,y as D,Ae as E,se as O,Te as S,ie as T,ke as _,ce as a,Ce as b,Ie as c,Oe as d,de as f,C as g,Se as h,le as i,I as j,te as k,oe as l,b as m,pe as n,P as o,re as p,M as r,_e as s,ue as t,ne as u,be as v,$ as w,Le as x,Re as y};
