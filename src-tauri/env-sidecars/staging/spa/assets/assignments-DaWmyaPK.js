import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-DTtGQmae.js";import{n as r,t as i}from"./workspace-id-constant-E7VkkAiJ.js";import{n as a,s as o}from"./workspace-registry-C3lTKlnO.js";import{n as s}from"./windows-desktop-windows-Cl2tsZ27.js";function c(e,t){e?.code!==`42P01`&&console.warn(`[adv-sessions] ${t} failed:`,e.message)}function l(e){if(e==null)return null;if(e instanceof Date)return e.toISOString();let t=new Date(e);if(!Number.isNaN(t.getTime()))return t.toISOString();throw Error(`invalid timestamp: ${String(e)}`)}function u(e){return{id:e.id,workspaceId:e.workspace_id,planSlug:e.plan_slug,agent:e.agent??null,role:e.role??null,feature:e.feature??null,mode:e.mode,terminalBin:e.terminal_bin,pid:e.pid,windowId:e.window_id,ompThreadId:e.omp_thread_id,cwd:e.cwd,coordOwnerId:e.coord_owner_id??null,sessionId:e.session_id??null,display:e.display??null,launchArgv:e.launch_argv??null,launchedAt:l(e.launched_at??null),label:e.label,startedAt:l(e.started_at),endedAt:l(e.ended_at),exitCode:e.exit_code}}async function d(e,n){try{let{sql:r}=t();await r`
      UPDATE harness_shared.adv_sessions
         SET ended_at = now(), exit_code = ${n}
       WHERE id = ${e} AND ended_at IS NULL
    `}catch(e){c(e,`markAdvSessionEnded`)}}async function f(e){try{let{sql:n}=t(),r=(await n`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE workspace_id = ${a()}
         AND id = ${e}
       LIMIT 1
    `)[0];return r?u(r):null}catch(e){return c(e,`getAdvSession`),null}}async function p(e=500){let n=new Map;try{let{sql:r}=t(),i=await r`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id IS NOT NULL
       ORDER BY started_at DESC
       LIMIT ${e}
    `;for(let e of i){let t=u(e);t.coordOwnerId&&!n.has(t.coordOwnerId)&&n.set(t.coordOwnerId,t)}}catch(e){c(e,`advSessionsByCoordOwner`)}return n}async function m(e={}){let n=e.workspaceId??null,r=Math.max(1,Math.round((e.maxAgeMs??432e5)/1e3)),i=e.limit??500;try{let{sql:e}=t();return(await e`
      SELECT DISTINCT ON (coord_owner_id)
             id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE ended_at IS NULL
         AND coord_owner_id IS NOT NULL
         AND started_at > now() - make_interval(secs => ${r})
         AND (${n}::text IS NULL OR workspace_id = ${n})
       ORDER BY coord_owner_id, started_at DESC
       LIMIT ${i}
    `).map(u)}catch(e){return c(e,`listRecordedLiveSessions`),[]}}async function h(e){let n=[...new Set(e.filter(e=>!!e&&!e.startsWith(`fed:`)))];if(n.length===0)return new Set;try{let{sql:e}=t(),r=await e`
      SELECT DISTINCT ON (coord_owner_id) coord_owner_id, ended_at
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ANY(${n}::text[])
       ORDER BY coord_owner_id, started_at DESC
    `;return new Set(r.filter(e=>e.ended_at!=null).map(e=>e.coord_owner_id))}catch(e){return c(e,`endedRecordedOwnerIds`),new Set}}async function g(e){let n=[...new Set(e.filter(e=>!!e&&!e.startsWith(`fed:`)))];if(n.length===0)return new Set;try{let{sql:e}=t(),r=await e`
      WITH requested(id) AS (
        SELECT unnest(${n}::text[])
      ),
      live_adv AS (
        SELECT coord_owner_id AS owner_id
          FROM harness_shared.adv_sessions
         WHERE coord_owner_id = ANY(${n}::text[])
           AND ended_at IS NULL
      ),
      live_spawn AS (
        SELECT alias.owner_id
          FROM harness_shared.spawned_agents sa
          CROSS JOIN LATERAL (
            VALUES (sa.spawn_id), (sa.session_owner), (sa.run_id)
          ) AS alias(owner_id)
          JOIN requested r ON r.id = alias.owner_id
         WHERE sa.status = 'running'
           AND sa.finished_at IS NULL
           AND sa.heartbeat_at > now() - interval '10 minutes'
      )
      SELECT DISTINCT owner_id FROM live_adv
      UNION
      SELECT DISTINCT owner_id FROM live_spawn
    `;return new Set(r.map(e=>e.owner_id))}catch(e){return c(e,`recordedLiveOwnerIds`),new Set}}async function _(e){try{let{sql:n}=t(),r=(await n`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ${e}
       ORDER BY started_at DESC
       LIMIT 1
    `)[0];return r?u(r):null}catch(e){return c(e,`latestAdvSessionByCoordOwner`),null}}var v=e((()=>{n(),o(),s()}));function y(e){return e.agentId?e.orphaned?`dead`:e.stalled?`stalled`:e.holderAlive?e.lastProgressAt?`progressing`:`alive`:`reserved`:`free`}function b(e,t){return t.size===0?e:e.map(e=>{if(!e.agentId||!e.holderAlive||!t.has(e.agentId))return e;let n=e.source!==`presence`;return{...e,holderAlive:!1,orphaned:n&&e.claimActive!==!1?!0:e.orphaned}})}function x(e,t){return t.size===0?e:e.map(e=>{if(!e.agentId||!t.has(e.agentId))return e;let n=e.source!==`presence`;return{...e,holderPresent:!0,holderAlive:!0,orphaned:n&&e.claimActive!==!1?!1:e.orphaned}})}async function S(e={}){let{sql:n}=t(),r=e.activeOnly!==!1,a=(await n`
    SELECT * FROM harness_shared.fleet_assignment
    WHERE ${e.workspaceId==null?n`TRUE`:n`(workspace_id = ${e.workspaceId} OR workspace_id = ${T} OR workspace_id = ${i})`}
      AND ${e.agent?n`(agent_id = ${e.agent} OR agent_name = ${e.agent})`:n`TRUE`}
      AND ${e.plan?n`plan_slug = ${e.plan}`:n`TRUE`}
      AND ${e.harness?n`harness_slug = ${e.harness}`:n`TRUE`}
      AND ${r?n`(claim_active IS DISTINCT FROM false)`:n`TRUE`}
    ORDER BY source, holder_heartbeat_at DESC NULLS LAST
  `).map(e=>({source:e.source,workspaceId:e.workspace_id,agentId:e.agent_id??null,agentLabel:e.agent_label??null,agentName:e.agent_name??null,harnessSlug:e.harness_slug??null,planSlug:e.plan_slug??null,itemId:e.item_id??null,workItemId:e.work_item_id??null,itemKind:e.item_kind??null,detail:e.detail??``,status:e.status??null,claimAcquiredTs:E(e.claim_acquired_ts),claimExpiresTs:E(e.claim_expires_ts),claimActive:e.claim_active??null,livenessMode:e.liveness_mode??null,lastActivityTs:E(e.last_activity_ts),holderPresent:!!e.holder_present,holderAlive:!!e.holder_alive,holderHeartbeatAt:E(e.holder_heartbeat_at),holderIntent:e.holder_intent??null,holderPlanSlug:e.holder_plan_slug??null,orphaned:!!e.orphaned,stalled:e.stalled??null,lastProgressAt:E(e.last_progress_at),declaredPlanMatches:e.declared_plan_matches??null,assigneeRank:e.assignee_rank==null?null:Number(e.assignee_rank),rankWriter:e.rank_writer??null,fleetSlug:e.fleet_slug??null,fleetRole:e.fleet_role??null})),o=[...new Set(a.filter(e=>e.agentId).map(e=>e.agentId))];if(o.length===0)return a;let[s,c]=await Promise.all([h(o),g(o)]);return b(x(a,new Set([...c].filter(e=>!s.has(e)))),s)}function C(e){return{type:e.source===`plan_item_claim`?`plan-item`:e.source===`plan_item_assignment`?`assignment`:`work-item`,harnessSlug:e.harnessSlug,planSlug:e.planSlug,id:e.itemId??e.workItemId,itemKind:e.itemKind,detail:e.detail,status:e.status,acquiredTs:e.claimAcquiredTs,expiresTs:e.claimExpiresTs,active:e.claimActive!==!1,orphaned:e.orphaned,stalled:e.stalled,lastProgressAt:e.lastProgressAt,activity:y(e),rank:e.assigneeRank,rankWriter:e.rankWriter}}function w(e){let t=new Map,n=new Map,r=e=>{let n=t.get(e);return n||(n={agentId:e,label:null,name:null,present:!1,alive:!1,heartbeatAt:null,intent:``,declaredPlanSlug:null,fleetSlug:null,fleetRole:null,claims:[],orphaned:!1,stalled:!1,declaredUnclaimed:!1,doing:null,queued:[],load:0},t.set(e,n)),n},i=new Map;for(let t of e){if(!t.agentId||t.source===`plan_item_assignment`)continue;let e=r(t.agentId);if(e.label=e.label??t.agentLabel,t.source===`presence`)e.present=!0,e.alive=t.holderAlive,e.heartbeatAt=t.holderHeartbeatAt,e.intent=t.detail,e.declaredPlanSlug=t.planSlug,e.fleetSlug=t.fleetSlug??null,e.fleetRole=t.fleetRole??null;else{if(e.claims.push(C(t)),t.source===`work_item_claim`&&t.workItemId){let e=n.get(t.agentId)??[];e.push({id:t.workItemId,itemKind:t.itemKind,title:t.detail,status:t.status,rank:t.assigneeRank,rankWriter:t.rankWriter,activity:y(t)}),n.set(t.agentId,e)}t.orphaned&&(e.orphaned=!0),t.stalled&&(e.stalled=!0),t.holderPresent&&(e.present=!0,e.alive=e.alive||t.holderAlive,e.heartbeatAt=e.heartbeatAt??t.holderHeartbeatAt,e.intent=e.intent||(t.holderIntent??``),e.declaredPlanSlug=e.declaredPlanSlug??t.holderPlanSlug,e.fleetSlug=e.fleetSlug??t.fleetSlug??null,e.fleetRole=e.fleetRole??t.fleetRole??null),t.agentName&&(e.name=e.name??t.agentName,i.set(t.agentName,t.agentId))}}for(let t of e){if(t.source!==`plan_item_assignment`||!t.agentId)continue;let e=r(i.get(t.agentId)??t.agentId);e.name=e.name??t.agentId,e.claims.push(C(t))}for(let e of t.values()){e.declaredUnclaimed=!!(e.declaredPlanSlug&&!e.claims.some(t=>t.planSlug===e.declaredPlanSlug));let t=n.get(e.agentId)??[];t.sort((e,t)=>{let n=e.rank??1/0,r=t.rank??1/0;return n===r?e.id<t.id?-1:+(e.id>t.id):n-r}),e.queued=t,e.doing=t[0]??null,e.load=t.length}return[...t.values()].sort((e,t)=>{if(e.alive!==t.alive)return e.alive?-1:1;let n=e.orphaned||e.stalled;return n===(t.orphaned||t.stalled)?(t.heartbeatAt??``).localeCompare(e.heartbeatAt??``):n?-1:1})}var T,E,D=e((()=>{n(),r(),v(),T=`*`,E=e=>e==null?null:e instanceof Date?e.toISOString():String(e)}));export{S as a,f as c,m as d,d as f,D as i,v as l,b as n,x as o,w as r,p as s,y as t,_ as u};