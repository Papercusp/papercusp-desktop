const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/session-archive-hook-sd6FL0IC.js","assets/session-archive-hook-VPCV_COE.js","assets/chunk-ChpBd9eV.js","assets/server-CB1HiStO.js","assets/types-B6UfiA7g.js","assets/src-6Py4l2MU.js","assets/src-CL56NiZm.js","assets/src-BmBNODK0.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/session-launch-dirs-Bt0E5Mbt.js","assets/session-ingest-C0TA9HpD.js","assets/match-CYTPxrpt.js","assets/event-loop-lag-monitor-bF1lAueB.js","assets/src-CynoHxv9.js","assets/sensitive-text-DOcS0s4f.js","assets/machine-surface-catalogue-AtBx-9cm.js","assets/turn-ref-MFkZYzLS.js","assets/self-session-BZ_KjsWu.js","assets/preload-helper-CcgcQsTF.js","assets/turn-provenance-_sDze2pp.js","assets/envelope-grammar-CO_scURv.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-als-CSW21ZcE.js","assets/workspace-id-constant-AQ2MH5pQ.js","assets/omp-sessions-DKilJw80.js","assets/harness-registry-Cyujgx97.js","assets/operator-state-pg-DNPN5cby.js","assets/db-encryption-ByK3NqqK.js","assets/platform-pot-slug-C6n7Eole.js","assets/session-archive-DC0apJN-.js"])))=>i.map(i=>d[i]);
import{n as E}from"./chunk-ChpBd9eV.js";import{n as A,t as m}from"./preload-helper-CcgcQsTF.js";import{st as d,t as I}from"./src-BmBNODK0.js";import{c as T,r as _}from"./workspace-registry-Du2UbhlH.js";import{n as f,r as O}from"./pg-bounded-txn-XpvwFDFc.js";function F(e){return typeof e=="object"&&e!==null&&e.refused===!0&&typeof e.question=="string"}function H(e){return{refused:!0,question:e.question,because:e.because,insteadRead:e.insteadRead}}function w(e){return{field:e.field,reliability:e.reliability,cannotAnswer:e.cannotAnswer,insteadRead:e.insteadRead,...e.because?{because:e.because}:{}}}function g(e){return`\`${e.field}\` is ${e.reliability.toUpperCase()}, not observed — it cannot answer: ${e.cannotAnswer} Read instead: ${e.insteadRead}.${e.because?` (${e.because})`:""}`}function q(e){return`REFUSED — ${e.question} ${e.because} Read instead: ${e.insteadRead}.`}function P(e,n){if(n.length===0)return e;const s=n.length===1?"⚠ 1 field in this result is DERIVED/INFERRED, not observed — do not reason from it:":`⚠ ${n.length} fields in this result are DERIVED/INFERRED, not observed — do not reason from them:`;return{...e,_fieldReliability:n,_fieldReliabilityWarning:`${s}
  • ${n.map(g).join(`
  • `)}`}}var v=E((()=>{}));function i(e,n){e?.code!=="42P01"&&console.warn(`[adv-sessions] ${n} failed:`,e.message)}function l(e){if(e==null)return null;if(e instanceof Date)return e.toISOString();const n=new Date(e);if(!Number.isNaN(n.getTime()))return n.toISOString();throw new Error(`invalid timestamp: ${String(e)}`)}function o(e){return{id:e.id,workspaceId:e.workspace_id,harnessSlug:e.harness_slug??null,planSlug:e.plan_slug,agent:e.agent??null,role:e.role??null,feature:e.feature??null,mode:e.mode,terminalBin:e.terminal_bin,pid:e.pid,windowId:e.window_id,ompThreadId:e.omp_thread_id,cwd:e.cwd,coordOwnerId:e.coord_owner_id??null,sessionId:e.session_id??null,display:e.display??null,launchArgv:e.launch_argv??null,launchedAt:l(e.launched_at??null),label:e.label,startedAt:l(e.started_at),...e.last_active_at===void 0?{}:{lastActiveAt:l(e.last_active_at)},endedAt:l(e.ended_at),exitCode:e.exit_code,endedBy:e.ended_by??null,endedSignal:e.ended_signal??null,portId:e.port_id??null,portSourceAdvSessionId:e.port_source_adv_session_id==null?null:Number(e.port_source_adv_session_id),portStatus:e.port_status??null,portMetadata:e.port_metadata??null}}async function Y(e){const n=c.get(e);if(n&&Date.now()-n.at<p)return n.ws;let s=null;try{const{sql:a}=d();s=(await a`
      SELECT workspace_id FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ${e}
       ORDER BY started_at DESC
       LIMIT 1
    `)[0]?.workspace_id??null}catch(a){return i(a,"workspaceForCoordOwner"),null}return c.size>512&&c.clear(),c.set(e,{ws:s,at:Date.now()}),s}async function j(e){try{const{sql:n}=d();return(e.portId?await n`
          INSERT INTO harness_shared.adv_sessions
            (workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid, label, omp_thread_id, cwd, coord_owner_id, session_id, display, launch_argv,
             port_id, port_source_adv_session_id, port_status, port_metadata)
          VALUES
            (${e.workspaceId??_()}, ${e.planSlug??null}, ${e.agent??null},
             ${e.role??null}, ${e.feature??null}, ${e.mode},
             ${e.terminalBin??null}, ${e.pid??null}, ${e.label??null},
             ${e.ompThreadId??null}, ${e.cwd??null}, ${e.coordOwnerId??null}, ${e.sessionId??null},
             ${e.display??null}, ${e.launchArgv?JSON.stringify(e.launchArgv):null}::text::jsonb,
             ${e.portId}, ${e.portSourceAdvSessionId??null}, ${e.portStatus??null},
             ${e.portMetadata?JSON.stringify(e.portMetadata):null}::text::jsonb)
          RETURNING id`:await n`
          INSERT INTO harness_shared.adv_sessions
            (workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid, label, omp_thread_id, cwd, coord_owner_id, session_id, display, launch_argv)
          VALUES
            (${e.workspaceId??_()}, ${e.planSlug??null}, ${e.agent??null},
             ${e.role??null}, ${e.feature??null}, ${e.mode},
             ${e.terminalBin??null}, ${e.pid??null}, ${e.label??null},
             ${e.ompThreadId??null}, ${e.cwd??null}, ${e.coordOwnerId??null}, ${e.sessionId??null},
             ${e.display??null}, ${e.launchArgv?JSON.stringify(e.launchArgv):null}::text::jsonb)
          RETURNING id`)[0]?.id??null}catch(n){return i(n,"recordAdvSession"),null}}async function G(e={}){const n=e.limit??50,s=e.workspaceId??null;try{const{sql:a}=d();return(await a`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id,
             display, launch_argv, launched_at, started_at, ended_at, exit_code, ended_by, ended_signal
        FROM harness_shared.adv_sessions
       WHERE display = 'workbench'
         AND launched_at IS NULL
         AND ended_at IS NULL
         AND (${s}::text IS NULL OR workspace_id = ${s})
       ORDER BY started_at DESC
       LIMIT ${n}
    `).map(o)}catch(a){return i(a,"listPendingWorkbenchLaunches"),[]}}function h(e){try{return process.kill(e,0),!0}catch(n){return n?.code==="EPERM"}}function y(e,n=h){return e.display!=="terminal"||e.endedAt!=null||e.sessionId!=null||e.pid==null?!1:!n(e.pid)}function J(e){return e.display==="terminal"&&e.endedAt!=null&&e.sessionId==null}async function D(e,n=h){const s=e.filter(t=>y(t,n));if(s.length===0)return e;const a=new Date().toISOString();for(const t of s)t.endedAt=a,t.endedBy="reconciler";try{const{sql:t}=d();await t`
      UPDATE harness_shared.adv_sessions
         SET ended_at = now(), ended_by = 'reconciler'
       WHERE id = ANY(${s.map(r=>r.id)}::bigint[])
         AND ended_at IS NULL
         AND session_id IS NULL
    `}catch(t){i(t,"reconcileDeadTerminalLaunches")}return e}async function V(e={}){const n=e.limit??50,s=e.withinSec??900,a=e.workspaceId??null;try{const{sql:t}=d();return await D((await t`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id,
             display, launch_argv, launched_at, started_at, ended_at, exit_code, ended_by, ended_signal
        FROM harness_shared.adv_sessions
       WHERE display = ${u}
         AND (ended_at IS NULL OR session_id IS NULL)
         AND started_at > now() - (${s}::int * interval '1 second')
         AND (${a}::text IS NULL OR workspace_id = ${a})
       ORDER BY started_at DESC
       LIMIT ${n}
    `).map(o),e.pidAlive)}catch(t){return i(t,"listStartingTerminalLaunches"),[]}}async function K(e){try{const{sql:n}=d();return(await n`
      UPDATE harness_shared.adv_sessions
         SET launched_at = now()
       WHERE id = ${e}
         AND launched_at IS NULL
       RETURNING id
    `).length>0}catch(n){return i(n,"markAdvSessionLaunched"),!1}}async function z(e){try{const{sql:n}=d();return(await n`
      UPDATE harness_shared.adv_sessions
         SET session_id = ${e.sessionId},
             plan_slug  = COALESCE(${e.planSlug??null}, plan_slug),
             label      = COALESCE(${e.label??null}, label),
             cwd        = COALESCE(${e.cwd??null}, cwd),
             mode       = COALESCE(${e.mode??null}, mode),
             launch_argv = COALESCE(
               ${e.launchArgv?JSON.stringify(e.launchArgv):null}::text::jsonb,
               launch_argv
             )
       WHERE id = ${e.id}
         AND display = ${u}
         AND session_id IS NULL
         AND ended_at IS NULL
       RETURNING id
    `).length>0}catch(n){return i(n,"adoptStartingTerminalLaunch"),!1}}async function X(e,n,s){try{const{sql:a}=d();await a`
      UPDATE harness_shared.adv_sessions
         SET pid = ${n},
             terminal_bin = COALESCE(${s??null}, terminal_bin)
       WHERE id = ${e}
         AND workspace_id = ${_()}
    `}catch(a){i(a,"setAdvSessionPid")}}async function Z(e,n){const s=n?.trim()||null;if(s)try{const{sql:a}=d();await a`
      UPDATE harness_shared.adv_sessions
         SET window_id = ${s}
       WHERE id = ${e}
         AND workspace_id = ${_()}
    `}catch(a){i(a,"setAdvSessionWindowId")}}async function Q(e,n){const s=n.trim();if(!s)return"not_found";try{const{sql:a}=d(),t=(await a`
      SELECT omp_thread_id
        FROM harness_shared.adv_sessions
       WHERE id = ${e}
         AND workspace_id = ${_()}
       LIMIT 1
    `)[0];return t?t.omp_thread_id===s?"already_linked":t.omp_thread_id!=null&&t.omp_thread_id!==s?"conflict":(await a`
      UPDATE harness_shared.adv_sessions
         SET omp_thread_id = ${s}
       WHERE id = ${e}
         AND workspace_id = ${_()}
    `,"linked"):"not_found"}catch(a){return i(a,"setAdvSessionOmpThreadId"),"not_found"}}function $(e){return e.endedAt==null?!1:!S.has(e.endedBy)}function ee(e){return e.endedBy==="signal"}function ne(e){return typeof e!="string"?null:/^SIG[A-Z0-9]{1,15}$/.test(e)?e:null}function se(e,n="exitCode"){return e.endedBy!=="signal"?null:w({field:n,reliability:"inferred",cannotAnswer:"did this session exit cleanly?",insteadRead:"ended_signal — the signal that killed it; this exit code is a placeholder",because:"node-pty reports a signal death as exitCode 0 with the signal in a separate field, so a killed session records the same 0 a clean exit does. Measured 2026-08-12 (WI-38054): two owner-launched agents killed by a sidecar restart both recorded exit 0."})}function ae(e,n="endedAt"){return $(e)?w({field:n,reliability:"inferred",cannotAnswer:"when did this session actually end?",insteadRead:"coord_presence.last_active_at for this session's owner — the last turn it actually took",because:`written by ${e.endedBy==null?"a row predating migration 735, so its writer is unknown":`the ${e.endedBy}, which stamps now() on NOTICING a process that had already gone`}. Measured 2026-08-02 (WI-7126): one sweep stamped 9 rows within 13ms, one of them gone since 20 July — an artificial cluster that read as a simultaneous mass kill.`}):null}function te(e){if(e.endedAt==null)return"end time unknown";if(e.endedBy==="self")return`ended ${e.endedAt}`;if(e.endedBy==="signal")return`KILLED${e.endedSignal?` by ${e.endedSignal}`:""} at ${e.endedAt} — an observed end time, but NOT a voluntary exit`;const n=e.endedBy??"an unrecorded writer";return`last recorded ${e.endedAt} — that is when ${n} NOTICED it was gone, not when it ended`}async function de(e,n,s,a={}){try{const{sql:t}=d();(await t`
      UPDATE harness_shared.adv_sessions
         SET ended_at = now(), exit_code = ${n}, ended_by = ${s},
             ended_signal = ${s==="signal"?a.signal??null:null}
       WHERE id = ${e} AND ended_at IS NULL
       RETURNING id
    `).length&&m(()=>import("./session-archive-hook-sd6FL0IC.js").then(r=>r.scheduleArchiveForAdvSession(e)),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35])).catch(r=>console.warn(`[adv-sessions] archive hook unavailable: ${r?.message??r}`))}catch(t){i(t,"markAdvSessionEnded")}}async function ie(e){try{const{sql:n}=d();return(await n`
      UPDATE harness_shared.adv_sessions
         SET ended_at = NULL, exit_code = NULL, started_at = now()
       WHERE id = ${e} AND ended_at IS NOT NULL
      RETURNING id
    `).length>0}catch(n){return i(n,"reactivateAdvSession"),!1}}async function re(e){if(!e)return!1;try{const{sql:n}=d();return(await n`
      UPDATE harness_shared.adv_sessions
         SET ended_at = NULL, exit_code = NULL, started_at = now()
       WHERE id = (
         SELECT id FROM harness_shared.adv_sessions
          WHERE coord_owner_id = ${e} AND ended_at IS NOT NULL
          ORDER BY started_at DESC
          LIMIT 1
       )
      RETURNING id
    `).length>0}catch(n){return i(n,"reactivateAdvSessionByOwner"),!1}}async function oe(e,n){if(!n)return{reanchored:!1,owner:null};try{const{sql:s}=d(),a=await s`
      UPDATE harness_shared.adv_sessions
         SET session_id = ${n}, ended_at = NULL, exit_code = NULL, started_at = now()
       WHERE id = ${e} AND session_id IS DISTINCT FROM ${n}
      RETURNING id, coord_owner_id AS owner
    `;return{reanchored:a.length>0,owner:a[0]?.owner??null}}catch(s){return i(s,"reanchorAdvSessionNativeId"),{reanchored:!1,owner:null}}}async function _e(e,n){if(!e||!n)return{reanchored:!1,owner:null};try{const{sql:s}=d(),a=await s`
      UPDATE harness_shared.adv_sessions
         SET session_id = ${n}, ended_at = NULL, exit_code = NULL, started_at = now()
       WHERE id = (
         SELECT id FROM harness_shared.adv_sessions
          WHERE coord_owner_id = ${e}
          ORDER BY started_at DESC
          LIMIT 1
       ) AND session_id IS DISTINCT FROM ${n}
      RETURNING id
    `;return{reanchored:a.length>0,owner:a.length>0?e:null}}catch(s){return i(s,"reanchorAdvSessionNativeIdByOwner"),{reanchored:!1,owner:null}}}async function le(e,n,s){if(!s||(e==null||e<=0)&&!n)return!1;try{const{sql:a}=d(),t=JSON.stringify(s);return(e!=null&&e>0?await a`
            UPDATE harness_shared.adv_sessions
               SET launch_spec = ${t}::jsonb
             WHERE id = ${e}
            RETURNING id
          `:await a`
            UPDATE harness_shared.adv_sessions
               SET launch_spec = ${t}::jsonb
             WHERE id = (
               SELECT id FROM harness_shared.adv_sessions
                WHERE coord_owner_id = ${n}
                ORDER BY started_at DESC
                LIMIT 1
             )
            RETURNING id
          `).length>0}catch(a){return i(a,"recordSuLaunchSpec"),!1}}async function ce(e){if(!e)return null;try{const{sql:n}=d();return(await n`
      SELECT launch_spec
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ${e}
       ORDER BY started_at DESC
       LIMIT 1
    `)[0]?.launch_spec??null}catch(n){return i(n,"readSuLaunchSpecByOwner"),null}}async function ue(e=100){try{const{sql:n}=d();return(await n`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code, ended_by, ended_signal,
             to_jsonb(a)->>'port_id' AS port_id,
             to_jsonb(a)->>'port_source_adv_session_id' AS port_source_adv_session_id,
             to_jsonb(a)->>'port_status' AS port_status,
             to_jsonb(a)->'port_metadata' AS port_metadata
        FROM harness_shared.adv_sessions a
       WHERE workspace_id = ${_()}
         AND NOT (
           ended_at IS NOT NULL
           AND omp_thread_id IS NULL
           AND EXTRACT(EPOCH FROM (ended_at - started_at)) < 5
         )
       ORDER BY started_at DESC
       LIMIT ${e}
    `).map(o)}catch(n){return i(n,"listAdvSessions"),[]}}async function Ee(e=30,{perAgentFloor:n=L,scanLimit:s=N}={}){try{const{sql:a}=d();return(await a`
      WITH pool AS (
        -- Never-ended rows in full: small, bounded, and the set a started_at-ordered scan
        -- gets most wrong (a session busy for 10h has the OLDEST started_at of any live one).
          SELECT a.id
            FROM harness_shared.adv_sessions a
           WHERE a.agent IS NOT NULL
             AND a.cwd IS NOT NULL
             -- to_jsonb(row)->key is parse-safe before migration 611: a missing
             -- key is NULL, while pending post-migration ports remain hidden.
             AND COALESCE(to_jsonb(a)->>'port_status', 'delivered') = 'delivered'
             AND a.ended_at IS NULL
        UNION
          -- …plus the most recent ended rows. GREATEST(started_at, ended_at) because a row
          -- that ended AFTER its last reactivation is most recent at its end, not its start.
          SELECT id FROM (
            SELECT a.id
              FROM harness_shared.adv_sessions a
             WHERE a.agent IS NOT NULL
               AND a.cwd IS NOT NULL
               AND COALESCE(to_jsonb(a)->>'port_status', 'delivered') = 'delivered'
             ORDER BY GREATEST(a.started_at, COALESCE(a.ended_at, a.started_at)) DESC
             LIMIT ${s}
          ) recent
      ),
      scored AS (
        SELECT a.id, a.workspace_id,
               -- launch_spec was added after the resumable-session surface. Reading
               -- through to_jsonb keeps this query parse-safe on a pre-migration
               -- operator; absent launch_spec then correctly means no harness scope.
               to_jsonb(a)->'launch_spec'->>'harnessSlug' AS harness_slug,
               a.plan_slug, a.agent, a.role, a.feature, a.mode, a.terminal_bin, a.pid,
               a.window_id, a.omp_thread_id, a.label, a.cwd, a.coord_owner_id, a.session_id,
               a.started_at, a.ended_at, a.exit_code, a.ended_by, a.ended_signal,
               -- GREATEST, not COALESCE: each source is a LOWER BOUND on activity that can be
               -- missing or stale independently, so the newest evidence wins and a session with
               -- no evidence at all degrades to started_at instead of dropping to NULL.
               GREATEST(
                 a.started_at,
                 COALESCE(pr.last_active_at, a.started_at),
                 COALESCE(ti.last_tool, a.started_at)
               ) AS last_active_at
          FROM harness_shared.adv_sessions a
          JOIN pool ON pool.id = a.id
          LEFT JOIN harness_shared.coord_presence pr ON pr.owner_id = a.coord_owner_id
          -- Indexed by tool_invocations_coord_owner_idx (coord_owner_id, invoked_at DESC),
          -- so this is a per-candidate index max, not a scan of the 680k-row 3-day window.
          LEFT JOIN LATERAL (
            SELECT max(t.invoked_at) AS last_tool
              FROM harness_shared.tool_invocations t
             WHERE t.coord_owner_id = a.coord_owner_id
          ) ti ON true
      ),
      ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (ORDER BY last_active_at DESC) AS global_rn,
               ROW_NUMBER() OVER (PARTITION BY agent ORDER BY last_active_at DESC) AS agent_rn
          FROM scored
      )
      SELECT id, workspace_id, harness_slug,
             plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id,
             started_at, last_active_at, ended_at, exit_code, ended_by, ended_signal
        FROM ranked
       WHERE global_rn <= ${e} OR agent_rn <= ${n}
       ORDER BY last_active_at DESC
    `).map(o)}catch(a){return i(a,"listResumableSessions"),[]}}async function we(e){try{const n=(await f(s=>s`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code, ended_by, ended_signal,
             to_jsonb(a)->>'port_id' AS port_id,
             to_jsonb(a)->>'port_source_adv_session_id' AS port_source_adv_session_id,
             to_jsonb(a)->>'port_status' AS port_status,
             to_jsonb(a)->'port_metadata' AS port_metadata
        FROM harness_shared.adv_sessions a
       WHERE workspace_id = ${_()}
         AND id = ${e}
       LIMIT 1
    `))[0];return n?o(n):null}catch(n){return i(n,"getAdvSession"),null}}async function he(e,n){try{const{sql:s}=d(),a=await s`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id,
             started_at, ended_at, exit_code, ended_by, ended_signal,
             to_jsonb(a)->>'port_id' AS port_id,
             to_jsonb(a)->>'port_source_adv_session_id' AS port_source_adv_session_id,
             to_jsonb(a)->>'port_status' AS port_status,
             to_jsonb(a)->'port_metadata' AS port_metadata
        FROM harness_shared.adv_sessions a
       WHERE workspace_id = ${n} AND id = ${e}
       LIMIT 1`;return a[0]?o(a[0]):null}catch(s){return i(s,"getAdvSessionInWorkspace"),null}}async function Se(e,n,s,a={}){const{sql:t}=d();return(await t`
    UPDATE harness_shared.adv_sessions
       SET port_status = ${s},
           port_metadata = COALESCE(port_metadata, '{}'::jsonb) || ${JSON.stringify(a)}::text::jsonb,
           ended_at = CASE WHEN ${s} = 'failed' THEN COALESCE(ended_at, now()) ELSE ended_at END
     WHERE id = ${e} AND workspace_id = ${n}
     RETURNING id`).length>0}async function pe(e=500){const n=new Map;try{const{sql:s}=d(),a=await s`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, launch_argv,
             started_at, ended_at, exit_code, ended_by, ended_signal
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id IS NOT NULL
       ORDER BY started_at DESC
       LIMIT ${e}
    `;for(const t of a){const r=o(t);r.coordOwnerId&&!n.has(r.coordOwnerId)&&n.set(r.coordOwnerId,r)}}catch(s){i(s,"advSessionsByCoordOwner")}return n}async function Le(e={}){const n=e.workspaceId??null,s=Math.max(1,Math.round((e.maxAgeMs??432e5)/1e3)),a=e.limit??500;try{const{sql:t}=d();return(await t`
      SELECT DISTINCT ON (coord_owner_id)
             id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code, ended_by, ended_signal
        FROM harness_shared.adv_sessions
       WHERE ended_at IS NULL
         AND coord_owner_id IS NOT NULL
         AND started_at > now() - make_interval(secs => ${s})
         AND (${n}::text IS NULL OR workspace_id = ${n})
       ORDER BY coord_owner_id, started_at DESC
       LIMIT ${a}
    `).map(o)}catch(t){return i(t,"listRecordedLiveSessions"),[]}}async function Ne(e){const n=[...new Set(e.filter(s=>!!s&&!s.startsWith("fed:")))];if(n.length===0)return new Set;try{const{sql:s}=d(),a=await s`
      SELECT DISTINCT ON (coord_owner_id) coord_owner_id, ended_at
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ANY(${n}::text[])
       ORDER BY coord_owner_id, started_at DESC
    `;return new Set(a.filter(t=>t.ended_at!=null).map(t=>t.coord_owner_id))}catch(s){return i(s,"endedRecordedOwnerIds"),new Set}}async function Re(e){const n=[...new Set(e.filter(s=>!!s&&!s.startsWith("fed:")))];if(n.length===0)return new Set;try{const{sql:s}=d(),a=await s`
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
    `;return new Set(a.map(t=>t.owner_id))}catch(s){return i(s,"recordedLiveOwnerIds"),new Set}}async function Ae(e){try{const{sql:n}=d(),s=(await n`
      SELECT MIN(first_seen_at) AS started_at
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ${e}
    `)[0]?.started_at??null;if(s==null)return null;const a=s instanceof Date?s:new Date(s);return Number.isNaN(a.getTime())?null:a.toISOString()}catch(n){return i(n,"firstAdvSessionStartByCoordOwner"),null}}async function me(e){try{const{sql:n}=d(),s=(await n`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code, ended_by, ended_signal
        FROM harness_shared.adv_sessions
       WHERE coord_owner_id = ${e}
       ORDER BY started_at DESC
       LIMIT 1
    `)[0];return s?o(s):null}catch(n){return i(n,"latestAdvSessionByCoordOwner"),null}}async function Ie(e,n){try{const{sql:s}=d(),a=(await s`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code, ended_by, ended_signal
        FROM harness_shared.adv_sessions
       WHERE label = ${e}
         AND workspace_id = ${n}
         AND ended_at IS NULL
         AND coord_owner_id IS NOT NULL
         AND started_at >= ${new Date(Date.now()-R).toISOString()}
       ORDER BY started_at DESC
       LIMIT 1
    `)[0];return a?o(a):null}catch(s){return i(s,"latestLiveAdvSessionByLabel"),null}}async function Te(e={}){const n=e.limit??50,s=e.workspaceId??null,a=e.before??null;try{const{sql:t}=d();return(await t`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code, ended_by, ended_signal
        FROM harness_shared.adv_sessions
       WHERE ended_at IS NOT NULL
         -- Match the transcript handles understood by endedSessionStreamUrl:
         -- Claude/native UUID, OMP thread id, or Codex's per-row CODEX_HOME.
         -- In particular, this excludes handleless console-launch wrappers.
         AND (
           NULLIF(BTRIM(session_id), '') IS NOT NULL
           OR NULLIF(BTRIM(omp_thread_id), '') IS NOT NULL
           OR agent = 'codex'
         )
         AND (${s}::text IS NULL OR workspace_id = ${s})
         AND (${a}::timestamptz IS NULL OR ended_at < ${a}::timestamptz)
       ORDER BY ended_at DESC
       LIMIT ${n}
    `).map(o)}catch(t){return i(t,"listEndedAdvSessions"),[]}}async function fe(e,n={}){const s=n.workspaceId??null,a=Math.min(500,Math.max(1,n.limit??200));if(!e)return[];try{const{sql:t}=d();return(await t`
      WITH claim_owners AS (
        SELECT DISTINCT owner FROM (
          SELECT terminal_owner AS owner
            FROM harness_shared.work_items
           WHERE source_plan_slug = ${e} AND terminal_owner IS NOT NULL
          UNION
          SELECT taken_by AS owner
            FROM harness_shared.work_items
           WHERE source_plan_slug = ${e} AND taken_by IS NOT NULL
        ) o
      ),
      candidate AS (
        SELECT s.coord_owner_id, s.session_id, s.omp_thread_id, s.agent, s.mode,
               s.role, s.label, s.started_at, s.ended_at, 'plan'::text AS via
          FROM harness_shared.adv_sessions s
         WHERE s.plan_slug = ${e}
           AND s.coord_owner_id IS NOT NULL
           AND (${s}::text IS NULL OR s.workspace_id = ${s})
        UNION ALL
        SELECT s.coord_owner_id, s.session_id, s.omp_thread_id, s.agent, s.mode,
               s.role, s.label, s.started_at, s.ended_at, 'claim'::text AS via
          FROM harness_shared.adv_sessions s
          JOIN claim_owners c ON c.owner = s.coord_owner_id
         WHERE s.plan_slug IS NULL
           AND s.coord_owner_id IS NOT NULL
           AND (${s}::text IS NULL OR s.workspace_id = ${s})
      ),
      deduped AS (
        SELECT DISTINCT ON (coord_owner_id)
               coord_owner_id, session_id, omp_thread_id, agent, mode, role,
               label, started_at, ended_at, via
          FROM candidate
         ORDER BY coord_owner_id, (via = 'plan') DESC, started_at DESC
      )
      SELECT * FROM deduped
       ORDER BY (ended_at IS NULL) DESC, started_at DESC
       LIMIT ${a}
    `).map(r=>({coordOwnerId:r.coord_owner_id,sessionId:r.session_id,ompThreadId:r.omp_thread_id,agent:r.agent,mode:r.mode,role:r.role,label:r.label,startedAt:l(r.started_at)??new Date(0).toISOString(),endedAt:l(r.ended_at),live:r.ended_at==null,via:r.via}))}catch(t){return i(t,"listPlanSessions"),[]}}async function Oe(e){const n=e.sessionIds&&e.sessionIds.length?[...e.sessionIds]:null,s=e.ompThreadIds&&e.ompThreadIds.length?[...e.ompThreadIds]:null;if(!n&&!s)return[];try{const{sql:a}=d();return(await a`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code, ended_by, ended_signal
        FROM harness_shared.adv_sessions
       WHERE (${n}::text[] IS NOT NULL AND session_id = ANY(${n}::text[]))
          OR (${s}::text[] IS NOT NULL AND omp_thread_id = ANY(${s}::text[]))
       ORDER BY started_at DESC
       LIMIT 500
    `).map(o)}catch(a){return i(a,"advSessionsByTranscriptHandles"),[]}}async function ge(e,n={}){const s=e.trim().toLowerCase();if(!s)return[];const a=Math.min(200,Math.max(1,n.limit??50)),t=`${s.replace(/[\\%_]/g,r=>`\\${r}`)}%`;try{const{sql:r}=d();return(await r`
      SELECT id, workspace_id, plan_slug, agent, role, feature, mode, terminal_bin, pid,
             window_id, omp_thread_id, label, cwd, coord_owner_id, session_id, started_at, ended_at, exit_code, ended_by, ended_signal
        FROM harness_shared.adv_sessions
       WHERE lower(coord_owner_id) LIKE ${t}
          OR lower(session_id)     LIKE ${t}
          OR lower(omp_thread_id)  LIKE ${t}
       ORDER BY started_at DESC
       LIMIT ${a}
    `).map(o)}catch(r){return i(r,"advSessionsByIdToken"),[]}}var b,S,c,p,u,C,L,N,R,ve=E((()=>{I(),O(),T(),v(),A(),b=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,S=new Set(["self","signal"]),c=new Map,p=3e4,u="terminal",C=900,L=12,N=300,R=720*60*1e3}));export{P as $,o as A,le as B,ue as C,Le as D,fe as E,re as F,l as G,Q as H,ce as I,w as J,Se as K,oe as L,K as M,ne as N,Ee as O,ie as P,H as Q,_e as R,Ie as S,G as T,X as U,Re as V,Z as W,v as X,q as Y,F as Z,y as _,z as a,$ as b,pe as c,te as d,Ne as f,ve as g,he as h,C as i,de as j,V as k,ge as l,we as m,b as n,ae as o,Ae as p,Y as q,R as r,se as s,u as t,Oe as u,J as v,Te as w,me as x,ee as y,j as z};
