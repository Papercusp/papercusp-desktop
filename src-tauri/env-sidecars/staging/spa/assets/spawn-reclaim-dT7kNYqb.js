import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{c as r,o as i}from"./inbox-wake-Bx_cRXL1.js";import{r as a,t as o}from"./work-item-dispatch-states-DUjVV9AI.js";async function s(e,t,n,i){try{let a=await e`
      SELECT spawn_id, parent_spawn_id, workspace_id, session_owner, status,
             error_message, output_tail, exit_code
        FROM harness_shared.spawned_agents
       WHERE spawn_id = ${t} AND workspace_id = ${n}`;if(a.length===0)return{parentWoken:!1};let o=a[0];if(!o.parent_spawn_id)return{parentWoken:!1};let s=o.parent_spawn_id,c=`Child spawn ${t} reached terminal status: ${i}`,l={childSpawnId:t,status:i,errorMessage:o.error_message,outputTail:o.output_tail,exitCode:o.exit_code};return{parentWoken:(await r([s],{summary:c,payload:l,source:`spawn-finish`,workspaceId:n})).woken>0,parentSpawnId:o.parent_spawn_id,parentOwnerId:s}}catch(e){return console.warn(`[parent-wake] failed to wake parent of spawn ${t}: ${e instanceof Error?e.message:String(e)}`),{parentWoken:!1}}}var c=e((()=>{i()}));function l(){return k}function u(e){k=e}async function d(e,t,n){await e`
    UPDATE harness_shared.spawned_agents
       SET pid = ${n}, launcher_host = ${(0,T.hostname)()}, launcher_boot_id = ${k}
     WHERE spawn_id = ${t} AND status IN ('running', 'restarting')`}function f(e,t=`spawn`){if(!Number.isInteger(e)||e<=1)return!1;if(e===process.pid)return!0;if(process.platform!==`linux`)return!1;try{let n=(0,E.readFileSync)(`/proc/${e}/cmdline`,`utf8`);return t===`launch`?n.length>0:n.includes(`invoke-once`)}catch{return!1}}async function p(e,t,n){if(t.length===0)return;let r=n?t.filter(e=>n.has(e)):[],i=r.length===0?t:t.filter(e=>!n.has(e));i.length>0&&await e`
      UPDATE harness_shared.spawned_agents
         SET heartbeat_at = now()
       WHERE spawn_id = ANY(${i}::text[])
         AND status IN ('running', 'restarting')`,r.length>0&&await e`
      UPDATE harness_shared.spawned_agents AS a
         SET heartbeat_at = now(),
             last_output_at = GREATEST(coalesce(a.last_output_at, 'epoch'::timestamptz), u.output_at)
        FROM unnest(${r}::text[], ${r.map(e=>new Date(n.get(e)).toISOString())}::timestamptz[]) AS u(spawn_id, output_at)
       WHERE a.spawn_id = u.spawn_id
         AND a.status IN ('running', 'restarting')`}function m(e,t={}){let n=t.now??Date.now(),r=t.silentMs??6e5,i=t.staleMs??3e5;if(e.status!==`running`&&e.status!==`restarting`||!e.heartbeatAt)return!1;let a=e=>e instanceof Date?e.getTime():typeof e==`string`?new Date(e).getTime():typeof e==`number`?e:NaN,o=a(e.heartbeatAt);if(isNaN(o)||n-o>i||!e.lastOutputAt)return!1;let s=a(e.lastOutputAt);return!isNaN(s)&&n-s>r}async function h(e,t){if(t.length===0)return{features:0,issues:0,planClaims:0};let n=await e`
    UPDATE harness_shared.harness_features_consolidated
       SET taken_by = NULL, taken_at = NULL, last_progress_at = NULL,
           status = CASE WHEN status <> ALL(${[...o]}::text[]) THEN 'todo' ELSE status END,
           updated_ts = ${Date.now()}
     WHERE taken_by = ANY(${t}::text[])
    RETURNING feature_id`,r=await e`
    UPDATE harness_shared.engineer_issues
       SET assignee = NULL, assigned_at = NULL, origin = 'local', updated_at = now()
     WHERE assignee = ANY(${t}::text[])
    RETURNING issue_id`,i=await e`
    DELETE FROM harness_shared.plan_item_claims
     WHERE owner = ANY(${t}::text[])
    RETURNING item_id`,a={features:n.length,issues:r.length,planClaims:i.length};return(a.features||a.issues||a.planClaims)&&console.log(`[spawn-reclaim] released dead-holder claims: ${a.features} feature(s) [${n.map(e=>e.feature_id).join(`, `)}], ${a.issues} issue(s), ${a.planClaims} plan claim(s)`),a}async function g(e){let t=await e`
    UPDATE harness_shared.harness_features_consolidated f
       SET taken_by = NULL, taken_at = NULL, last_progress_at = NULL,
           status = CASE WHEN f.status <> ALL(${[...o]}::text[]) THEN 'todo' ELSE f.status END,
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
    RETURNING c.item_id`,i={features:t.length,issues:n.length,planClaims:r.length};return(i.features||i.issues||i.planClaims)&&console.log(`[spawn-reclaim] stale-claim backstop freed: ${i.features} feature(s) [${t.map(e=>`${e.feature_id}←${e.taken_by}`).join(`, `)}], ${i.issues} issue(s), ${i.planClaims} plan claim(s)`),i}function _(e){return e.childRole===`mug`?!0:e.childRole!==`cup`||!e.workItemId||!e.workItemStatus?!1:!N.has(e.workItemStatus)}async function v(e,t={}){let n=Math.max(1,Math.round((t.staleMs??3e5)/1e3)),r=t.isAlive??f,i=await e`
    SELECT spawn_id, workspace_id, pid, launcher_host, run_id, launcher_boot_id
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
       AND heartbeat_at < now() - ${n}::int * interval '1 second'`;if(i.length===0)return{reclaimed:0,spawnIds:[],workspaces:[],claimsReleased:await g(e)};let a=(0,T.hostname)(),o=[],c=[],l=[],u=[];for(let e of i){let t=e.launcher_host!=null&&e.launcher_host===a;if(t&&e.launcher_boot_id!=null&&e.launcher_boot_id!==k){u.push(e.spawn_id);continue}let n=(e.run_id??``).startsWith(`launch-`)||e.spawn_id.startsWith(`durable-spawn:`)?`launch`:`spawn`;t&&e.pid!=null?r(e.pid,n)?o.push(e.spawn_id):c.push(e.spawn_id):l.push(e.spawn_id)}o.length>0&&await p(e,o);let d=[...c,...l,...u];if(d.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};let m=await e`
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
               WHEN spawn_id = ANY(${c}::text[])
                 THEN 'reclaimed: child process (pid ' || COALESCE(pid::text, '?')
                      || ') confirmed dead on ' || COALESCE(launcher_host, '?')
                      || ' — concurrency ceiling freed by the P-011 reclaim sweep (EI-85)'
               ELSE 'reclaimed: spawn heartbeat stale > ' || ${n}::text
                      || 's (launching operator host presumed dead) — concurrency ceiling freed by the P-011 reclaim sweep'
             END
           )
     WHERE status IN ('running', 'restarting')
       AND spawn_id = ANY(${d}::text[])
    RETURNING spawn_id, workspace_id`,_=await h(e,m.map(e=>e.spawn_id)),v=await g(e);for(let t of m)s(e,t.spawn_id,t.workspace_id,`failed`).catch(()=>{});return{reclaimed:m.length,spawnIds:m.map(e=>e.spawn_id),workspaces:[...new Set(m.map(e=>e.workspace_id).filter(Boolean))],claimsReleased:{features:_.features+v.features,issues:_.issues+v.issues,planClaims:_.planClaims+v.planClaims}}}function y(e){return!((e.run_id??``).startsWith(`launch-`)||e.spawn_id.startsWith(`durable-spawn:`))}async function b(e,t={}){let n=t.minAgeMs??9e5,r=t.silentMs??9e5,i=t.now??Date.now(),a=await e`
    SELECT spawn_id, workspace_id, run_id, started_at, last_output_at
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
     ORDER BY started_at ASC
     LIMIT 500`;if(a.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};let o=[];for(let e of a){if(!y({spawn_id:e.spawn_id,run_id:e.run_id}))continue;let t=new Date(e.started_at).getTime();if(isNaN(t)||i-t<=n)continue;let a=e.last_output_at?new Date(e.last_output_at).getTime():null;a!=null&&(isNaN(a)||i-a<=r||o.push(e.spawn_id))}if(o.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};let c=await e`
    UPDATE harness_shared.spawned_agents
       SET status = 'failed',
           finished_at = now(),
           duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint,
           error_message = COALESCE(error_message, ${`reclaimed: spawn-ceiling-jam — no stream activity for > ${Math.round(r/6e4)}min despite an apparently-fresh heartbeat (reused-pid false-alive, EI-7204/EI-7197) — periodic admission-debit reconcile freed the concurrency-ceiling slot; any held work-item claim is released by the next stale-claim sweep`})
     WHERE status IN ('running', 'restarting')
       AND spawn_id = ANY(${o}::text[])
    RETURNING spawn_id, workspace_id`;for(let t of c)s(e,t.spawn_id,t.workspace_id,`failed`).catch(()=>{});return{reclaimed:c.length,spawnIds:c.map(e=>e.spawn_id),workspaces:[...new Set(c.map(e=>e.workspace_id).filter(Boolean))]}}async function x(e,t,n={}){let r=n.silentMs??M,i=n.staleMs??3e5,a=n.now??Date.now(),o=Math.max(1,Math.round(r/1e3)),s=Math.max(1,Math.round(i/1e3)),c=await e`
    SELECT spawn_id, workspace_id, launcher_host, launcher_boot_id, pid,
           heartbeat_at, last_output_at
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
       AND launcher_host = ${(0,T.hostname)()}
       AND launcher_boot_id = ${k}
       AND pid IS NOT NULL
       AND pid <> ${process.pid}
       AND heartbeat_at >= now() - ${s}::int * interval '1 second'
       AND last_output_at IS NOT NULL
       AND last_output_at < now() - ${o}::int * interval '1 second'`;if(c.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};let l=[],u=new Set;for(let e of c){if(!m({status:`running`,heartbeatAt:e.heartbeat_at,lastOutputAt:e.last_output_at},{now:a,silentMs:r,staleMs:i}))continue;let n=e.last_output_at?new Date(e.last_output_at).getTime():a;try{await t({spawnId:e.spawn_id,workspaceId:e.workspace_id,launcherHost:e.launcher_host,launcherBootId:e.launcher_boot_id,pid:e.pid,heartbeatAt:e.heartbeat_at,lastOutputAt:e.last_output_at,silentMs:Math.max(0,a-n)})&&(l.push(e.spawn_id),e.workspace_id&&u.add(e.workspace_id))}catch(t){console.warn(`[wedge-reclaim] reap failed for ${e.spawn_id} (will retry next tick): ${t instanceof Error?t.message:t}`)}}return{reclaimed:l.length,spawnIds:l,workspaces:[...u]}}function S(e,t={}){let n=t.now??Date.now(),r=t.silentMs??I,i=t.staleMs??3e5;if(e.status!==`running`&&e.status!==`restarting`||e.lastOutputAt||!e.heartbeatAt)return!1;let a=e=>e instanceof Date?e.getTime():typeof e==`string`?new Date(e).getTime():typeof e==`number`?e:NaN,o=a(e.heartbeatAt);if(isNaN(o)||n-o>i||!e.startedAt)return!1;let s=a(e.startedAt);return!isNaN(s)&&n-s>r}async function C(e,t,n={}){let r=n.silentMs??I,i=n.staleMs??3e5,a=n.now??Date.now(),o=Math.max(1,Math.round(r/1e3)),s=Math.max(1,Math.round(i/1e3)),c=await e`
    SELECT spawn_id, workspace_id, launcher_host, launcher_boot_id, pid,
           heartbeat_at, started_at
      FROM harness_shared.spawned_agents
     WHERE status IN ('running', 'restarting')
       AND launcher_host = ${(0,T.hostname)()}
       AND launcher_boot_id = ${k}
       AND pid IS NOT NULL
       AND pid <> ${process.pid}
       AND heartbeat_at >= now() - ${s}::int * interval '1 second'
       AND last_output_at IS NULL
       AND started_at < now() - ${o}::int * interval '1 second'`;if(c.length===0)return{reclaimed:0,spawnIds:[],workspaces:[]};let l=[],u=new Set;for(let e of c){if(!S({status:`running`,heartbeatAt:e.heartbeat_at,lastOutputAt:null,startedAt:e.started_at},{now:a,silentMs:r,staleMs:i}))continue;let n=new Date(e.started_at).getTime();try{await t({spawnId:e.spawn_id,workspaceId:e.workspace_id,launcherHost:e.launcher_host,launcherBootId:e.launcher_boot_id,pid:e.pid,heartbeatAt:e.heartbeat_at,startedAt:e.started_at,silentMs:Math.max(0,a-n)})&&(l.push(e.spawn_id),e.workspace_id&&u.add(e.workspace_id))}catch(t){console.warn(`[first-output-stall-reclaim] reap failed for ${e.spawn_id} (will retry next tick): ${t instanceof Error?t.message:t}`)}}return{reclaimed:l.length,spawnIds:l,workspaces:[...u]}}async function w(e,t={}){let n=Math.max(1,Math.round((t.staleMs??3e5)/1e3)),r=(0,T.hostname)(),i=t.isAlive??f,a=await e`
    SELECT a.spawn_id, a.pid, a.run_id
      FROM harness_shared.spawned_agents AS a
     WHERE a.status IN ('running', 'restarting')
       AND a.launcher_host = ${r}
       AND (
             (a.launcher_boot_id IS NOT NULL AND a.launcher_boot_id <> ${k})
          OR (a.launcher_boot_id IS NULL AND a.heartbeat_at < now() - ${n}::int * interval '1 second')
         )`,o=[],c=[];for(let e of a){let t=(e.run_id??``).startsWith(`launch-`)?`launch`:`spawn`;t===`spawn`&&e.pid!=null&&i(e.pid,t)?o.push(e.spawn_id):c.push(e.spawn_id)}let l=[];if(o.length>0){let t=await e`
      UPDATE harness_shared.spawned_agents AS a
         SET launcher_boot_id = ${k},
             heartbeat_at = now()
       WHERE a.status IN ('running', 'restarting')
         AND a.spawn_id = ANY(${o}::text[])
      RETURNING a.spawn_id`;l.push(...t.map(e=>e.spawn_id))}if(c.length===0)return{reclaimed:0,spawnIds:[],workspaces:[],relaunched:[],reattached:l};let u=await e`
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
         AND a.spawn_id = ANY(${c}::text[])
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
       AND f.harness_slug = r.harness_slug`;await h(e,u.map(e=>e.spawn_id));let d=[];if(t.relaunch){for(let e of u)if(_({childRole:e.child_role,workItemId:e.work_item_id,workItemStatus:e.work_item_status}))try{await t.relaunch({spawnId:e.spawn_id,workspaceId:e.workspace_id,harnessSlug:e.harness_slug,childRole:e.child_role,parentSpawnId:e.parent_spawn_id,parentRole:e.parent_role,workItemId:e.work_item_id,workItemStatus:e.work_item_status,planSlug:e.plan_slug,modelSpec:e.model_spec,modelTier:e.model_tier,brief:e.brief})&&d.push(e.spawn_id)}catch(t){console.warn(`[spawn-reclaim] boot re-launch failed for ${e.child_role} ${e.spawn_id} (${e.harness_slug}); left reclaimed: ${t instanceof Error?t.message:t}`)}}let p=new Set(d);for(let t of u)p.has(t.spawn_id)||s(e,t.spawn_id,t.workspace_id,`failed`).catch(()=>{});return{reclaimed:u.length,spawnIds:u.map(e=>e.spawn_id),workspaces:[...new Set(u.map(e=>e.workspace_id).filter(Boolean))],relaunched:d,reattached:l}}var T,E,D,O,k,A,j,M,N,P,F,I,L=e((()=>{T=t(n(),1),E=t(n(),1),D=t(n(),1),c(),a(),O=6e4,k=(0,D.randomUUID)(),A=5*6e4,j=10*6e4,M=(()=>{let e=Number({}.PAPERCUSP_WEDGE_REAP_MS);return Number.isFinite(e)&&e>=6e4?e:30*6e4})(),N=new Set([`passed`,`deprecated`]),P=15*6e4,F=15*6e4,I=(()=>{let e=Number({}.PAPERCUSP_FIRST_OUTPUT_STALL_MS);return Number.isFinite(e)&&e>=6e4?e:5*6e4})()}));export{g as C,_ as S,s as T,v as _,O as a,d as b,u as c,S as d,m as f,C as g,b as h,A as i,p as l,l as m,F as n,M as o,f as p,I as r,j as s,P as t,L as u,x as v,c as w,h as x,w as y};