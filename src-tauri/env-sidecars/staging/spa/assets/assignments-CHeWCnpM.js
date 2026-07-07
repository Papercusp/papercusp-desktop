import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{q as r,t as i}from"./src-DTtGQmae.js";import{n as a,t as o}from"./workspace-id-constant-E7VkkAiJ.js";import{n as s,s as c}from"./workspace-registry-C3lTKlnO.js";function l(){if(m!=null)return m;if(process.platform===`win32`)m=!0;else if(process.platform!==`linux`)m=!1;else try{m=/microsoft/i.test((0,p.readFileSync)(`/proc/version`,`utf8`))}catch{m=!1}return m}function u(e=Date.now()){return!g||e-g.at>h?null:g.windows}async function d(e){if(!l())return[];let t=u();return t?e?t.filter(t=>t.title.startsWith(e)):t:[]}function f(e){if(!e.startsWith(`Papercup — `))return null;let t=e.slice(11).trim();return t.length>0?t:null}var p,m,h,g,_=e((()=>{p=t(n(),1),m=null,h=6e4,g=null}));function v(e,t){e?.code!==`42P01`&&console.warn(`[adv-sessions] ${t} failed:`,e.message)}function y(e){if(e==null)return null;if(e instanceof Date)return e.toISOString();let t=new Date(e);if(!Number.isNaN(t.getTime()))return t.toISOString();throw Error(`invalid timestamp: ${String(e)}`)}function b(e){return{id:e.id,workspaceId:e.workspace_id,planSlug:e.plan_slug,agent:e.agent??null,role:e.role??null,feature:e.feature??null,mode:e.mode,terminalBin:e.terminal_bin,pid:e.pid,windowId:e.window_id,ompThreadId:e.omp_thread_id,cwd:e.cwd,coordOwnerId:e.coord_owner_id??null,sessionId:e.session_id??null,display:e.display??null,launchArgv:e.launch_argv??null,launchedAt:y(e.launched_at??null),label:e.label,startedAt:y(e.started_at),endedAt:y(e.ended_at),exitCode:e.exit_code}}async function x(e,t){try{let{sql:n}=r();await n`
      UPDATE harness_shared.adv_sessions
         SET ended_at = now(), exit_code = ${t}
       WHERE id = ${e} AND ended_at IS NULL
    `}catch(e){v(e,`markAdvSessionEnded`)}}async function S(e){try{let{sql:t}=r(),n=(await t`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE workspace_id = ${s()}
         AND id = ${e}
       LIMIT 1
    `)[0];return n?b(n):null}catch(e){return v(e,`getAdvSession`),null}}async function C(e=500){let t=new Map;try{let{sql:n}=r(),i=await n`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id IS NOT NULL
       ORDER BY started_at DESC
       LIMIT ${e}
    `;for(let e of i){let n=b(e);n.coordOwnerId&&!t.has(n.coordOwnerId)&&t.set(n.coordOwnerId,n)}}catch(e){v(e,`advSessionsByCoordOwner`)}return t}async function w(e={}){let t=e.workspaceId??null,n=Math.max(1,Math.round((e.maxAgeMs??432e5)/1e3)),i=e.limit??500;try{let{sql:e}=r();return(await e`
      SELECT DISTINCT ON (coord_owner_id)
             id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE ended_at IS NULL
         AND coord_owner_id IS NOT NULL
         AND started_at > now() - make_interval(secs => ${n})
         AND (${t}::text IS NULL OR workspace_id = ${t})
       ORDER BY coord_owner_id, started_at DESC
       LIMIT ${i}
    `).map(b)}catch(e){return v(e,`listRecordedLiveSessions`),[]}}async function T(e){let t=[...new Set(e.filter(e=>!!e&&!e.startsWith(`fed:`)))];if(t.length===0)return new Set;try{let{sql:e}=r(),n=await e`
      SELECT DISTINCT ON (coord_owner_id) coord_owner_id, ended_at
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ANY(${t}::text[])
       ORDER BY coord_owner_id, started_at DESC
    `;return new Set(n.filter(e=>e.ended_at!=null).map(e=>e.coord_owner_id))}catch(e){return v(e,`endedRecordedOwnerIds`),new Set}}async function E(e){let t=[...new Set(e.filter(e=>!!e&&!e.startsWith(`fed:`)))];if(t.length===0)return new Set;try{let{sql:e}=r(),n=await e`
      WITH requested(id) AS (
        SELECT unnest(${t}::text[])
      ),
      live_adv AS (
        SELECT coord_owner_id AS owner_id
          FROM harness_shared.adv_sessions
         WHERE coord_owner_id = ANY(${t}::text[])
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
    `;return new Set(n.map(e=>e.owner_id))}catch(e){return v(e,`recordedLiveOwnerIds`),new Set}}async function D(e){try{let{sql:t}=r(),n=(await t`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ${e}
       ORDER BY started_at DESC
       LIMIT 1
    `)[0];return n?b(n):null}catch(e){return v(e,`latestAdvSessionByCoordOwner`),null}}var O=e((()=>{i(),c(),_()}));function k(e){return e.agentId?e.orphaned?`dead`:e.stalled?`stalled`:e.holderAlive?e.lastProgressAt?`progressing`:`alive`:`reserved`:`free`}function A(e,t){return t.size===0?e:e.map(e=>{if(!e.agentId||!e.holderAlive||!t.has(e.agentId))return e;let n=e.source!==`presence`;return{...e,holderAlive:!1,orphaned:n&&e.claimActive!==!1?!0:e.orphaned}})}function j(e,t){return t.size===0?e:e.map(e=>{if(!e.agentId||!t.has(e.agentId))return e;let n=e.source!==`presence`;return{...e,holderPresent:!0,holderAlive:!0,orphaned:n&&e.claimActive!==!1?!1:e.orphaned}})}async function M(e={}){let{sql:t}=r(),n=e.activeOnly!==!1,i=(await t`
    SELECT * FROM harness_shared.fleet_assignment
    WHERE ${e.workspaceId==null?t`TRUE`:t`(workspace_id = ${e.workspaceId} OR workspace_id = ${F} OR workspace_id = ${o})`}
      AND ${e.agent?t`(agent_id = ${e.agent} OR agent_name = ${e.agent})`:t`TRUE`}
      AND ${e.plan?t`plan_slug = ${e.plan}`:t`TRUE`}
      AND ${e.harness?t`harness_slug = ${e.harness}`:t`TRUE`}
      AND ${n?t`(claim_active IS DISTINCT FROM false)`:t`TRUE`}
    ORDER BY source, holder_heartbeat_at DESC NULLS LAST
  `).map(e=>({source:e.source,workspaceId:e.workspace_id,agentId:e.agent_id??null,agentLabel:e.agent_label??null,agentName:e.agent_name??null,harnessSlug:e.harness_slug??null,planSlug:e.plan_slug??null,itemId:e.item_id??null,workItemId:e.work_item_id??null,itemKind:e.item_kind??null,detail:e.detail??``,status:e.status??null,claimAcquiredTs:I(e.claim_acquired_ts),claimExpiresTs:I(e.claim_expires_ts),claimActive:e.claim_active??null,livenessMode:e.liveness_mode??null,lastActivityTs:I(e.last_activity_ts),holderPresent:!!e.holder_present,holderAlive:!!e.holder_alive,holderHeartbeatAt:I(e.holder_heartbeat_at),holderIntent:e.holder_intent??null,holderPlanSlug:e.holder_plan_slug??null,orphaned:!!e.orphaned,stalled:e.stalled??null,lastProgressAt:I(e.last_progress_at),declaredPlanMatches:e.declared_plan_matches??null,assigneeRank:e.assignee_rank==null?null:Number(e.assignee_rank),rankWriter:e.rank_writer??null,fleetSlug:e.fleet_slug??null,fleetRole:e.fleet_role??null})),a=[...new Set(i.filter(e=>e.agentId).map(e=>e.agentId))];if(a.length===0)return i;let[s,c]=await Promise.all([T(a),E(a)]);return A(j(i,new Set([...c].filter(e=>!s.has(e)))),s)}function N(e){return{type:e.source===`plan_item_claim`?`plan-item`:e.source===`plan_item_assignment`?`assignment`:`work-item`,harnessSlug:e.harnessSlug,planSlug:e.planSlug,id:e.itemId??e.workItemId,itemKind:e.itemKind,detail:e.detail,status:e.status,acquiredTs:e.claimAcquiredTs,expiresTs:e.claimExpiresTs,active:e.claimActive!==!1,orphaned:e.orphaned,stalled:e.stalled,lastProgressAt:e.lastProgressAt,activity:k(e),rank:e.assigneeRank,rankWriter:e.rankWriter}}function P(e){let t=new Map,n=new Map,r=e=>{let n=t.get(e);return n||(n={agentId:e,label:null,name:null,present:!1,alive:!1,heartbeatAt:null,intent:``,declaredPlanSlug:null,fleetSlug:null,fleetRole:null,claims:[],orphaned:!1,stalled:!1,declaredUnclaimed:!1,doing:null,queued:[],load:0},t.set(e,n)),n},i=new Map;for(let t of e){if(!t.agentId||t.source===`plan_item_assignment`)continue;let e=r(t.agentId);if(e.label=e.label??t.agentLabel,t.source===`presence`)e.present=!0,e.alive=t.holderAlive,e.heartbeatAt=t.holderHeartbeatAt,e.intent=t.detail,e.declaredPlanSlug=t.planSlug,e.fleetSlug=t.fleetSlug??null,e.fleetRole=t.fleetRole??null;else{if(e.claims.push(N(t)),t.source===`work_item_claim`&&t.workItemId){let e=n.get(t.agentId)??[];e.push({id:t.workItemId,itemKind:t.itemKind,title:t.detail,status:t.status,rank:t.assigneeRank,rankWriter:t.rankWriter,activity:k(t)}),n.set(t.agentId,e)}t.orphaned&&(e.orphaned=!0),t.stalled&&(e.stalled=!0),t.holderPresent&&(e.present=!0,e.alive=e.alive||t.holderAlive,e.heartbeatAt=e.heartbeatAt??t.holderHeartbeatAt,e.intent=e.intent||(t.holderIntent??``),e.declaredPlanSlug=e.declaredPlanSlug??t.holderPlanSlug,e.fleetSlug=e.fleetSlug??t.fleetSlug??null,e.fleetRole=e.fleetRole??t.fleetRole??null),t.agentName&&(e.name=e.name??t.agentName,i.set(t.agentName,t.agentId))}}for(let t of e){if(t.source!==`plan_item_assignment`||!t.agentId)continue;let e=r(i.get(t.agentId)??t.agentId);e.name=e.name??t.agentId,e.claims.push(N(t))}for(let e of t.values()){e.declaredUnclaimed=!!(e.declaredPlanSlug&&!e.claims.some(t=>t.planSlug===e.declaredPlanSlug));let t=n.get(e.agentId)??[];t.sort((e,t)=>{let n=e.rank??1/0,r=t.rank??1/0;return n===r?e.id<t.id?-1:+(e.id>t.id):n-r}),e.queued=t,e.doing=t[0]??null,e.load=t.length}return[...t.values()].sort((e,t)=>{if(e.alive!==t.alive)return e.alive?-1:1;let n=e.orphaned||e.stalled;return n===(t.orphaned||t.stalled)?(t.heartbeatAt??``).localeCompare(e.heartbeatAt??``):n?-1:1})}var F,I,L=e((()=>{i(),a(),O(),F=`*`,I=e=>e==null?null:e instanceof Date?e.toISOString():String(e)}));export{f as _,M as a,S as c,w as d,x as f,d as g,l as h,L as i,O as l,_ as m,A as n,j as o,u as p,P as r,C as s,k as t,D as u};