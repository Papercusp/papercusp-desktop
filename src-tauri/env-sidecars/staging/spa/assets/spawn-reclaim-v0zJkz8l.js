const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/feature-audit-CvF4QbPS.js","assets/feature-audit-DAPBUFOb.js","assets/chunk-CMxvf4Kt.js","assets/preload-helper-B_k_wMTD.js"])))=>i.map(i=>d[i]);
import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{n,t as r}from"./preload-helper-B_k_wMTD.js";import{t as i}from"./__vite-browser-external-CM3Eme-n.js";import{a,n as o}from"./workspace-als-DigME466.js";import{c as s,o as c}from"./inbox-wake-Bi8crPI9.js";import{M as l,g as u,v as d}from"./work-items-BCXHUNAA.js";import{r as f,t as p}from"./work-item-dispatch-states-DUjVV9AI.js";async function m(e,t,n,r){try{let i=await e`
      SELECT spawn_id, parent_spawn_id, workspace_id, session_owner, status,
             error_message, output_tail, exit_code
        FROM harness_shared.spawned_agents
       WHERE spawn_id = ${t} AND workspace_id = ${n}`;if(i.length===0)return{parentWoken:!1};let a=i[0];if(!a.parent_spawn_id)return{parentWoken:!1};let o=a.parent_spawn_id,c=`Child spawn ${t} reached terminal status: ${r}`,l={childSpawnId:t,status:r,errorMessage:a.error_message,outputTail:a.output_tail,exitCode:a.exit_code};return{parentWoken:(await s([o],{summary:c,payload:l,source:`spawn-finish`,workspaceId:n})).woken>0,parentSpawnId:a.parent_spawn_id,parentOwnerId:o}}catch(e){return console.warn(`[parent-wake] failed to wake parent of spawn ${t}: ${e instanceof Error?e.message:String(e)}`),{parentWoken:!1}}}var h=e((()=>{c()}));function g(e){return e.role===`cup`&&e.exitCode===0&&!e.aborted&&typeof e.featureId==`string`&&e.featureId.length>0&&e.featureId!==`-`}async function _(e,t={}){let n=t.getWorkItem??u,i=t.setWorkItemState??l,o=t.log??(e=>console.log(e)),{harnessSlug:s,featureId:c,workspaceId:d}=e;return a(d,async()=>{let e=await n(c,s);if(!e||!y.has(e.state))return!1;let a=e.state,l=(await i(c,`passed`,{harness:s,by:`hive-bee-exit`,skipCompletionGate:!0}))?.state===`passed`;if(l){o(`[bee-exit-reconcile] ${s}/${c} status reconciled ${a}→passed (bee exited rc=0 without landing work_items:complete)`);let e=t.audit;if(e)e(s,c,a);else try{let{auditFeatureChange:e}=await r(async()=>{let{auditFeatureChange:e}=await import(`./feature-audit-CvF4QbPS.js`);return{auditFeatureChange:e}},__vite__mapDeps([0,1,2,3]));e(s,c,`status`,a,`passed`,`hive-bee-exit`)}catch{}}return l})}async function v(e,t={}){if(!g(e))return!1;try{return await _({harnessSlug:e.harnessSlug,featureId:e.featureId,workspaceId:e.workspaceId},t)}catch(n){return(t.log??(e=>console.warn(e)))(`[bee-exit-reconcile] ${e.harnessSlug}/${e.featureId} reconcile failed (non-fatal): ${n instanceof Error?n.message:String(n)}`),!1}}var y,b=e((()=>{o(),d(),n(),y=new Set([`in_progress`,`validating`])}));function ee(e,t){return(0,H.join)(e,`.papercusp`,`spawn-results`,`${t.replace(/[^A-Za-z0-9._-]/g,`_`)}.log`)}function x(e){if(!e)return null;try{let t=(0,B.readFileSync)(e,`utf8`),n=t.lastIndexOf(U);if(n<0)return null;let r=t.indexOf(W,n);if(r<0)return null;let i=t.slice(n+22,r).trim(),a=JSON.parse(i);if(!Number.isInteger(a.exitCode))return null;let o=t.slice(0,n).trimEnd();return{exitCode:Number(a.exitCode),outputTail:o.slice(-2e3)}}catch{return null}}function S(e){if(e)try{(0,B.unlinkSync)(e)}catch{}}function C(){return K}function w(e){K=e}async function te(e,t,n){await e`
    UPDATE harness_shared.spawned_agents
       SET pid = ${n}, launcher_host = ${(0,z.hostname)()}, launcher_boot_id = ${K}
     WHERE spawn_id = ${t} AND status IN ('running', 'restarting')`}function T(e,t=`spawn`){if(!Number.isInteger(e)||e<=1)return!1;if(e===process.pid)return!0;if(process.platform!==`linux`)return!1;try{let n=(0,B.readFileSync)(`/proc/${e}/cmdline`,`utf8`);return t===`launch`?n.length>0:n.includes(`invoke-once`)}catch{return!1}}async function E(e,t,n){if(t.length===0)return;let r=n?t.filter(e=>n.has(e)):[],i=r.length===0?t:t.filter(e=>!n.has(e));i.length>0&&await e`
      UPDATE harness_shared.spawned_agents
         SET heartbeat_at = now()
       WHERE spawn_id = ANY(${i}::text[])
         AND status IN ('running', 'restarting')`,r.length>0&&await e`
      UPDATE harness_shared.spawned_agents AS a
         SET heartbeat_at = now(),
             last_output_at = GREATEST(coalesce(a.last_output_at, 'epoch'::timestamptz), u.output_at)
        FROM unnest(${r}::text[], ${r.map(e=>new Date(n.get(e)).toISOString())}::timestamptz[]) AS u(spawn_id, output_at)
       WHERE a.spawn_id = u.spawn_id
         AND a.status IN ('running', 'restarting')`}function D(e,t={}){let n=t.now??Date.now(),r=t.silentMs??6e5,i=t.staleMs??3e5;if(e.status!==`running`&&e.status!==`restarting`||!e.heartbeatAt)return!1;let a=e=>e instanceof Date?e.getTime():typeof e==`string`?new Date(e).getTime():typeof e==`number`?e:NaN,o=a(e.heartbeatAt);if(isNaN(o)||n-o>i||!e.lastOutputAt)return!1;let s=a(e.lastOutputAt);return!isNaN(s)&&n-s>r}async function O(e,t){if(t.length===0)return{features:0,issues:0,planClaims:0};let n=await e`
    UPDATE harness_shared.harness_features_consolidated
       SET taken_by = NULL, taken_at = NULL, last_progress_at = NULL,
           status = CASE WHEN status <> ALL(${[...p]}::text[]) THEN 'todo' ELSE status END,
           updated_ts = ${Date.now()}
     WHERE taken_by = ANY(${t}::text[])
    RETURNING feature_id`,r=await e`
    UPDATE harness_shared.engineer_issues
       SET assignee = NULL, assigned_at = NULL, origin = 'local', updated_at = now()
     WHERE assignee = ANY(${t}::text[])
    RETURNING issue_id`,i=await e`
    DELETE FROM harness_shared.plan_item_claims
     WHERE owner = ANY(${t}::text[])
    RETURNING item_id`,a={features:n.length,issues:r.length,planClaims:i.length};return(a.features||a.issues||a.planClaims)&&console.log(`[spawn-reclaim] released dead-holder claims: ${a.features} feature(s) [${n.map(e=>e.feature_id).join(`, `)}], ${a.issues} issue(s), ${a.planClaims} plan claim(s)`),a}async function k(e,t){let n=[];for(let r of t){let t=x(r.result_path);if(!t)continue;let i=t.exitCode===0?`done`:`failed`,a=t.outputTail||null;if((await e`
      UPDATE harness_shared.spawned_agents
         SET status = ${i},
             finished_at = now(),
             duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint,
             exit_code = ${t.exitCode},
             output_tail = COALESCE(${a}::text, output_tail),
             last_output_at = CASE
               WHEN ${a}::text IS NOT NULL THEN GREATEST(COALESCE(last_output_at, now()), now())
               ELSE last_output_at
             END,
             error_message = CASE
               WHEN ${t.exitCode}::int <> 0 THEN COALESCE(
                 error_message,
                 'recovered after launcher restart: invoke-once exited ' || ${t.exitCode}::text
               )
               ELSE error_message
             END
       WHERE spawn_id = ${r.spawn_id}
         AND workspace_id = ${r.workspace_id}
         AND status IN ('running', 'restarting')
      RETURNING spawn_id`).length===0){S(r.result_path);continue}n.push({...r,exitCode:t.exitCode}),S(r.result_path),await v({role:r.child_role,exitCode:t.exitCode,aborted:!1,featureId:r.work_item_id,harnessSlug:r.harness_slug??``,workspaceId:r.workspace_id}),m(e,r.spawn_id,r.workspace_id,i).catch(()=>{})}return{rows:n,claimsReleased:await O(e,n.map(e=>e.spawn_id))}}async function A(e){let t=await e`
    UPDATE harness_shared.harness_features_consolidated f
       SET taken_by = NULL, taken_at = NULL, last_progress_at = NULL,
           status = CASE WHEN f.status <> ALL(${[...p]}::text[]) THEN 'todo' ELSE f.status END,
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
    RETURNING c.item_id`,i={features:t.length,issues:n.length,planClaims:r.length};return(i.features||i.issues||i.planClaims)&&console.log(`[spawn-reclaim] stale-claim backstop freed: ${i.features} feature(s) [${t.map(e=>`${e.feature_id}←${e.taken_by}`).join(`, `)}], ${i.issues} issue(s), ${i.planClaims} plan claim(s)`),i}function j(e){return e.childRole===`mug`?!0:e.childRole!==`cup`||!e.workItemId||!e.workItemStatus?!1:!X.has(e.workItemStatus)}async function M(e,t={}){let n=Math.max(1,Math.round((t.staleMs??3e5)/1e3)),r=t.isAlive??T,i=await e`
    SELECT spawn_id, workspace_id, harness_slug, child_role,
           COALESCE(item_id, feature_id) AS work_item_id, result_path,
           pid, launcher_host, run_id, launcher_boot_id
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
       AND heartbeat_at < now() - ${n}::int * interval '1 second'`;if(i.length===0)return{reclaimed:0,spawnIds:[],workspaces:[],claimsReleased:await A(e)};let a=(0,z.hostname)(),o=[],s=[],c=[],l=[],u=[],d=[];for(let e of i){let t=e.launcher_host!=null&&e.launcher_host===a,n=(e.run_id??``).startsWith(`launch-`)||e.spawn_id.startsWith(`durable-spawn:`)?`launch`:`spawn`;if(n===`spawn`&&x(e.result_path)){d.push(e);continue}if(t&&e.launcher_boot_id!=null&&e.launcher_boot_id!==K){n===`spawn`&&e.pid!=null&&r(e.pid,n)?u.push(e.spawn_id):l.push(e.spawn_id);continue}t&&e.pid!=null?r(e.pid,n)?o.push(e.spawn_id):s.push(e.spawn_id):c.push(e.spawn_id)}let f=await k(e,d);o.length>0&&await E(e,o),u.length>0&&await e`
      UPDATE harness_shared.spawned_agents
         SET launcher_boot_id = ${K}, heartbeat_at = now()
       WHERE status IN ('running', 'restarting')
         AND spawn_id = ANY(${u}::text[])`;let p=[...s,...c,...l];if(p.length===0){let e=f.rows.map(e=>e.spawn_id);return{reclaimed:e.length,spawnIds:e,workspaces:[...new Set(f.rows.map(e=>e.workspace_id))],reattached:u,recovered:e,claimsReleased:f.claimsReleased}}let h=await e`
    UPDATE harness_shared.spawned_agents
       SET status = 'failed',
           finished_at = now(),
           duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint,
           error_message = COALESCE(
             error_message,
             CASE
               WHEN spawn_id = ANY(${l}::text[])
                 THEN 'reclaimed: launched by a prior operator incarnation (boot-id mismatch on '
                      || COALESCE(launcher_host, '?')
                      || ') — host restarted, concurrency ceiling freed by the reclaim sweep (EI-2186)'
               WHEN spawn_id = ANY(${s}::text[])
                 THEN 'reclaimed: child process (pid ' || COALESCE(pid::text, '?')
                      || ') confirmed dead on ' || COALESCE(launcher_host, '?')
                      || ' — concurrency ceiling freed by the P-011 reclaim sweep (EI-85)'
               ELSE 'reclaimed: spawn heartbeat stale > ' || ${n}::text
                      || 's (launching operator host presumed dead) — concurrency ceiling freed by the P-011 reclaim sweep'
             END
           )
     WHERE status IN ('running', 'restarting')
       AND spawn_id = ANY(${p}::text[])
    RETURNING spawn_id, workspace_id`,g=await O(e,h.map(e=>e.spawn_id)),_=await A(e);for(let t of h)m(e,t.spawn_id,t.workspace_id,`failed`).catch(()=>{});return{reclaimed:h.length+f.rows.length,spawnIds:[...f.rows.map(e=>e.spawn_id),...h.map(e=>e.spawn_id)],workspaces:[...new Set([...f.rows.map(e=>e.workspace_id),...h.map(e=>e.workspace_id)].filter(Boolean))],reattached:u,recovered:f.rows.map(e=>e.spawn_id),claimsReleased:{features:f.claimsReleased.features+g.features+_.features,issues:f.claimsReleased.issues+g.issues+_.issues,planClaims:f.claimsReleased.planClaims+g.planClaims+_.planClaims}}}function N(e){return!((e.run_id??``).startsWith(`launch-`)||e.spawn_id.startsWith(`durable-spawn:`))}function P(e,t){if(!N({spawn_id:e.spawnId,run_id:e.runId}))return`skip`;let n=e=>e instanceof Date?e.getTime():typeof e==`string`?new Date(e).getTime():NaN,r=n(e.startedAt);if(isNaN(r)||t.now-r<=t.minAgeMs)return`skip`;let i=e.lastOutputAt?n(e.lastOutputAt):null;return i==null?e.launcherHost===t.me&&e.pid!=null&&!t.isAlive(e.pid,`spawn`)?`proc-dead`:`skip`:isNaN(i)||t.now-i<=t.silentMs?`skip`:`stream-silent`}async function F(e,t={}){let n=t.minAgeMs??9e5,r=t.silentMs??9e5,i=t.now??Date.now(),a=t.isAlive??T,o=(0,z.hostname)(),s=await e`
    SELECT spawn_id, workspace_id, harness_slug, child_role,
           COALESCE(item_id, feature_id) AS work_item_id, result_path,
           run_id, started_at, last_output_at, launcher_host, pid
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
     ORDER BY started_at ASC
     LIMIT 500`;if(s.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};let c=await k(e,s.filter(e=>N(e))),l=new Set(c.rows.map(e=>e.spawn_id)),u=[],d=[];for(let e of s){if(l.has(e.spawn_id))continue;let t=P({spawnId:e.spawn_id,runId:e.run_id,startedAt:e.started_at,lastOutputAt:e.last_output_at,launcherHost:e.launcher_host,pid:e.pid},{now:i,minAgeMs:n,silentMs:r,me:o,isAlive:a});t===`stream-silent`?u.push(e.spawn_id):t===`proc-dead`&&d.push(e.spawn_id)}let f=[...u,...d];if(f.length===0){let e=c.rows.map(e=>e.spawn_id);return{reclaimed:e.length,spawnIds:e,workspaces:[...new Set(c.rows.map(e=>e.workspace_id).filter(Boolean))],recovered:e,claimsReleased:c.claimsReleased}}let p=await e`
    UPDATE harness_shared.spawned_agents
       SET status = 'failed',
           finished_at = now(),
           duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint,
           error_message = COALESCE(
             error_message,
             CASE WHEN spawn_id = ANY(${d}::text[]) THEN ${`reclaimed: spawn-ceiling-jam — recorded child process confirmed dead on this host with no stream activity (orphaned admission debit, EI-8839) — periodic admission-debit reconcile freed the concurrency-ceiling slot without waiting for the next operator restart; any held work-item claim is released by the next stale-claim sweep`} ELSE ${`reclaimed: spawn-ceiling-jam — no stream activity for > ${Math.round(r/6e4)}min despite an apparently-fresh heartbeat (reused-pid false-alive, EI-7204/EI-7197) — periodic admission-debit reconcile freed the concurrency-ceiling slot; any held work-item claim is released by the next stale-claim sweep`} END
           )
     WHERE status IN ('running', 'restarting')
       AND spawn_id = ANY(${f}::text[])
    RETURNING spawn_id, workspace_id`;for(let t of p)m(e,t.spawn_id,t.workspace_id,`failed`).catch(()=>{});return{reclaimed:p.length+c.rows.length,spawnIds:[...c.rows.map(e=>e.spawn_id),...p.map(e=>e.spawn_id)],workspaces:[...new Set([...c.rows.map(e=>e.workspace_id),...p.map(e=>e.workspace_id)].filter(Boolean))],recovered:c.rows.map(e=>e.spawn_id),claimsReleased:c.claimsReleased}}async function I(e,t,n={}){let r=n.silentMs??Y,i=n.staleMs??3e5,a=n.now??Date.now(),o=Math.max(1,Math.round(r/1e3)),s=Math.max(1,Math.round(i/1e3)),c=await e`
    SELECT spawn_id, workspace_id, launcher_host, launcher_boot_id, pid,
           heartbeat_at, last_output_at
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
       AND launcher_host = ${(0,z.hostname)()}
       AND launcher_boot_id = ${K}
       AND pid IS NOT NULL
       AND pid <> ${process.pid}
       AND heartbeat_at >= now() - ${s}::int * interval '1 second'
       AND last_output_at IS NOT NULL
       AND last_output_at < now() - ${o}::int * interval '1 second'`;if(c.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};let l=[],u=new Set;for(let e of c){if(!D({status:`running`,heartbeatAt:e.heartbeat_at,lastOutputAt:e.last_output_at},{now:a,silentMs:r,staleMs:i}))continue;let n=e.last_output_at?new Date(e.last_output_at).getTime():a;try{await t({spawnId:e.spawn_id,workspaceId:e.workspace_id,launcherHost:e.launcher_host,launcherBootId:e.launcher_boot_id,pid:e.pid,heartbeatAt:e.heartbeat_at,lastOutputAt:e.last_output_at,silentMs:Math.max(0,a-n)})&&(l.push(e.spawn_id),e.workspace_id&&u.add(e.workspace_id))}catch(t){console.warn(`[wedge-reclaim] reap failed for ${e.spawn_id} (will retry next tick): ${t instanceof Error?t.message:t}`)}}return{reclaimed:l.length,spawnIds:l,workspaces:[...u]}}function L(e,t={}){let n=t.now??Date.now(),r=t.silentMs??$,i=t.staleMs??3e5;if(e.status!==`running`&&e.status!==`restarting`||e.lastOutputAt||!e.heartbeatAt)return!1;let a=e=>e instanceof Date?e.getTime():typeof e==`string`?new Date(e).getTime():typeof e==`number`?e:NaN,o=a(e.heartbeatAt);if(isNaN(o)||n-o>i||!e.startedAt)return!1;let s=a(e.startedAt);return!isNaN(s)&&n-s>r}async function R(e,t,n={}){let r=n.silentMs??$,i=n.staleMs??3e5,a=n.now??Date.now(),o=Math.max(1,Math.round(r/1e3)),s=Math.max(1,Math.round(i/1e3)),c=await e`
    SELECT spawn_id, workspace_id, launcher_host, launcher_boot_id, pid,
           heartbeat_at, started_at
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
       AND launcher_host = ${(0,z.hostname)()}
       AND launcher_boot_id = ${K}
       AND pid IS NOT NULL
       AND pid <> ${process.pid}
       AND heartbeat_at >= now() - ${s}::int * interval '1 second'
       AND last_output_at IS NULL
       AND started_at < now() - ${o}::int * interval '1 second'`;if(c.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};let l=[],u=new Set;for(let e of c){if(!L({status:`running`,heartbeatAt:e.heartbeat_at,lastOutputAt:null,startedAt:e.started_at},{now:a,silentMs:r,staleMs:i}))continue;let n=new Date(e.started_at).getTime();try{await t({spawnId:e.spawn_id,workspaceId:e.workspace_id,launcherHost:e.launcher_host,launcherBootId:e.launcher_boot_id,pid:e.pid,heartbeatAt:e.heartbeat_at,startedAt:e.started_at,silentMs:Math.max(0,a-n)})&&(l.push(e.spawn_id),e.workspace_id&&u.add(e.workspace_id))}catch(t){console.warn(`[first-output-stall-reclaim] reap failed for ${e.spawn_id} (will retry next tick): ${t instanceof Error?t.message:t}`)}}return{reclaimed:l.length,spawnIds:l,workspaces:[...u]}}async function ne(e,t={}){let n=Math.max(1,Math.round((t.staleMs??3e5)/1e3)),r=(0,z.hostname)(),i=t.isAlive??T,a=await e`
    SELECT a.spawn_id, a.workspace_id, a.harness_slug, a.child_role,
           COALESCE(a.item_id, a.feature_id) AS work_item_id, a.result_path,
           a.pid, a.run_id
      FROM harness_shared.spawned_agents AS a
     WHERE a.status IN ('running', 'restarting')
       AND a.launcher_host = ${r}
       AND (
             (a.launcher_boot_id IS NOT NULL AND a.launcher_boot_id <> ${K})
          OR (a.launcher_boot_id IS NULL AND a.heartbeat_at < now() - ${n}::int * interval '1 second')
         )`,o=[],s=[],c=[];for(let e of a){let t=(e.run_id??``).startsWith(`launch-`)?`launch`:`spawn`;t===`spawn`&&x(e.result_path)?c.push(e):t===`spawn`&&e.pid!=null&&i(e.pid,t)?o.push(e.spawn_id):s.push(e.spawn_id)}let l=await k(e,c),u=[];if(o.length>0){let t=await e`
      UPDATE harness_shared.spawned_agents AS a
         SET launcher_boot_id = ${K},
             heartbeat_at = now()
       WHERE a.status IN ('running', 'restarting')
         AND a.spawn_id = ANY(${o}::text[])
      RETURNING a.spawn_id`;u.push(...t.map(e=>e.spawn_id))}if(s.length===0){let e=l.rows.map(e=>e.spawn_id);return{reclaimed:e.length,spawnIds:e,workspaces:[...new Set(l.rows.map(e=>e.workspace_id))],relaunched:[],reattached:u,recovered:e,claimsReleased:l.claimsReleased}}let d=await e`
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
         AND a.spawn_id = ANY(${s}::text[])
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
       AND f.harness_slug = r.harness_slug`;await O(e,d.map(e=>e.spawn_id));let f=[];if(t.relaunch){for(let e of d)if(j({childRole:e.child_role,workItemId:e.work_item_id,workItemStatus:e.work_item_status}))try{await t.relaunch({spawnId:e.spawn_id,workspaceId:e.workspace_id,harnessSlug:e.harness_slug,childRole:e.child_role,parentSpawnId:e.parent_spawn_id,parentRole:e.parent_role,workItemId:e.work_item_id,workItemStatus:e.work_item_status,planSlug:e.plan_slug,modelSpec:e.model_spec,modelTier:e.model_tier,brief:e.brief})&&f.push(e.spawn_id)}catch(t){console.warn(`[spawn-reclaim] boot re-launch failed for ${e.child_role} ${e.spawn_id} (${e.harness_slug}); left reclaimed: ${t instanceof Error?t.message:t}`)}}let p=new Set(f);for(let t of d)p.has(t.spawn_id)||m(e,t.spawn_id,t.workspace_id,`failed`).catch(()=>{});return{reclaimed:d.length+l.rows.length,spawnIds:[...l.rows.map(e=>e.spawn_id),...d.map(e=>e.spawn_id)],workspaces:[...new Set([...l.rows.map(e=>e.workspace_id),...d.map(e=>e.workspace_id)].filter(Boolean))],relaunched:f,reattached:u,recovered:l.rows.map(e=>e.spawn_id)}}var z,B,V,H,U,W,G,K,q,J,Y,X,Z,Q,$,re=e((()=>{z=t(i(),1),B=t(i(),1),V=t(i(),1),H=t(i(),1),h(),f(),b(),U=`__INVOCATION_RESULT__:`,W=`__INVOCATION_DONE__`,G=6e4,K=(0,V.randomUUID)(),q=5*6e4,J=10*6e4,Y=(()=>{let e=Number({}.PAPERCUSP_WEDGE_REAP_MS);return Number.isFinite(e)&&e>=6e4?e:30*6e4})(),X=new Set([`passed`,`deprecated`]),Z=15*6e4,Q=15*6e4,$=(()=>{let e=Number({}.PAPERCUSP_FIRST_OUTPUT_STALL_MS);return Number.isFinite(e)&&e>=6e4?e:5*6e4})()}));export{h as A,O as C,A as D,ee as E,b as O,te as S,j as T,F as _,G as a,I as b,w as c,re as d,L as f,x as g,C as h,q as i,m as j,v as k,P as l,T as m,Q as n,Y as o,D as p,$ as r,J as s,Z as t,E as u,R as v,S as w,ne as x,M as y};