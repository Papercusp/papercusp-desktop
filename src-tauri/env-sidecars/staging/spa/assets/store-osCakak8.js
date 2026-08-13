import{n as p,o as h}from"./chunk-ChpBd9eV.js";import{st as N,t as b}from"./src-BmBNODK0.js";import{t as f}from"./__vite-browser-external-56mrcCg8.js";import{c as x,r as l}from"./workspace-registry-Du2UbhlH.js";function C(t){const e=t.lastIndexOf(")");if(e<0)return null;const n=t.slice(e+1).trim().split(/\s+/)[19];return n&&/^\d+$/.test(n)?n:null}function Z(t){const e=t.lastIndexOf(")");if(e<0)return null;const n=t.slice(e+1).trim().split(/\s+/)[1];if(!n||!/^\d+$/.test(n))return null;const s=Number(n);return Number.isInteger(s)&&s>=0?s:null}function R(t,e){const n=t.trim(),s=C(e);return n&&s?`linux:${n}:${s}`:null}function O(t){return t.trim().split(/\s+/).join(" ")}function tt(t){if(!Number.isInteger(t)||t<=0)return null;try{if(process.platform==="linux")return R((0,k.readFileSync)("/proc/sys/kernel/random/boot_id","utf8"),(0,k.readFileSync)(`/proc/${t}/stat`,"utf8"));if(process.platform==="darwin"){const e=O((0,E.execFileSync)("ps",["-o","lstart=","-p",String(t)],{encoding:"utf8"}));return e?`darwin:${e}`:null}}catch{}return null}var E,k,et=p((()=>{E=h(f(),1),k=h(f(),1)}));function L(t){for(const e of t.split(`
`)){const n=e.trim();if(!n)continue;const s=n.indexOf(":"),a=n.indexOf(":",s+1);if(!(s<0||a<0)&&n.slice(0,s)==="0"&&n.slice(s+1,a)===""){const r=n.slice(a+1);return r.startsWith("/")?r:null}}return null}function D(t){const e=[];for(const n of t.split(`
`)){const s=Number(n.trim());Number.isInteger(s)&&s>0&&e.push(s)}return e}function g(t){if(t==null)return null;const e=t.trim();if(!e||e==="max")return null;const n=Number(e);return Number.isFinite(n)?n:null}function U(t){if(t==null)return null;for(const e of t.split(`
`)){const[n,s]=e.trim().split(/\s+/);if(n==="usage_usec"){const a=Number(s);return Number.isFinite(a)?a:null}}return null}function nt(t){return t?t.split("\0").filter(Boolean).join(" ").trim():""}function st(t,e=u){return{memoryBytes:g(e.readFile(`${t}/memory.current`)),peakMemoryBytes:g(e.readFile(`${t}/memory.peak`)),cpuUsec:U(e.readFile(`${t}/cpu.stat`)),pidsCurrent:g(e.readFile(`${t}/pids.current`))}}function M(t,e=u){const n=e.readFile(`${t}/cgroup.procs`);return n==null?[]:D(n)}function at(t,e=u){const n=e.readFile(`/proc/${t}/cgroup`);return n==null?null:L(n)}function rt(t,e=u,n=32){const s=[],a=[{dir:t,depth:0}];for(;a.length;){const{dir:r,depth:i}=a.pop();if(i>n||!e.isDir(r))continue;const c=M(r,e);c.length>0&&s.push({absDir:r,pids:c});for(const m of e.readDir(r)){const S=`${r}/${m}`;e.isDir(S)&&a.push({dir:S,depth:i+1})}}return s}function it(t,e=y){const n=t.startsWith("/")?t.slice(1):t;return n?`${e}/${n}`:e}function ot(t,e=y){return t.startsWith(e)?t.slice(e.length)||"/":t}var _,y,u,lt=p((()=>{_=h(f(),1),y="/sys/fs/cgroup",u={readFile(t){try{return(0,_.readFileSync)(t,"utf8")}catch{return null}},readDir(t){try{return(0,_.readdirSync)(t)}catch{return[]}},isDir(t){try{return(0,_.statSync)(t).isDirectory()}catch{return!1}}}}));function v(t){return I.includes(t)}function ut(t){return t==="pending"||t==="running"}function F(t=Date.now(),e=Math.random){const n=Math.floor(t).toString(36).padStart(9,"0");let s="";for(;s.length<10;)s+=Math.floor(e()*4294967296).toString(36).replace(/[^0-9a-z]/g,"");return`${n}${s.slice(0,10)}`}function $(t){return/^[0-9a-z]{4,64}$/.test(t)}function P(t,e){if(!$(t))throw new Error(`task-manager: invalid taskId ${JSON.stringify(t)} — must match /^[0-9a-z]{4,64}$/ to be a legal systemd unit name`);const n=(e??"").replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);return n?`pc-${t}--${n}.scope`:`pc-${t}.scope`}function dt(t){const e=t.trim();if(!e.startsWith("pc-")||!e.endsWith(".scope"))return null;const n=e.slice(3,-6),s=n.indexOf("--"),a=s>=0?n.slice(0,s):n;return $(a)?a:null}function B(t){const e=String(t).toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");return e?`papercusp-${e}.slice`:T}function ct(t){if(!t)return null;const e=t.split("/").filter(Boolean),n=e.findIndex(s=>/^user@\d+\.service$/.test(s));return n<0?null:`/${e.slice(0,n+1).join("/")}`}function W(t){const e=(t.endsWith(".slice")?t.slice(0,-6):t).split("-").filter(Boolean);return e.map((n,s)=>`${e.slice(0,s+1).join("-")}.slice`).join("/")}function _t(t,e,n){const s=W(B(e));return`${(t??"").replace(/\/+$/,"")}/${s}/${n}`}var w,I,j,T,H,J=p((()=>{w=["pending","running","exited","killed","timed_out","stranded","unaccounted","foreign","ended_unobserved"],I=["exited","killed","timed_out","stranded","ended_unobserved"],j="pc-",T="papercusp.slice",H="--"}));function o(t){return t??N().sql}function q(t){if(!w.includes(t))throw new Error(`task-manager: unknown state ${JSON.stringify(t)}`)}function d(t){const e=s=>s==null?null:s instanceof Date?s.toISOString():String(s),n=s=>s==null?null:Number(s);return{taskId:t.task_id,workspaceId:t.workspace_id,harnessSlug:t.harness_slug??null,parentTaskId:t.parent_task_id??null,rootTaskId:t.root_task_id,class:t.class,title:t.title,argv:Array.isArray(t.argv)?t.argv:JSON.parse(t.argv??"[]"),cwd:t.cwd??null,launchedBy:t.launched_by,workItemId:t.work_item_id??null,planSlug:t.plan_slug??null,fleetSlug:t.fleet_slug??null,sessionId:t.session_id??null,scopeUnit:t.scope_unit??null,cgroupPath:t.cgroup_path??null,pid:n(t.pid),processIdentity:t.process_identity??null,confined:!!t.confined,memoryMaxBytes:n(t.memory_max_bytes),cpuWeight:n(t.cpu_weight),tasksMax:n(t.tasks_max),deadlineAt:e(t.deadline_at),state:t.state,exitCode:n(t.exit_code),exitReason:t.exit_reason??null,startedAt:e(t.started_at)??new Date(0).toISOString(),endedAt:e(t.ended_at),lastSeenAt:e(t.last_seen_at)??new Date(0).toISOString(),lastMemoryBytes:n(t.last_memory_bytes),peakMemoryBytes:n(t.peak_memory_bytes),cpuUsec:n(t.cpu_usec),pidsCurrent:n(t.pids_current),logPath:t.log_path??null,detail:typeof t.detail=="object"&&t.detail?t.detail:{}}}async function pt(t,e={},n){const s=o(n),a=e.workspaceId??l(),r=e.taskId??F(),i=t.parentTaskId?await z(t.parentTaskId,r,s):r,c=e.reserveScope?P(r):null,m=t.runtimeMaxSec&&t.runtimeMaxSec>0?new Date(Date.now()+t.runtimeMaxSec*1e3).toISOString():null;return d((await s`
    INSERT INTO harness_shared.task_ledger (
      task_id, workspace_id, harness_slug, parent_task_id, root_task_id,
      class, title, argv, cwd,
      launched_by, work_item_id, plan_slug, fleet_slug, session_id,
      scope_unit, memory_max_bytes, cpu_weight, tasks_max, deadline_at,
      state, log_path, detail
    ) VALUES (
      ${r}, ${a}, ${t.harnessSlug??null}, ${t.parentTaskId??null}, ${i},
      ${t.class}, ${t.title}, ${JSON.stringify(t.argv??[])}::jsonb, ${t.cwd??null},
      ${t.launchedBy}, ${t.workItemId??null}, ${t.planSlug??null},
      ${t.fleetSlug??null}, ${t.sessionId??null},
      ${c}, ${t.memoryMaxBytes??null}, ${t.cpuWeight??null},
      ${t.tasksMax??null}, ${m},
      'pending', ${t.logPath??null}, ${JSON.stringify(t.detail??{})}::jsonb
    )
    RETURNING *
  `)[0])}async function z(t,e,n){return(await n`
    SELECT root_task_id FROM harness_shared.task_ledger WHERE task_id = ${t} LIMIT 1
  `)[0]?.root_task_id??e}async function mt(t,e,n){const s=o(n),a=e.unconfinedReason??null;await s`
    UPDATE harness_shared.task_ledger
       SET pid = ${e.pid??null},
           process_identity = ${e.processIdentity??null},
           scope_unit = COALESCE(${e.scopeUnit??null}, scope_unit),
           cgroup_path = COALESCE(${e.cgroupPath??null}, cgroup_path),
           confined = ${e.confined??!1},
           detail = CASE
                      WHEN ${a}::text IS NULL THEN detail
                      ELSE detail || jsonb_build_object('unconfinedReason', ${a}::text)
                    END,
           state = 'running',
           last_seen_at = now(),
           updated_at = now()
     WHERE task_id = ${t}
       AND state = 'pending'
  `}async function A(t,e,n){if(q(e.state),!v(e.state))throw new Error(`task-manager: ${e.state} is not terminal`);return(await o(n)`
    UPDATE harness_shared.task_ledger
       SET state = ${e.state},
           exit_code = ${e.exitCode??null},
           exit_reason = ${e.exitReason??null},
           ended_at = now(),
           last_seen_at = now(),
           updated_at = now()
     WHERE task_id = ${t}
       AND ended_at IS NULL
    RETURNING task_id
  `).length>0}async function gt(t,e){if(t.length===0)return 0;const n=o(e),s=t.map(a=>({task_id:a.taskId,pid:a.pid??null,process_identity:a.processIdentity??null,last_memory_bytes:a.metrics?.lastMemoryBytes??null,cpu_usec:a.metrics?.cpuUsec??null,pids_current:a.metrics?.pidsCurrent??null}));return(await n`
    UPDATE harness_shared.task_ledger t
       SET last_seen_at = now(),
           updated_at = now(),
           pid = COALESCE(u.pid, t.pid),
           process_identity = COALESCE(u.process_identity, t.process_identity),
           last_memory_bytes = COALESCE(u.last_memory_bytes, t.last_memory_bytes),
           -- peak is a high-water mark: it must never fall when a sample dips.
           peak_memory_bytes = GREATEST(
             COALESCE(t.peak_memory_bytes, 0), COALESCE(u.last_memory_bytes, 0)
           ),
           cpu_usec = COALESCE(u.cpu_usec, t.cpu_usec),
           pids_current = COALESCE(u.pids_current, t.pids_current)
      FROM (
        SELECT (x->>'task_id')::text AS task_id,
               (x->>'pid')::int AS pid,
               (x->>'process_identity')::text AS process_identity,
               (x->>'last_memory_bytes')::bigint AS last_memory_bytes,
               (x->>'cpu_usec')::bigint AS cpu_usec,
               (x->>'pids_current')::int AS pids_current
          FROM jsonb_array_elements(${JSON.stringify(s)}::jsonb) AS x
      ) u
     WHERE t.task_id = u.task_id
       AND t.ended_at IS NULL
    RETURNING t.task_id
  `).length}async function ht(t,e){let n=0;for(const s of t)await A(s.taskId,{state:"stranded",exitReason:s.reason},e)&&n++;return n}async function ft(t,e){let n=0;for(const s of t)await A(s.taskId,{state:"ended_unobserved",exitReason:s.reason},e)&&n++;return n}async function G(t={},e){const n=o(e),s=t.workspaceId??l(),a=Math.min(Math.max(t.limit??200,1),2e3);return(await n`
    SELECT * FROM harness_shared.task_ledger
     WHERE workspace_id = ${s}
       ${t.includeEnded?n``:n`AND ended_at IS NULL`}
       ${t.states?.length?n`AND state = ANY(${n.array(t.states)})`:n``}
       ${t.classes?.length?n`AND class = ANY(${n.array(t.classes)})`:n``}
       ${t.launchedBy?n`AND launched_by = ${t.launchedBy}`:n``}
       ${t.workItemId?n`AND work_item_id = ${t.workItemId}`:n``}
       ${t.rootTaskId?n`AND root_task_id = ${t.rootTaskId}`:n``}
     ORDER BY started_at DESC
     LIMIT ${a}
  `).map(d)}async function kt(t,e){return G({workspaceId:t,states:["pending","running"],limit:2e3},e)}async function yt(t,e){const n=await o(e)`SELECT * FROM harness_shared.task_ledger WHERE task_id = ${t} LIMIT 1`;return n[0]?d(n[0]):null}async function St(t,e={},n){const s=await o(n)`
    SELECT * FROM harness_shared.task_ledger
     WHERE workspace_id = ${e.workspaceId??l()}
       AND class = 'bash-job'
       -- WI-8806: REQUIRED for the planner to use task_ledger_bash_job_id_idx, which is
       -- PARTIAL on (class = 'bash-job' AND detail ? 'bashJobId'). Stating only the class
       -- half is not enough. Logically redundant beside the equality below, and load-bearing
       -- for the PLAN: measured 197 -> 1 buffer, 4.93ms -> 0.042ms. Before this clause the
       -- index had an idx_scan of exactly 0 -- it had never been used once since creation.
       AND detail ? 'bashJobId'
       AND detail ->> 'bashJobId' = ${t}
     ORDER BY started_at DESC
     LIMIT 1
  `;return s[0]?d(s[0]):null}async function Et(t,e){return(await o(e)`
    SELECT * FROM harness_shared.task_ledger
     WHERE root_task_id = ${t}
     ORDER BY started_at ASC
  `).map(d)}async function $t(t,e={},n){if(t.length===0)return[];const s=o(n),a=e.workspaceId??l(),r=[];for(const i of t)await s`
      INSERT INTO harness_shared.task_ledger (
        task_id, workspace_id, root_task_id, class, title, argv,
        launched_by, cgroup_path, pid, confined, state, detail
      ) VALUES (
        ${i.taskId}, ${a}, ${i.taskId}, 'other',
        ${i.sampleCmdline.slice(0,200)||"(unknown)"},
        '[]'::jsonb, 'unknown', ${i.cgroupPath}, ${i.pids[0]??null}, false, 'unaccounted',
        ${JSON.stringify({pids:i.pids,scopeUnit:i.scopeUnit})}::jsonb
      )
      ON CONFLICT (task_id) DO UPDATE
        SET last_seen_at = now(),
            updated_at = now(),
            state = CASE WHEN harness_shared.task_ledger.ended_at IS NULL
                         THEN 'unaccounted' ELSE harness_shared.task_ledger.state END,
            detail = ${JSON.stringify({pids:i.pids,scopeUnit:i.scopeUnit})}::jsonb
    `,r.push(i.taskId);return r}async function wt(t,e={},n){const s=o(n);return(await s`
    UPDATE harness_shared.task_ledger
       SET state = 'stranded',
           exit_reason = 'unaccounted residue no longer present',
           ended_at = now(),
           updated_at = now()
     WHERE workspace_id = ${e.workspaceId??l()}
       AND state = 'unaccounted'
       AND ended_at IS NULL
       ${t.length?s`AND task_id <> ALL(${s.array(t)})`:s``}
    RETURNING task_id
  `).length}async function It(t=168,e={},n){return(await o(n)`
    DELETE FROM harness_shared.task_ledger
     WHERE workspace_id = ${e.workspaceId??l()}
       AND ended_at IS NOT NULL
       AND ended_at < now() - make_interval(hours => ${t}::int)
    RETURNING task_id
  `).length}function Tt(t){let e=2166136261,n=16777619;for(let s=0;s<t.length;s++){const a=t.charCodeAt(s);e=Math.imul(e^a,16777619)>>>0,n=Math.imul(n+a,2246822507)>>>0}return`u${e.toString(36)}${n.toString(36)}`.slice(0,24)}var At=p((()=>{b(),x(),J()}));export{lt as A,et as B,F as C,dt as D,B as E,M as F,R as H,at as I,ot as L,D as M,L as N,y as O,nt as P,st as R,v as S,P as T,C as U,Z as V,tt as W,T as _,yt as a,J as b,kt as c,mt as d,ht as f,$t as g,gt as h,Et as i,u as j,it as k,G as l,Tt as m,A as n,St as o,pt as p,It as r,At as s,wt as t,ft as u,w as v,_t as w,ut as x,ct as y,rt as z};
