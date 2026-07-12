import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{J as r,t as i}from"./src-CgbVJkBN.js";import{i as a,t as o}from"./fleet-membership-store-B2kmQzMK.js";var s,c=e((()=>{s=600*1e3})),l=e((()=>{c()}));function u(e){if(Array.isArray(e))return e;if(typeof e==`string`)try{let t=JSON.parse(e);return Array.isArray(t)?t:[]}catch{return[]}return[]}function d(e,t){let n=u(e.current_files),r=u(e.capability_tags);return{ownerId:e.owner_id,ownerLabel:e.owner_label,workspaceId:e.workspace_id,source:e.source,intent:e.intent,currentPlanSlug:e.current_plan_slug,currentFiles:n,host:e.host,pid:e.pid,startedAt:e.started_at,heartbeatAt:e.heartbeat_at,lastActiveAt:e.last_active_at,intentDeclaredAt:e.intent_declared_at,agentRole:e.agent_role,potSlug:e.pot_slug,capabilityTags:r,compactionLimit:e.compaction_limit,contextTokens:e.context_tokens,contextEstimatedAt:e.context_estimated_at,stale:t-new Date(e.heartbeat_at).getTime()>s,userId:e.user_id,revoked:e.revoked_at!=null}}var f,p=e((()=>{l(),f=class{opts;constructor(e){this.opts=e}async write(e,t={}){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_presence
        (owner_id, owner_label, workspace_id, source, intent,
         current_plan_slug, current_files, host, pid,
         agent_role, pot_slug, capability_tags, heartbeat_at, last_active_at, intent_declared_at)
      VALUES (
        ${e.ownerId}, ${e.ownerLabel},
        ${e.workspaceId??`default`}, ${e.source},
        ${t.intent??``}, ${t.currentPlanSlug??null},
        ${JSON.stringify(t.currentFiles??[])}::text::jsonb,
        ${t.host??``}, ${t.pid??null},
        ${t.agentRole??null}, ${t.potSlug??null},
        ${JSON.stringify(t.capabilityTags??[])}::text::jsonb,
        now(), now(), now()
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
        -- populate-once-then-keep, same family as agent_role/pot_slug: an
        -- omitted/empty capabilityTags on this write (serializes to '[]')
        -- must not clobber a previously-detected tag set.
        capability_tags   = COALESCE(
                               NULLIF(EXCLUDED.capability_tags, '[]'::jsonb),
                               harness_shared.coord_presence.capability_tags
                             ),
        heartbeat_at      = now(),
        last_active_at    = now(),
        -- EI-8988: only advance when the intent TEXT actually changes — a
        -- re-declare of the same string (or a row from before this column
        -- existed) must not look like a fresh declaration.
        intent_declared_at = CASE
          WHEN EXCLUDED.intent IS DISTINCT FROM harness_shared.coord_presence.intent
            THEN now()
          ELSE COALESCE(harness_shared.coord_presence.intent_declared_at, now())
        END
    `}async touchHeartbeat(e,t){await this.opts.ensureSchema();let n=this.opts.getSql(),r=t?.pid,i=t?.host;r!=null&&i!=null?await n`
        UPDATE harness_shared.coord_presence
           SET heartbeat_at = now(), pid = ${r}, host = ${i}
         WHERE owner_id = ${e}
      `:r==null?i==null?await n`
        UPDATE harness_shared.coord_presence
           SET heartbeat_at = now()
         WHERE owner_id = ${e}
      `:await n`
        UPDATE harness_shared.coord_presence
           SET heartbeat_at = now(), host = ${i}
         WHERE owner_id = ${e}
      `:await n`
        UPDATE harness_shared.coord_presence
           SET heartbeat_at = now(), pid = ${r}
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
    `}async list(e={}){await this.opts.ensureSchema();let t=this.opts.getSql(),n=e.workspaceId??null,r=e.potSlug??null,i=await t`
      SELECT cp.owner_id, cp.owner_label, cp.workspace_id, cp.source,
             cp.intent, cp.current_plan_slug, cp.current_files,
             cp.host, cp.pid, cp.started_at, cp.heartbeat_at,
             cp.last_active_at, cp.intent_declared_at, cp.agent_role, cp.pot_slug, cp.capability_tags, cp.compaction_limit,
             cp.context_tokens, cp.context_estimated_at,
             pus.user_id, pus.revoked_at
        FROM harness_shared.coord_presence cp
        LEFT JOIN harness_shared.power_user_sessions pus
          ON pus.auth_session_id = cp.owner_id
       WHERE ${n==null?t`TRUE`:t`cp.workspace_id = ${n}`}
         AND ${r==null?t`TRUE`:t`cp.pot_slug = ${r}`}
       ORDER BY cp.owner_id
    `,a=Date.now();return i.map(e=>d(e,a))}async get(e){await this.opts.ensureSchema();let t=await this.opts.getSql()`
      SELECT cp.owner_id, cp.owner_label, cp.workspace_id, cp.source,
             cp.intent, cp.current_plan_slug, cp.current_files,
             cp.host, cp.pid, cp.started_at, cp.heartbeat_at,
             cp.last_active_at, cp.intent_declared_at, cp.agent_role, cp.pot_slug, cp.capability_tags, cp.compaction_limit,
             cp.context_tokens, cp.context_estimated_at,
             pus.user_id, pus.revoked_at
        FROM harness_shared.coord_presence cp
        LEFT JOIN harness_shared.power_user_sessions pus
          ON pus.auth_session_id = cp.owner_id
       WHERE cp.owner_id = ${e}
    `;return t.length>0?d(t[0],Date.now()):null}async sweepStale(e){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      DELETE FROM harness_shared.coord_presence
       WHERE heartbeat_at < now() - ${`${Math.max(1,Math.floor(e/1e3))} seconds`}::interval
      RETURNING owner_id
    `).length}}})),m=e((()=>{l(),p()})),h=e((()=>{n()})),g=e((()=>{i()}));async function _(e,t,n,r,i){await o({workspaceId:e,ownerId:t,fleetSlug:n,fleetRole:r},i)}async function v(e){await T.touchActivity(e)}async function y(e,t){await T.setCompactionLimit(e,t)}async function b(e,t){await T.setContextEstimate(e,t)}async function x(e){await T.heartbeat(e)}async function S(e={}){return T.list(e)}async function C(e){return T.get(e)}var w,T,E=e((()=>{w=t(n(),1),i(),m(),h(),g(),a(),T=new f({getSql:()=>r().sql,ensureSchema:async()=>{}}),(0,w.hostname)()}));export{y as a,v as c,c as d,S as i,m as l,x as n,b as o,E as r,_ as s,C as t,s as u};