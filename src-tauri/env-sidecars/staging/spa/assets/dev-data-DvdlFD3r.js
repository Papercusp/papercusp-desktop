import{n as e}from"./chunk-CMxvf4Kt.js";import{t}from"./__vite-browser-external-CM3Eme-n.js";import{J as n,t as r}from"./src-C4H77EbW.js";import{l as i,s as a}from"./workspace-registry-Bu1Yy540.js";import{a as o,c as s}from"./harness-registry-CWycWYvL.js";import{n as c}from"./harness-core-Cd5JH5Zo.js";var l=e((()=>{t(),t(),r(),c()}));function u(e,t){if(!t)return e``;if(t.length===0)return e`AND 1=0`;let n=t.includes(`unknown`),r=t.filter(e=>e!==`unknown`);return n&&r.length===0?e`AND transport IS NULL`:n?e`AND (transport = ANY(${r}) OR transport IS NULL)`:e`AND transport = ANY(${r})`}function d(e){let t=i();if(e===null)return t.workspaces;let n=new Set(e);return t.workspaces.filter(e=>n.has(e.id))}async function f(e){let t=d(e),n=[];for(let e of t){let t=await s(e.id);for(let r of t.projects)n.push({slug:r.slug,path:r.path,harness_kind:r.harness_kind,workspaceId:e.id,workspaceName:e.name||e.id})}return{harnesses:n}}async function p(e){let t=Math.max(1,Math.min(336,e.hours??24)),r=Math.max(1,Math.min(500,e.limit??100)),{sql:i}=n(),a=new Date(Date.now()-t*3600*1e3).toISOString(),o=e.workspaceIds&&e.workspaceIds.length>0,s=e.workspaceIds??[],c=u(i,e.transports);return{entries:(o?await i`
        SELECT
          tool_name,
          count(*)::int AS call_count,
          count(*) FILTER (WHERE status != 'ok')::int AS error_count,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
          coalesce(sum(output_size), 0)::float8 AS total_bytes,
          avg(output_size)::float8 AS avg_bytes,
          (count(*) - count(DISTINCT spawn_id))::int AS repeat_within_spawn,
          count(DISTINCT coalesce(coord_owner_id, spawn_id))::int AS distinct_callers,
          array_agg(DISTINCT workspace_id) AS workspaces
        FROM harness_shared.tool_invocations
        WHERE invoked_at > ${a}::timestamptz
          AND workspace_id = ANY(${i.array(s)})
          ${c}
        GROUP BY tool_name
        ORDER BY call_count DESC
        LIMIT ${r}
      `:await i`
        SELECT
          tool_name,
          count(*)::int AS call_count,
          count(*) FILTER (WHERE status != 'ok')::int AS error_count,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
          coalesce(sum(output_size), 0)::float8 AS total_bytes,
          avg(output_size)::float8 AS avg_bytes,
          (count(*) - count(DISTINCT spawn_id))::int AS repeat_within_spawn,
          count(DISTINCT coalesce(coord_owner_id, spawn_id))::int AS distinct_callers,
          array_agg(DISTINCT workspace_id) AS workspaces
        FROM harness_shared.tool_invocations
        WHERE invoked_at > ${a}::timestamptz
          ${c}
        GROUP BY tool_name
        ORDER BY call_count DESC
        LIMIT ${r}
      `).map(e=>({tool_name:e.tool_name,call_count:e.call_count,error_count:e.error_count,p50_ms:e.p50==null?null:Math.round(e.p50),p95_ms:e.p95==null?null:Math.round(e.p95),total_bytes:Math.round(e.total_bytes??0),avg_bytes:e.avg_bytes==null?null:Math.round(e.avg_bytes),repeat_within_spawn:e.repeat_within_spawn??0,distinct_callers:e.distinct_callers??0,workspaces:e.workspaces??[]}))}}async function m(e=7){let t=Math.max(1,Math.min(90,e)),{sql:r}=n(),i=new Date(Date.now()-t*24*3600*1e3).toISOString();return{entries:(await r`
    WITH totals AS (
      SELECT file_path,
        count(*) FILTER (WHERE status = 'fail')::int AS fails,
        count(*) FILTER (WHERE status = 'pass')::int AS passes,
        max(created_at) FILTER (WHERE status = 'fail') AS last_fail,
        max(created_at) FILTER (WHERE status = 'pass') AS last_pass
      FROM harness_shared.test_runs
      WHERE created_at > ${i}::timestamptz
      GROUP BY file_path
    ),
    per_sha AS (
      SELECT file_path, commit_sha,
        count(*) FILTER (WHERE status = 'fail') AS sha_fails,
        count(*) FILTER (WHERE status = 'pass') AS sha_passes
      FROM harness_shared.test_runs
      WHERE created_at > ${i}::timestamptz
        AND commit_sha IS NOT NULL
      GROUP BY file_path, commit_sha
    ),
    both_shas AS (
      SELECT file_path, count(*)::int AS both_status_shas
      FROM per_sha
      WHERE sha_fails > 0 AND sha_passes > 0
      GROUP BY file_path
    )
    SELECT
      t.file_path,
      t.fails,
      t.passes,
      coalesce(b.both_status_shas, 0) AS both_status_shas,
      round(t.fails::numeric / nullif(t.fails + t.passes, 0), 3) AS flake_rate,
      t.last_fail,
      t.last_pass
    FROM totals t
    LEFT JOIN both_shas b ON b.file_path = t.file_path
    WHERE t.fails > 0
    ORDER BY t.fails DESC
    LIMIT 500
  `).map(e=>({file_path:e.file_path,fails:e.fails,passes:e.passes,both_status_shas:e.both_status_shas,flake_rate:e.flake_rate==null?0:Number(e.flake_rate),last_fail:e.last_fail,last_pass:e.last_pass}))}}function h(e,t=7){let n=[];for(let r of e)r.fails>=5&&r.both_status_shas>=2&&n.push({...r,reason:`${r.fails} fail(s) / ${r.passes} pass(es) over ${t}d, ${r.both_status_shas} commit(s) with BOTH a pass and a fail — flake-shaped, not commit-specific; expect flaky test infra (timing, shared state, external dep) rather than a regression (EI-7443)`});return n.sort((e,t)=>t.fails-e.fails||t.both_status_shas-e.both_status_shas),n}async function g(){let{sql:e}=n(),t=(await e`
    SELECT
      version() AS version,
      count(*) FILTER (WHERE datname = current_database())::int AS total,
      count(*) FILTER (WHERE datname = current_database() AND state = 'active')::int AS active,
      count(*) FILTER (WHERE datname = current_database() AND state = 'idle')::int AS idle,
      count(*)::int AS server_wide,
      current_setting('max_connections')::int AS max_conn,
      extract(epoch from pg_postmaster_start_time())::float8 AS postmaster_start_epoch
    FROM pg_stat_activity
  `)[0],r=await e`
    SELECT coalesce(nullif(application_name, ''), '(unset)') AS name, count(*)::int AS count
    FROM pg_stat_activity
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 20
  `,i=t?.max_conn??0,a=t?.server_wide??0;return{version:t?.version??`unknown`,totalConnections:t?.total??0,activeConnections:t?.active??0,idleConnections:t?.idle??0,maxConnections:i,serverWideConnections:a,saturationPct:i>0?Math.round(a/i*1e3)/10:0,byApplication:r.map(e=>({name:e.name,count:e.count})),postmasterStartMs:t?.postmaster_start_epoch==null?null:Math.round(t.postmaster_start_epoch*1e3)}}var _=e((()=>{r(),l(),o(),a()}));export{p as a,g as i,_ as n,m as o,f as r,h as t};