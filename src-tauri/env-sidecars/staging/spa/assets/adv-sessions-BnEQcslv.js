const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/session-archive-hook-BGBqvlE_.js","assets/chunk-CMxvf4Kt.js","assets/src-BIeYfY9a.js","assets/types-lEAL9ctp.js","assets/server-BdkZUoEn.js","assets/path-Blx-PRXi.js","assets/__vite-browser-external-CM3Eme-n.js","assets/src-C8OEUO3c.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-BTaEU3Bl.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js","assets/session-launch-dirs-B6qZOuj4.js","assets/harness-registry-4XlYUozf.js","assets/preload-helper-B_k_wMTD.js","assets/operator-state-pg-C00bS4C4.js","assets/db-encryption-Cexy6VC7.js","assets/workspace-registry-C3lTKlnO.js","assets/workspace-als-Cj-bQU9A.js","assets/workspace-id-constant-E7VkkAiJ.js","assets/session-ingest-CLvQBWWz.js"])))=>i.map(i=>d[i]);
import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{n,t as r}from"./preload-helper-B_k_wMTD.js";import{t as i}from"./__vite-browser-external-CM3Eme-n.js";import{q as a,t as o}from"./src-C8OEUO3c.js";import{n as s,s as c}from"./workspace-registry-C3lTKlnO.js";function l(){if(m!=null)return m;if(process.platform===`win32`)m=!0;else if(process.platform!==`linux`)m=!1;else try{m=/microsoft/i.test((0,p.readFileSync)(`/proc/version`,`utf8`))}catch{m=!1}return m}function u(e=Date.now()){return!g||e-g.at>h?null:g.windows}async function d(e){if(!l())return[];let t=u();return t?e?t.filter(t=>t.title.startsWith(e)):t:[]}function f(e){if(!e.startsWith(`Papercup — `))return null;let t=e.slice(11).trim();return t.length>0?t:null}var p,m,h,g,_=e((()=>{p=t(i(),1),m=null,h=6e4,g=null}));function v(e,t){e?.code!==`42P01`&&console.warn(`[adv-sessions] ${t} failed:`,e.message)}function y(e){if(e==null)return null;if(e instanceof Date)return e.toISOString();let t=new Date(e);if(!Number.isNaN(t.getTime()))return t.toISOString();throw Error(`invalid timestamp: ${String(e)}`)}function b(e){return{id:e.id,workspaceId:e.workspace_id,planSlug:e.plan_slug,agent:e.agent??null,role:e.role??null,feature:e.feature??null,mode:e.mode,terminalBin:e.terminal_bin,pid:e.pid,windowId:e.window_id,ompThreadId:e.omp_thread_id,cwd:e.cwd,coordOwnerId:e.coord_owner_id??null,sessionId:e.session_id??null,display:e.display??null,launchArgv:e.launch_argv??null,launchedAt:y(e.launched_at??null),label:e.label,startedAt:y(e.started_at),endedAt:y(e.ended_at),exitCode:e.exit_code}}async function x(e,t){try{let{sql:n}=a();(await n`
      UPDATE harness_shared.adv_sessions
         SET ended_at = now(), exit_code = ${t}
       WHERE id = ${e} AND ended_at IS NULL
       RETURNING id
    `).length&&r(()=>import(`./session-archive-hook-BGBqvlE_.js`).then(t=>t.scheduleArchiveForAdvSession(e)),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21])).catch(e=>console.warn(`[adv-sessions] archive hook unavailable: ${e?.message??e}`))}catch(e){v(e,`markAdvSessionEnded`)}}async function S(e){if(!e)return!1;try{let{sql:t}=a();return(await t`
      UPDATE harness_shared.adv_sessions
         SET ended_at = NULL, exit_code = NULL, started_at = now()
       WHERE id = (
         SELECT id FROM harness_shared.adv_sessions
          WHERE coord_owner_id = ${e} AND ended_at IS NOT NULL
          ORDER BY started_at DESC
          LIMIT 1
       )
      RETURNING id
    `).length>0}catch(e){return v(e,`reactivateAdvSessionByOwner`),!1}}async function C(e){try{let{sql:t}=a(),n=(await t`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE workspace_id = ${s()}
         AND id = ${e}
       LIMIT 1
    `)[0];return n?b(n):null}catch(e){return v(e,`getAdvSession`),null}}async function w(e=500){let t=new Map;try{let{sql:n}=a(),r=await n`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id IS NOT NULL
       ORDER BY started_at DESC
       LIMIT ${e}
    `;for(let e of r){let n=b(e);n.coordOwnerId&&!t.has(n.coordOwnerId)&&t.set(n.coordOwnerId,n)}}catch(e){v(e,`advSessionsByCoordOwner`)}return t}async function T(e={}){let t=e.workspaceId??null,n=Math.max(1,Math.round((e.maxAgeMs??432e5)/1e3)),r=e.limit??500;try{let{sql:e}=a();return(await e`
      SELECT DISTINCT ON (coord_owner_id)
             id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE ended_at IS NULL
         AND coord_owner_id IS NOT NULL
         AND started_at > now() - make_interval(secs => ${n})
         AND (${t}::text IS NULL OR workspace_id = ${t})
       ORDER BY coord_owner_id, started_at DESC
       LIMIT ${r}
    `).map(b)}catch(e){return v(e,`listRecordedLiveSessions`),[]}}async function E(e){let t=[...new Set(e.filter(e=>!!e&&!e.startsWith(`fed:`)))];if(t.length===0)return new Set;try{let{sql:e}=a(),n=await e`
      SELECT DISTINCT ON (coord_owner_id) coord_owner_id, ended_at
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ANY(${t}::text[])
       ORDER BY coord_owner_id, started_at DESC
    `;return new Set(n.filter(e=>e.ended_at!=null).map(e=>e.coord_owner_id))}catch(e){return v(e,`endedRecordedOwnerIds`),new Set}}async function D(e){let t=[...new Set(e.filter(e=>!!e&&!e.startsWith(`fed:`)))];if(t.length===0)return new Set;try{let{sql:e}=a(),n=await e`
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
    `;return new Set(n.map(e=>e.owner_id))}catch(e){return v(e,`recordedLiveOwnerIds`),new Set}}async function O(e){try{let{sql:t}=a(),n=(await t`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ${e}
       ORDER BY started_at DESC
       LIMIT 1
    `)[0];return n?b(n):null}catch(e){return v(e,`latestAdvSessionByCoordOwner`),null}}var k,A=e((()=>{o(),c(),_(),n(),k=720*60*1e3}));export{A as a,x as c,y as d,u as f,f as g,d as h,C as i,S as l,l as m,w as n,O as o,_ as p,E as r,T as s,k as t,D as u};