import{n as j,o as A}from"./chunk-ChpBd9eV.js";import{st as U,t as K}from"./src-BmBNODK0.js";import{t as N}from"./__vite-browser-external-56mrcCg8.js";import{r as G,t as q}from"./coordination-event-log-browser-s_EyGDm7.js";import{c as J,r as T}from"./workspace-registry-Du2UbhlH.js";import{Wt as h,Zt as Y}from"./messages-DA3ma2xE.js";import{n as X,t as V}from"./pg-transient-retry-CCouY6ki.js";import{r as z,t as Q}from"./host-benign-errors-zOsoCEiW.js";import{p as Z,y as ee}from"./service-health-Ke7v6Lwx.js";import{n as oe,r as te}from"./instance-Cwo6jVmY.js";import{a as re,d as ne,n as C}from"./placement-watchdog-MA--n6Xb.js";import{m as ae,n as se,p as ie,r as le,y as ce}from"./survey-1aolHILg.js";function ue(e){const o=Math.trunc(e??24);return Number.isFinite(o)?Math.min(Math.max(o,12),24):24}function _e(e){const o=e.match(/,\s*([0-9.]+)G memory peak/i)??e.match(/,\s*([0-9.]+)M memory peak/i);if(!o)return null;const t=Number(o[1]);return Number.isFinite(t)?/G memory peak/i.test(e)?Math.round(t*1024):Math.round(t):null}function me(e){const o=e.split(`
`).filter(Boolean),t=new RegExp(f,"i"),r=new RegExp(E,"i"),n=new RegExp(w,"i");let a=0,s=0,i=0,l=null,c=0;for(const _ of o){t.test(_)&&(s+=1),r.test(_)&&(a+=1),n.test(_)&&(i+=1);const m=_e(_);m!=null&&(l=l==null?m:Math.max(l,m),m>=3200&&(c+=1))}return{oomKillCount:a,restartCount:s,failureCount:i,peakMemoryMb:l,highMemoryPeakCount:c,journalError:null,journalAvailable:!0}}function pe(e){const o=new RegExp(E,"i");return e.split(`
`).filter(t=>/papercup-bg-host|bg-host/i.test(t)).filter(t=>o.test(t)).length}function de(e){const o=[],t=[];e.bgHost.tickerUp||o.push(`bg-host ticker unhealthy${e.bgHost.tickerNote?`: ${e.bgHost.tickerNote}`:""}`),e.bgHost.journalAvailable===!1?t.push("bg-host unit-restart evidence unavailable on this platform (no journald) — criterion omitted"):e.bgHost.journalError&&o.push(`bg-host journal unreadable — OOM/restart evidence unavailable (${e.bgHost.journalError})`),e.bgHost.oomKillCount>0&&o.push(`bg-host OOM evidence in window (${e.bgHost.oomKillCount})`),e.bgHost.failureCount>0&&o.push(`bg-host FAILED ${e.bgHost.failureCount} time(s) in window (crash/OOM/watchdog — deliberate restarts excluded)`),ae(e.frontier)&&o.push(`placement DEADLOCKED: 0 placeable, ${e.frontier.quarantined} item(s) quarantined by the admission gate (remote origin, unaudited) — the loop has work it may never place, and no admit path will clear it`),e.infraCurse.rate==null?o.push("no placement evidence for infra-curse rate"):e.infraCurse.infraCurses>0&&o.push(`infra-attributed curse rate non-zero (${Math.round(e.infraCurse.rate*100)}%)`),e.infraCurse.staleRecovering>0&&o.push(`stale placement recovery exceeds ${Math.round(C/36e5)}h (${e.infraCurse.staleRecovering})`);for(const r of e.roleSuccess)r.successRate==null?o.push(`no terminal ${r.role} turns in window`):r.successRate<1&&o.push(`${r.role} turn success below 100% (${Math.round(r.successRate*100)}%)`);return e.escalationBacklog.openNow>0&&(o.push(`open escalation backlog present (${e.escalationBacklog.openNow})`),e.escalationBacklog.improving||o.push("open escalation backlog is not shrinking")),e.gateGreenRatio.ratio==null?o.push("no green-checkpoint evidence in window"):e.gateGreenRatio.ratio<1&&o.push(`green-checkpoint ratio below 100% (${Math.round(e.gateGreenRatio.ratio*100)}%)`),e.deployLatency.meanMs==null?o.push("no deploy-latency evidence in window"):e.deployLatency.meanMs>9e5&&o.push(`mean deploy latency above ${Math.round(O/6e4)}m`),e.contextBurn.meanWakeChars!=null&&e.contextBurn.meanWakeChars>3e3&&o.push(`per-wake injected overhead above budget (mean ${e.contextBurn.meanWakeChars} chars > ${y})`),e.contextBurn.postCompactionErrorMarkers>0&&o.push(`post-compaction error markers in window (${e.contextBurn.postCompactionErrorMarkers})`),{potSlug:e.potSlug,surveyScope:e.surveyScope,surveySlugs:e.surveySlugs,windowHours:e.windowHours,generatedAt:new Date(e.generatedAtMs).toISOString(),ready:o.length===0,reasons:o,notes:t,bgHost:e.bgHost,roleSuccess:e.roleSuccess,infraCurse:e.infraCurse,escalationBacklog:e.escalationBacklog,gateGreenRatio:e.gateGreenRatio,deployLatency:e.deployLatency,contextBurn:e.contextBurn,frontier:e.frontier}}function g(e){return e instanceof Date?e.getTime():new Date(e).getTime()}async function Ee(e){try{return await oe().getOrSet(T(),`bg-host-journal:${e}`,()=>b(e),{softTtlMs:H,hardTtlMs:D,tags:[I]})}catch{return b(e)}}async function b(e){const o=["--user","--since",`${e} hours ago`,"--no-pager","--case-sensitive=false"],t=32*1024*1024;try{const[r,n]=await Promise.all([R("journalctl",[...o,"-u","papercup-bg-host.service","--grep",[f,E,v,w].join("|")],{maxBuffer:t,timeout:k}),R("journalctl",[...o,"-u","papercup-bg-host.service","--grep",E],{maxBuffer:t,timeout:k})]),a=me(r.stdout);return{...a,oomKillCount:Math.max(a.oomKillCount,pe(n.stdout))}}catch(r){const n=r;return n.killed?{oomKillCount:0,restartCount:0,failureCount:0,peakMemoryMb:null,highMemoryPeakCount:0,journalError:`journalctl read timed out after ${k}ms (signal ${String(n.signal??"?")}) — journal likely slow/large; counts below are UNKNOWN, not clean`,journalAvailable:!0}:n.code===1&&!String(n.stderr??"").trim()?{oomKillCount:0,restartCount:0,failureCount:0,peakMemoryMb:null,highMemoryPeakCount:0,journalError:null,journalAvailable:!0}:n.code==="ENOENT"?{oomKillCount:0,restartCount:0,failureCount:0,peakMemoryMb:null,highMemoryPeakCount:0,journalError:null,journalAvailable:!1}:{oomKillCount:0,restartCount:0,failureCount:0,peakMemoryMb:null,highMemoryPeakCount:0,journalError:(String(n.stderr??"").trim()||r?.message||"journalctl read failed").slice(0,200),journalAvailable:!0}}}function he(e){const o=new Map(e.map(t=>[t.child_role,t]));return["cup","mug","kettle"].map(t=>{const r=o.get(t),n=Number(r?.total_terminal??0),a=Number(r?.successful??0);return{role:t,totalTerminalTurns:n,successfulTurns:a,successRate:n>0?a/n:null}})}function ge(e){const o=e.slice().sort((n,a)=>g(n.created_at)-g(a.created_at));let t=null;const r=[];for(const n of o){if(n.kind==="green_checkpoint"&&(n.status==="advanced"||n.status==="up-to-date")){t=g(n.created_at);continue}n.kind==="deploy"&&n.status==="ok"&&t!=null&&(r.push(Math.max(0,g(n.created_at)-t)),t=null)}return{samples:r.length,meanMs:r.length?Math.round(r.reduce((n,a)=>n+a,0)/r.length):null}}async function ke(e,o){const{workspaceId:t,windowHours:r}=o,[n,a]=await Promise.all([e`
      SELECT count(*) FILTER (WHERE source LIKE ${h+"%"})::int AS loop_wakes,
             round(avg(length(summary)) FILTER (WHERE source LIKE ${h+"%"}))::int AS mean_wake_chars,
             max(length(summary)) FILTER (WHERE source LIKE ${h+"%"})::int AS max_wake_chars,
             count(*) FILTER (WHERE source IS DISTINCT FROM NULL AND source NOT LIKE ${h+"%"})::int AS non_loop_wakes
        FROM harness_shared.event_wake_deliveries
       WHERE workspace_id = ${q}
         AND event_key LIKE 'coord:inbox-wake:%'
         AND created_at >= now() - make_interval(hours => ${r})
    `,e`
      WITH compactions AS (
        SELECT coord_owner_id AS owner, invoked_at
          FROM harness_shared.tool_invocations
         WHERE workspace_id = ${t}
           AND tool_name = 'session:request-compaction'
           AND status = 'ok'
           AND invoked_at >= now() - make_interval(hours => ${r})
      )
      SELECT (SELECT count(*) FROM compactions)::int AS compactions,
             (SELECT count(DISTINCT owner) FROM compactions WHERE owner IS NOT NULL)::int AS sessions,
             (SELECT count(*)
                FROM harness_shared.tool_invocations ti
               WHERE ti.workspace_id = ${t}
                 AND ti.invoked_at >= now() - make_interval(hours => ${r})
                 AND ti.status <> 'ok'
                 AND ti.error_message ~* ${L}
                 AND EXISTS (
                   SELECT 1
                     FROM compactions c
                    WHERE c.owner IS NOT NULL
                      AND c.owner = ti.coord_owner_id
                      AND ti.invoked_at >= c.invoked_at
                      AND ti.invoked_at < c.invoked_at + make_interval(mins => ${15})
                 ))::int AS post_markers
    `]),s=n[0]??{loop_wakes:0,mean_wake_chars:null,max_wake_chars:null,non_loop_wakes:0},i=a[0]??{compactions:0,sessions:0,post_markers:0},l=s.mean_wake_chars!=null?Number(s.mean_wake_chars):null,c=Number(i.sessions??0);return{loopWakes:Number(s.loop_wakes??0),meanWakeChars:l,maxWakeChars:s.max_wake_chars!=null?Number(s.max_wake_chars):null,estMeanWakeTokens:l!=null?Math.round(l/4):null,nonLoopInboxWakes:Number(s.non_loop_wakes??0),requestedCompactions:Number(i.compactions??0),sessionsCompacting:c,compactionsPerSession:c>0?Number(i.compactions??0)/c:null,postCompactionErrorMarkers:Number(i.post_markers??0)}}async function $e(e,o={}){const t=ue(o.windowHours),r=o.sql??U().sql,n=T(),a=await ce(n,e),s=a.surveySlugs.length>0?a.surveySlugs:[e],[i,l,c,_,m,$,W,F,x,B]=await X(()=>Promise.all([ee(),Ee(t),r`
      SELECT child_role,
             count(*) FILTER (WHERE status IN ('done', 'failed', 'cancelled', 'reaped'))::int AS total_terminal,
             count(*) FILTER (WHERE status = 'done')::int AS successful
        FROM harness_shared.spawned_agents
       WHERE workspace_id = ${n}
         AND harness_slug = ANY(${r.array(s)})
         AND child_role IN ('cup', 'mug', 'kettle')
         AND started_at >= now() - make_interval(hours => ${t})
       GROUP BY 1
    `,r`
      WITH scoped AS (
        SELECT p.*,
               EXISTS (
                 SELECT 1
                   FROM harness_shared.harness_features_consolidated u
                  WHERE u.workspace_id = p.workspace_id
                    AND u.feature_id = p.work_item_id
                    AND (p.harness_slug IS NULL OR u.harness_slug = p.harness_slug)
                    AND u.status <> ALL(${r.array(re)})
               ) AS unit_active
          FROM harness_shared.pot_placements p
         WHERE p.workspace_id = ${n}
           AND p.install_slug = ${e}
      )
      SELECT count(*) FILTER (
               WHERE updated_at >= now() - make_interval(hours => ${t})
             )::int AS placements_seen,
             count(*) FILTER (
               WHERE status = 'cursed'
                 AND COALESCE(fail_count, 0) = 0
                 AND COALESCE(infra_loss_count, 0) > 0
                 AND updated_at >= now() - make_interval(hours => ${t})
             )::int AS infra_curses,
             count(*) FILTER (
               WHERE status = 'recovering' AND unit_active
             )::int AS recovering_open,
             count(*) FILTER (
               WHERE status = 'recovering'
                 AND unit_active
                 AND COALESCE(recovery_started_at, last_recovery_at, updated_at, placed_at)
                   <= now() - ${C} * interval '1 millisecond'
             )::int AS stale_recovering
        FROM scoped
    `,r`
      WITH scoped AS (
        SELECT ts
          FROM harness_shared.coord_open_escalations
         WHERE workspace_id = ${n}
           AND COALESCE(
                 body::jsonb ->> 'harnessSlug',
                 body::jsonb ->> 'harness_slug',
                 body::jsonb ->> 'harness',
                 ''
               ) = ANY(${r.array(s)})
      )
      SELECT count(*)::int AS open_now,
             count(*) FILTER (
               WHERE ts < now() - make_interval(hours => ${Math.max(1,Math.floor(t/2))})
             )::int AS older_open_count,
             count(*) FILTER (
               WHERE ts >= now() - make_interval(hours => ${Math.max(1,Math.floor(t/2))})
             )::int AS newer_open_count
        FROM scoped
    `,r`
      SELECT count(*) FILTER (
               WHERE kind = 'green_checkpoint'
                 AND status NOT IN ('skipped-disabled', 'skipped-locked')
             )::int AS green_total,
             count(*) FILTER (
               WHERE kind = 'green_checkpoint'
                 AND status IN ('advanced', 'up-to-date')
             )::int AS green_success
        FROM harness_shared.pipeline_events
       WHERE install_slug = ${e}
         AND created_at >= now() - make_interval(hours => ${t})
    `,r`
      SELECT kind, status, created_at
        FROM harness_shared.pipeline_events
       WHERE install_slug = ${e}
         AND created_at >= now() - make_interval(hours => ${t})
         AND (
           (kind = 'green_checkpoint' AND status IN ('advanced', 'up-to-date'))
           OR (kind = 'deploy' AND status = 'ok')
         )
       ORDER BY created_at ASC
    `,ke(r,{workspaceId:n,windowHours:t}),se(r,n,s),le(r,n,s)]),{classifier:z,label:"readPotSoakReport"}),u=_[0]??{placements_seen:0,infra_curses:0,recovering_open:0,stale_recovering:0},p=m[0]??{open_now:0,older_open_count:0,newer_open_count:0},d=$[0]??{green_total:0,green_success:0},P=ge(W);return de({potSlug:e,surveyScope:a.scope,surveySlugs:s,windowHours:t,generatedAtMs:Date.now(),bgHost:{...l,tickerUp:i.up,tickerNote:i.note??null},roleSuccess:he(c),frontier:{placeable:x,quarantined:B},infraCurse:{placementsSeen:Number(u.placements_seen??0),infraCurses:Number(u.infra_curses??0),rate:Number(u.placements_seen??0)>0?Number(u.infra_curses??0)/Number(u.placements_seen??0):null,recoveringOpen:Number(u.recovering_open??0),staleRecovering:Number(u.stale_recovering??0)},escalationBacklog:{openNow:Number(p.open_now??0),olderOpenCount:Number(p.older_open_count??0),newerOpenCount:Number(p.newer_open_count??0),improving:Number(p.newer_open_count??0)<=Number(p.older_open_count??0)},gateGreenRatio:{green:Number(d.green_success??0),total:Number(d.green_total??0),ratio:Number(d.green_total??0)>0?Number(d.green_success??0)/Number(d.green_total??0):null},deployLatency:P,contextBurn:F})}var S,M,R,Re,fe,we,O,f,E,v,w,y,Ae,L,H,D,I,k,We=j((()=>{S=A(N(),1),M=A(N(),1),K(),G(),Z(),J(),te(),Y(),V(),Q(),ie(),ne(),R=(0,M.promisify)(S.execFile),Re=24,fe=12,we=24,O=15*6e4,f="Started papercup-bg-host\\.service",E="OOM killer|FatalProcessOutOfMemory|ReportOOMFailure|Out of memory",v="memory peak",w="Failed with result",y=3e3,Ae=15,L="column .* does not exist|relation .* does not exist|no such column",H=5*6e4,D=30*6e4,I="bg-host-journal",k=8e3}));export{$e as _,v as a,O as c,de as d,We as f,ke as g,b as h,H as i,L as l,me as m,I as n,E as o,pe as p,D as r,f as s,w as t,y as u};
