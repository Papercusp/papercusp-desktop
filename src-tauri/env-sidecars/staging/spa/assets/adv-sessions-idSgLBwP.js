import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{q as r,t as i}from"./src-DTtGQmae.js";import{n as a,s as o}from"./workspace-registry-C3lTKlnO.js";function s(){if(f!=null)return f;if(process.platform===`win32`)f=!0;else if(process.platform!==`linux`)f=!1;else try{f=/microsoft/i.test((0,d.readFileSync)(`/proc/version`,`utf8`))}catch{f=!1}return f}function c(e=Date.now()){return!m||e-m.at>p?null:m.windows}async function l(e){if(!s())return[];let t=c();return t?e?t.filter(t=>t.title.startsWith(e)):t:[]}function u(e){if(!e.startsWith(`Papercup — `))return null;let t=e.slice(11).trim();return t.length>0?t:null}var d,f,p,m,h=e((()=>{d=t(n(),1),f=null,p=6e4,m=null}));function g(e,t){e?.code!==`42P01`&&console.warn(`[adv-sessions] ${t} failed:`,e.message)}function _(e){if(e==null)return null;if(e instanceof Date)return e.toISOString();let t=new Date(e);if(!Number.isNaN(t.getTime()))return t.toISOString();throw Error(`invalid timestamp: ${String(e)}`)}function v(e){return{id:e.id,workspaceId:e.workspace_id,planSlug:e.plan_slug,agent:e.agent??null,role:e.role??null,feature:e.feature??null,mode:e.mode,terminalBin:e.terminal_bin,pid:e.pid,windowId:e.window_id,ompThreadId:e.omp_thread_id,cwd:e.cwd,coordOwnerId:e.coord_owner_id??null,sessionId:e.session_id??null,display:e.display??null,launchArgv:e.launch_argv??null,launchedAt:_(e.launched_at??null),label:e.label,startedAt:_(e.started_at),endedAt:_(e.ended_at),exitCode:e.exit_code}}async function y(e,t){try{let{sql:n}=r();await n`
      UPDATE harness_shared.adv_sessions
         SET ended_at = now(), exit_code = ${t}
       WHERE id = ${e} AND ended_at IS NULL
    `}catch(e){g(e,`markAdvSessionEnded`)}}async function b(e){try{let{sql:t}=r(),n=(await t`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE workspace_id = ${a()}
         AND id = ${e}
       LIMIT 1
    `)[0];return n?v(n):null}catch(e){return g(e,`getAdvSession`),null}}async function x(e=500){let t=new Map;try{let{sql:n}=r(),i=await n`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id IS NOT NULL
       ORDER BY started_at DESC
       LIMIT ${e}
    `;for(let e of i){let n=v(e);n.coordOwnerId&&!t.has(n.coordOwnerId)&&t.set(n.coordOwnerId,n)}}catch(e){g(e,`advSessionsByCoordOwner`)}return t}async function S(e={}){let t=e.workspaceId??null,n=Math.max(1,Math.round((e.maxAgeMs??432e5)/1e3)),i=e.limit??500;try{let{sql:e}=r();return(await e`
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
    `).map(v)}catch(e){return g(e,`listRecordedLiveSessions`),[]}}async function C(e){let t=[...new Set(e.filter(e=>!!e&&!e.startsWith(`fed:`)))];if(t.length===0)return new Set;try{let{sql:e}=r(),n=await e`
      SELECT DISTINCT ON (coord_owner_id) coord_owner_id, ended_at
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ANY(${t}::text[])
       ORDER BY coord_owner_id, started_at DESC
    `;return new Set(n.filter(e=>e.ended_at!=null).map(e=>e.coord_owner_id))}catch(e){return g(e,`endedRecordedOwnerIds`),new Set}}async function w(e){let t=[...new Set(e.filter(e=>!!e&&!e.startsWith(`fed:`)))];if(t.length===0)return new Set;try{let{sql:e}=r(),n=await e`
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
    `;return new Set(n.map(e=>e.owner_id))}catch(e){return g(e,`recordedLiveOwnerIds`),new Set}}async function T(e){try{let{sql:t}=r(),n=(await t`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ${e}
       ORDER BY started_at DESC
       LIMIT 1
    `)[0];return n?v(n):null}catch(e){return g(e,`latestAdvSessionByCoordOwner`),null}}var E=e((()=>{i(),o(),h()}));export{T as a,w as c,s as d,l as f,E as i,c as l,C as n,S as o,u as p,b as r,y as s,x as t,h as u};