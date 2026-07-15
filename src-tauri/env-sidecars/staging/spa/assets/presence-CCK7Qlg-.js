import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{J as r,t as i}from"./src-C4H77EbW.js";import{a,i as o,t as s}from"./fleet-membership-store-BDt16a06.js";import{n as c,t as l}from"./store-D0vO-4u5.js";import{i as u,n as d}from"./loop-B4UipG2-.js";var f,p=e((()=>{f=600*1e3})),m=e((()=>{p()}));function h(e){if(Array.isArray(e))return e;if(typeof e==`string`)try{let t=JSON.parse(e);return Array.isArray(t)?t:[]}catch{return[]}return[]}function g(e,t){let n=h(e.current_files),r=h(e.capability_tags);return{ownerId:e.owner_id,ownerLabel:e.owner_label,workspaceId:e.workspace_id,source:e.source,intent:e.intent,currentPlanSlug:e.current_plan_slug,currentFiles:n,host:e.host,pid:e.pid,startedAt:e.started_at,heartbeatAt:e.heartbeat_at,lastActiveAt:e.last_active_at,intentDeclaredAt:e.intent_declared_at,agentRole:e.agent_role,potSlug:e.pot_slug,capabilityTags:r,compactionLimit:e.compaction_limit,contextTokens:e.context_tokens,contextEstimatedAt:e.context_estimated_at,stale:t-new Date(e.heartbeat_at).getTime()>f,userId:e.user_id,revoked:e.revoked_at!=null}}var _,v=e((()=>{m(),_=class{opts;constructor(e){this.opts=e}async write(e,t={}){await this.opts.ensureSchema(),await this.opts.getSql()`
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
    `,a=Date.now();return i.map(e=>g(e,a))}async get(e){await this.opts.ensureSchema();let t=await this.opts.getSql()`
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
    `;return t.length>0?g(t[0],Date.now()):null}async sweepStale(e){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      DELETE FROM harness_shared.coord_presence
       WHERE heartbeat_at < now() - ${`${Math.max(1,Math.floor(e/1e3))} seconds`}::interval
      RETURNING owner_id
    `).length}}})),y=e((()=>{m(),v()})),b=e((()=>{n()}));function x(e){return{ownerId:String(e.owner_id),workspaceId:String(e.workspace_id),ownerLabel:String(e.owner_label??``),source:String(e.source??``),intent:String(e.intent??``),currentPlanSlug:e.current_plan_slug??null,currentFiles:Array.isArray(e.current_files)?e.current_files:[],harnessSlug:e.harness_slug??null,potSlug:e.pot_slug??null,nativeSessionId:e.native_session_id??null,firstSeenAt:String(e.first_seen_at??``),updatedAt:String(e.updated_at??``)}}async function S(e){try{let t=r().sql;if(e.ownerId){let n=await t`
        SELECT * FROM harness_shared.session_briefs WHERE owner_id = ${e.ownerId} LIMIT 1
      `;return n[0]?x(n[0]):null}if(e.nativeSessionId){let n=await t`
        SELECT * FROM harness_shared.session_briefs
        WHERE native_session_id = ${e.nativeSessionId}
        ORDER BY updated_at DESC LIMIT 1
      `;return n[0]?x(n[0]):null}return null}catch{return null}}var C=e((()=>{i()}));function w(e){return e?e.slice(0,I):null}function T(e){let t=[...new Set(e.scope.items.map(String))].sort(),n=t.slice(0,F).map(e=>e.slice(0,I)),r=e.route.kind===`fleet`?{kind:`fleet`,fleet:e.route.fleet.slice(0,I),role:w(e.route.role)}:e.route;return{modes:[...new Set(e.modes.map(String))].sort().map(e=>e.slice(0,40)),loop:{active:!!e.loop.active,intervalSec:e.loop.intervalSec==null?null:Math.max(0,Math.floor(e.loop.intervalSec))},carry:e.carry===`cold`?`cold`:`warm`,route:r,scope:{workspace:e.scope.workspace.slice(0,I),harness:w(e.scope.harness),plan:w(e.scope.plan),items:n,...t.length>n.length?{itemsMore:t.length-n.length}:{}}}}function E(e){return Math.ceil(Buffer.byteLength(JSON.stringify(e),`utf8`)/4)}function D(e){return{origin:`system`,actorId:e,source:`control-anchor:reconcile`,ownerDirected:!1,recordedAt:new Date().toISOString()}}function O(e){let t={schemaVersion:N,generation:e.generation,state:T(e.state),provenance:{source:`harness_shared.session_briefs.control_state`,ownerId:e.ownerId,updatedAt:e.updatedAt},resync:{on:[`missing-base`,`schema-mismatch`,`generation-mismatch`],verb:`coord:orient`,args:{afterCompaction:!0},rule:`replace-full-never-merge-behind`}},n=E({...t,budget:{estimatedTokens:0,maxTokens:384}});if(n=E({...t,budget:{estimatedTokens:n,maxTokens:384}}),n>384)throw Error(`control_anchor_budget_exceeded: ${n} > 384 tokens`);return{...t,budget:{estimatedTokens:n,maxTokens:384}}}async function k(e,t=r().sql){let n=T(e.state),i=JSON.stringify(n),a={schemaVersion:P,previousGeneration:0,generation:1,state:n,provenance:{...e.transition??D(e.ownerId),recordedAt:e.transition?.recordedAt??new Date().toISOString()},resync:L},o=JSON.stringify(a),s=(await t`
    INSERT INTO harness_shared.session_briefs
      (owner_id, workspace_id, control_generation, control_state, control_updated_at, control_transition)
    VALUES (${e.ownerId}, ${e.workspaceId}, 1, ${i}::text::jsonb, now(), ${o}::text::jsonb)
    ON CONFLICT (owner_id) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      control_transition = CASE
        WHEN harness_shared.session_briefs.control_state IS DISTINCT FROM EXCLUDED.control_state
          THEN jsonb_set(
            jsonb_set(EXCLUDED.control_transition, '{previousGeneration}', to_jsonb(harness_shared.session_briefs.control_generation), true),
            '{generation}', to_jsonb(harness_shared.session_briefs.control_generation + 1), true
          )
        ELSE harness_shared.session_briefs.control_transition
      END,
      control_generation = CASE
        WHEN harness_shared.session_briefs.control_state IS DISTINCT FROM EXCLUDED.control_state
          THEN harness_shared.session_briefs.control_generation + 1
        ELSE harness_shared.session_briefs.control_generation
      END,
      control_updated_at = CASE
        WHEN harness_shared.session_briefs.control_state IS DISTINCT FROM EXCLUDED.control_state
          THEN now()
        ELSE harness_shared.session_briefs.control_updated_at
      END,
      control_state = EXCLUDED.control_state
    RETURNING control_generation, control_state, control_updated_at, control_transition
  `)[0];if(!s)throw Error(`control_anchor_persist_returned_no_row`);return{generation:Number(s.control_generation),state:T(s.control_state),updatedAt:new Date(s.control_updated_at).toISOString(),transition:s.control_transition??null}}async function A(e,t,n={}){let i=n.sql??r().sql,[o,s,c,u,f]=await Promise.all([l(t,e,i),n.loop===void 0?d(e,{sql:i}):Promise.resolve(n.loop),a(t,e,i),S({ownerId:e}),i`
      SELECT harness_slug, plan_slug, item_id
        FROM harness_shared.plan_item_claims
       WHERE (workspace_id = ${t} OR workspace_id = 'default')
         AND owner = ${e}
         AND expires_ts > clock_timestamp()
       ORDER BY plan_slug, item_id
    `]),p=u?.currentPlanSlug?f.filter(e=>e.plan_slug===u.currentPlanSlug):f,m=p[0]??f[0]??null,h=c?.fleetSlug,g=u?.source?.toLowerCase()??``,_=h?{kind:`fleet`,fleet:h,role:c?.fleetRole??null}:g.includes(`mug`)?{kind:`mug`}:{kind:`self`};return T({modes:o.map(e=>e.mode),loop:{active:!!s?.active,intervalSec:s?.intervalSec??null},carry:s?.carry??`warm`,route:_,scope:{workspace:t,harness:u?.harnessSlug??m?.harness_slug??null,plan:u?.currentPlanSlug??m?.plan_slug??null,items:p.map(e=>e.item_id)}})}async function j(e,t,n={}){return O({ownerId:e,...await k({ownerId:e,workspaceId:t,state:await A(e,t,n),transition:n.transition},n.sql??r().sql)})}async function M(e){try{return await j(e.ownerId,e.workspaceId,{sql:e.sql,transition:{origin:e.origin,actorId:e.actorId,source:e.source,ownerDirected:!!e.ownerDirected}})}catch{return null}}var N,P,F,I,L,R=e((()=>{i(),c(),u(),o(),C(),N=`ctrl-v1`,P=`ctrl-transition-v1`,F=12,I=120,L={verb:`coord:orient`,args:{afterCompaction:!0},rule:`replace-full-never-merge-behind`}}));async function z(e,t,n,r,i){await s({workspaceId:e,ownerId:t,fleetSlug:n,fleetRole:r},i),await M({ownerId:t,workspaceId:e,origin:`agent`,actorId:t,source:`fleet:membership`,sql:i})}function B(e){if(!e.pid||!e.host||e.host!==Y)return null;try{return process.kill(e.pid,0),!0}catch(e){return e?.code===`ESRCH`?!1:null}}async function V(e){await J.touchActivity(e)}async function H(e,t){await J.setCompactionLimit(e,t)}async function U(e,t){await J.setContextEstimate(e,t)}async function W(e){await J.heartbeat(e)}async function G(e={}){return J.list(e)}async function K(e){return J.get(e)}var q,J,Y,X=e((()=>{q=t(n(),1),i(),y(),b(),C(),o(),R(),J=new _({getSql:()=>r().sql,ensureSchema:async()=>{}}),Y=(0,q.hostname)()}));export{B as a,z as c,f as d,p as f,G as i,V as l,W as n,H as o,X as r,U as s,K as t,y as u};