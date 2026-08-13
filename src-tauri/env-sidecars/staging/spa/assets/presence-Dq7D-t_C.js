import{n as i}from"./chunk-ChpBd9eV.js";var h,u=i((()=>{h=600*1e3})),E=i((()=>{u()}));function p(e){if(Array.isArray(e))return e;if(typeof e=="string")try{const t=JSON.parse(e);return Array.isArray(t)?t:[]}catch{return[]}return[]}function d(e,t){const s=p(e.current_files),a=p(e.capability_tags);return{ownerId:e.owner_id,ownerLabel:e.owner_label,workspaceId:e.workspace_id,source:e.source,intent:e.intent,currentPlanSlug:e.current_plan_slug,currentFiles:s,host:e.host,pid:e.pid,tty:e.tty,startedAt:e.started_at,heartbeatAt:e.heartbeat_at,lastActiveAt:e.last_active_at,intentDeclaredAt:e.intent_declared_at,agentRole:e.agent_role,potSlug:e.pot_slug,capabilityTags:a,compactionLimit:e.compaction_limit,contextTokens:e.context_tokens,contextEstimatedAt:e.context_estimated_at,stale:t-new Date(e.heartbeat_at).getTime()>h,userId:e.user_id,revoked:e.revoked_at!=null}}var w,S=i((()=>{E(),w=class{opts;constructor(e){this.opts=e}async write(e,t={}){await this.opts.ensureSchema();const s=this.opts.getSql(),a=t.currentFiles===void 0?null:JSON.stringify(t.currentFiles);await s`
      INSERT INTO harness_shared.coord_presence
        (owner_id, owner_label, workspace_id, source, intent,
         current_plan_slug, current_files, host, pid, tty,
         agent_role, pot_slug, capability_tags, heartbeat_at, last_active_at, intent_declared_at)
      VALUES (
        ${e.ownerId}, ${e.ownerLabel},
        ${e.workspaceId??"default"}, ${e.source},
        ${t.intent??""}, ${t.currentPlanSlug??null},
        COALESCE(${a}::text::jsonb, '[]'::jsonb),
        ${t.host??""}, ${t.pid??null}, ${t.tty??null},
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
        -- omitted ⇒ untouched, explicit [] ⇒ clear (EI-18776963284535761). Reads the
        -- parameter directly rather than EXCLUDED, because the VALUES row already
        -- COALESCEd the omitted case to '[]' to satisfy the NOT NULL column.
        current_files     = COALESCE(${a}::text::jsonb, harness_shared.coord_presence.current_files),
        host              = EXCLUDED.host,
        pid               = EXCLUDED.pid,
        -- Same "always set from this write's resolved value" rule as host/pid
        -- above — every current write() caller passes tty as undefined (only the
        -- supervisor beat's touchHeartbeat call genuinely knows it), so this
        -- resets to NULL here and the next beat (<=60s) repopulates it, exactly
        -- like host/pid's existing reset-then-repopulate cadence.
        tty               = EXCLUDED.tty,
        -- EI-19418749207847685: a carry-respawn REUSES the ownerId but starts a NEW
        -- process, so any cached context estimate describes a session that no longer
        -- exists. AGE alone cannot catch this — the estimate can be only minutes old
        -- (well inside CONTEXT_ESTIMATE_STALE_MS) and still be the DEAD session's, so
        -- deriveContextPressure asserts a bucket from it with full confidence.
        -- Observed live: a session respawned at 4% context read 'critical' for ~12
        -- minutes, which is the cue the playbook says to self-compact on — i.e. the
        -- stale value drives a fresh context to discard itself, then respawn and read
        -- 'critical' again. Invalidate on the identity change itself: a CHANGED pid
        -- means the estimate is not about this process. NULL is the honest "unknown"
        -- deriveContextPressure already contracts for (never coerced to 'ok'), and the
        -- watchdog's next sweep refills it with this session's real usage.
        -- Guarded on EXCLUDED.pid IS NOT NULL so a caller that doesn't know its own
        -- pid never invalidates a valid estimate (same preserve-on-omission rule as
        -- touchHeartbeat's pid/host handling).
        context_tokens    = CASE
          WHEN EXCLUDED.pid IS NOT NULL
           AND EXCLUDED.pid IS DISTINCT FROM harness_shared.coord_presence.pid
            THEN NULL
          ELSE harness_shared.coord_presence.context_tokens
        END,
        context_estimated_at = CASE
          WHEN EXCLUDED.pid IS NOT NULL
           AND EXCLUDED.pid IS DISTINCT FROM harness_shared.coord_presence.pid
            THEN NULL
          ELSE harness_shared.coord_presence.context_estimated_at
        END,
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
    `}async touchHeartbeat(e,t){await this.opts.ensureSchema();const s=this.opts.getSql(),a=t?.pid,r=t?.host,c=t?.tty,l=o=>s`
               context_tokens = CASE WHEN coord_presence.pid IS DISTINCT FROM ${o}
                                     THEN NULL ELSE coord_presence.context_tokens END,
               context_estimated_at = CASE WHEN coord_presence.pid IS DISTINCT FROM ${o}
                                     THEN NULL ELSE coord_presence.context_estimated_at END`,n=[s`heartbeat_at = now()`];a!=null&&n.push(s`pid = ${a}`),r!=null&&n.push(s`host = ${r}`),c!=null&&n.push(s`tty = ${c}`),a!=null&&n.push(l(a));let _=n[0];for(let o=1;o<n.length;o++)_=s`${_}, ${n[o]}`;await s`
      UPDATE harness_shared.coord_presence
         SET ${_}
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
        ${e.workspaceId??"default"}, ${e.source}, now(), now()
      )
      ON CONFLICT (owner_id) DO UPDATE SET
        owner_label    = EXCLUDED.owner_label,
        workspace_id   = EXCLUDED.workspace_id,
        source         = EXCLUDED.source,
        heartbeat_at   = now(),
        last_active_at = now()
    `}async clear(e){await this.opts.ensureSchema(),await this.opts.getSql()`
      DELETE FROM harness_shared.coord_presence WHERE owner_id = ${e}
    `}async list(e={}){await this.opts.ensureSchema();const t=this.opts.getSql(),s=e.workspaceId??null,a=e.potSlug??null,r=await t`
      SELECT cp.owner_id, cp.owner_label, cp.workspace_id, cp.source,
             cp.intent, cp.current_plan_slug, cp.current_files,
             cp.host, cp.pid, cp.tty, cp.started_at, cp.heartbeat_at,
             cp.last_active_at, cp.intent_declared_at, cp.agent_role, cp.pot_slug, cp.capability_tags, cp.compaction_limit,
             cp.context_tokens, cp.context_estimated_at,
             pus.user_id, pus.revoked_at
        FROM harness_shared.coord_presence cp
        LEFT JOIN harness_shared.power_user_sessions pus
          ON pus.auth_session_id = cp.owner_id
       WHERE ${s==null?t`TRUE`:t`cp.workspace_id = ${s}`}
         AND ${a==null?t`TRUE`:t`cp.pot_slug = ${a}`}
       ORDER BY cp.owner_id
    `,c=Date.now();return r.map(l=>d(l,c))}async get(e){await this.opts.ensureSchema();const t=await this.opts.getSql()`
      SELECT cp.owner_id, cp.owner_label, cp.workspace_id, cp.source,
             cp.intent, cp.current_plan_slug, cp.current_files,
             cp.host, cp.pid, cp.tty, cp.started_at, cp.heartbeat_at,
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
    `).length}}})),D=i((()=>{E(),S()}));export{u as a,h as i,w as n,S as r,D as t};
