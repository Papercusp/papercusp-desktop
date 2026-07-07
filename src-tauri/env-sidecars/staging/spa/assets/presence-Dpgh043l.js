import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-DTtGQmae.js";import{i as r,t as i}from"./fleet-membership-store-B9WK1hOr.js";var a,o=e((()=>{a=600*1e3})),s=e((()=>{o()}));function c(e){if(Array.isArray(e))return e;if(typeof e==`string`)try{let t=JSON.parse(e);return Array.isArray(t)?t:[]}catch{return[]}return[]}function l(e,t){let n=c(e.current_files);return{ownerId:e.owner_id,ownerLabel:e.owner_label,workspaceId:e.workspace_id,source:e.source,intent:e.intent,currentPlanSlug:e.current_plan_slug,currentFiles:n,host:e.host,pid:e.pid,startedAt:e.started_at,heartbeatAt:e.heartbeat_at,lastActiveAt:e.last_active_at,agentRole:e.agent_role,hiveSlug:e.pot_slug,compactionLimit:e.compaction_limit,contextTokens:e.context_tokens,contextEstimatedAt:e.context_estimated_at,stale:t-new Date(e.heartbeat_at).getTime()>a,userId:e.user_id,revoked:e.revoked_at!=null}}var u,d=e((()=>{s(),u=class{opts;constructor(e){this.opts=e}async write(e,t={}){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_presence
        (owner_id, owner_label, workspace_id, source, intent,
         current_plan_slug, current_files, host, pid,
         agent_role, pot_slug, heartbeat_at, last_active_at)
      VALUES (
        ${e.ownerId}, ${e.ownerLabel},
        ${e.workspaceId??`default`}, ${e.source},
        ${t.intent??``}, ${t.currentPlanSlug??null},
        ${JSON.stringify(t.currentFiles??[])}::text::jsonb,
        ${t.host??``}, ${t.pid??null},
        ${t.agentRole??null}, ${t.hiveSlug??null}, now(), now()
      )
      ON CONFLICT (owner_id) DO UPDATE SET
        owner_label       = EXCLUDED.owner_label,
        workspace_id      = EXCLUDED.workspace_id,
        source            = EXCLUDED.source,
        intent            = EXCLUDED.intent,
        current_plan_slug = EXCLUDED.current_plan_slug,
        current_files     = EXCLUDED.current_files,
        host              = EXCLUDED.host,
        pid               = EXCLUDED.pid,
        agent_role        = COALESCE(EXCLUDED.agent_role, harness_shared.coord_presence.agent_role),
        pot_slug          = COALESCE(EXCLUDED.pot_slug, harness_shared.coord_presence.pot_slug),
        heartbeat_at      = now(),
        last_active_at    = now()
    `}async touchHeartbeat(e){await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_presence
         SET heartbeat_at = now()
       WHERE owner_id = ${e}
    `}async touchActivity(e){await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_presence
         SET heartbeat_at = now(), last_active_at = now()
       WHERE owner_id = ${e}
    `}async setCompactionLimit(e,t){await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_presence
         SET compaction_limit = ${t}
       WHERE owner_id = ${e}
    `}async setContextEstimate(e,t){await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_presence
         SET context_tokens = ${t}, context_estimated_at = now()
       WHERE owner_id = ${e}
    `}async heartbeat(e){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_presence
        (owner_id, owner_label, workspace_id, source, heartbeat_at, last_active_at)
      VALUES (
        ${e.ownerId}, ${e.ownerLabel},
        ${e.workspaceId??`default`}, ${e.source}, now(), now()
      )
      ON CONFLICT (owner_id) DO UPDATE SET
        owner_label    = EXCLUDED.owner_label,
        workspace_id   = EXCLUDED.workspace_id,
        source         = EXCLUDED.source,
        heartbeat_at   = now(),
        last_active_at = now()
    `}async clear(e){await this.opts.ensureSchema(),await this.opts.getSql()`
      DELETE FROM harness_shared.coord_presence WHERE owner_id = ${e}
    `}async list(e={}){await this.opts.ensureSchema();let t=this.opts.getSql(),n=e.workspaceId??null,r=e.hiveSlug??null,i=await t`
      SELECT cp.owner_id, cp.owner_label, cp.workspace_id, cp.source,
             cp.intent, cp.current_plan_slug, cp.current_files,
             cp.host, cp.pid, cp.started_at, cp.heartbeat_at,
             cp.last_active_at, cp.agent_role, cp.pot_slug, cp.compaction_limit,
             cp.context_tokens, cp.context_estimated_at,
             pus.user_id, pus.revoked_at
        FROM harness_shared.coord_presence cp
        LEFT JOIN harness_shared.power_user_sessions pus
          ON pus.auth_session_id = cp.owner_id
       WHERE ${n==null?t`TRUE`:t`cp.workspace_id = ${n}`}
         AND ${r==null?t`TRUE`:t`cp.pot_slug = ${r}`}
       ORDER BY cp.owner_id
    `,a=Date.now();return i.map(e=>l(e,a))}async get(e){await this.opts.ensureSchema();let t=await this.opts.getSql()`
      SELECT cp.owner_id, cp.owner_label, cp.workspace_id, cp.source,
             cp.intent, cp.current_plan_slug, cp.current_files,
             cp.host, cp.pid, cp.started_at, cp.heartbeat_at,
             cp.last_active_at, cp.agent_role, cp.pot_slug, cp.compaction_limit,
             cp.context_tokens, cp.context_estimated_at,
             pus.user_id, pus.revoked_at
        FROM harness_shared.coord_presence cp
        LEFT JOIN harness_shared.power_user_sessions pus
          ON pus.auth_session_id = cp.owner_id
       WHERE cp.owner_id = ${e}
    `;return t.length>0?l(t[0],Date.now()):null}async sweepStale(e){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      DELETE FROM harness_shared.coord_presence
       WHERE heartbeat_at < now() - ${`${Math.max(1,Math.floor(e/1e3))} seconds`}::interval
      RETURNING owner_id
    `).length}}})),f=e((()=>{s(),d()})),p=e((()=>{n()}));async function m(e,t,n,r,a){await i({workspaceId:e,ownerId:t,fleetSlug:n,fleetRole:r},a)}async function h(e){await x.touchActivity(e)}async function g(e,t){await x.setCompactionLimit(e,t)}async function _(e,t){await x.setContextEstimate(e,t)}async function v(e){await x.heartbeat(e)}async function y(e={}){return x.list(e)}async function b(e){return x.get(e)}var x,S=e((()=>{n(),f(),p(),r(),x=new u({getSql:()=>t().sql,ensureSchema:async()=>{}})}));export{g as a,h as c,o as d,y as i,f as l,v as n,_ as o,S as r,m as s,b as t,a as u};