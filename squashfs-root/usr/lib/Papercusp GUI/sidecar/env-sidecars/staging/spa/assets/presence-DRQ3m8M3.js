import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{J as r,t as i}from"./src-BvZp-r10.js";import{a,i as o,t as s}from"./fleet-membership-store-CBoXFwSJ.js";import{i as c,n as l}from"./loop-DPNzgt9G.js";var u,d=e((()=>{u=600*1e3})),f=e((()=>{d()}));function p(e){if(Array.isArray(e))return e;if(typeof e==`string`)try{let t=JSON.parse(e);return Array.isArray(t)?t:[]}catch{return[]}return[]}function m(e,t){let n=p(e.current_files),r=p(e.capability_tags);return{ownerId:e.owner_id,ownerLabel:e.owner_label,workspaceId:e.workspace_id,source:e.source,intent:e.intent,currentPlanSlug:e.current_plan_slug,currentFiles:n,host:e.host,pid:e.pid,startedAt:e.started_at,heartbeatAt:e.heartbeat_at,lastActiveAt:e.last_active_at,intentDeclaredAt:e.intent_declared_at,agentRole:e.agent_role,potSlug:e.pot_slug,capabilityTags:r,compactionLimit:e.compaction_limit,contextTokens:e.context_tokens,contextEstimatedAt:e.context_estimated_at,stale:t-new Date(e.heartbeat_at).getTime()>u,userId:e.user_id,revoked:e.revoked_at!=null}}var h,g=e((()=>{f(),h=class{opts;constructor(e){this.opts=e}async write(e,t={}){await this.opts.ensureSchema(),await this.opts.getSql()`
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
    `,a=Date.now();return i.map(e=>m(e,a))}async get(e){await this.opts.ensureSchema();let t=await this.opts.getSql()`
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
    `;return t.length>0?m(t[0],Date.now()):null}async sweepStale(e){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      DELETE FROM harness_shared.coord_presence
       WHERE heartbeat_at < now() - ${`${Math.max(1,Math.floor(e/1e3))} seconds`}::interval
      RETURNING owner_id
    `).length}}})),_=e((()=>{f(),g()})),v=e((()=>{n()}));function y(e){return{ownerId:String(e.owner_id),workspaceId:String(e.workspace_id),ownerLabel:String(e.owner_label??``),source:String(e.source??``),intent:String(e.intent??``),currentPlanSlug:e.current_plan_slug??null,currentFiles:Array.isArray(e.current_files)?e.current_files:[],harnessSlug:e.harness_slug??null,potSlug:e.pot_slug??null,nativeSessionId:e.native_session_id??null,firstSeenAt:String(e.first_seen_at??``),updatedAt:String(e.updated_at??``)}}async function b(e){try{let t=r().sql;if(e.ownerId){let n=await t`
        SELECT * FROM harness_shared.session_briefs WHERE owner_id = ${e.ownerId} LIMIT 1
      `;return n[0]?y(n[0]):null}if(e.nativeSessionId){let n=await t`
        SELECT * FROM harness_shared.session_briefs
        WHERE native_session_id = ${e.nativeSessionId}
        ORDER BY updated_at DESC LIMIT 1
      `;return n[0]?y(n[0]):null}return null}catch{return null}}var x=e((()=>{i()}));function S(e){return e??r().sql}function C(e){return{workspaceId:String(e.workspace_id),ownerId:String(e.owner_id),axisKey:String(e.axis_key),mode:String(e.mode),reason:String(e.reason??``),setBy:String(e.set_by??``),ownerDirected:!!e.owner_directed,setAt:e.set_at instanceof Date?e.set_at.toISOString():String(e.set_at)}}async function w(e,t,n){return(await S(n)`
    SELECT * FROM harness_shared.agent_modes
    WHERE workspace_id = ${e} AND owner_id = ${t}
    ORDER BY axis_key`).map(C)}var T=e((()=>{i()}));function E(e){return e?e.slice(0,R):null}function D(e){let t=[...new Set(e.scope.items.map(String))].sort(),n=t.slice(0,L).map(e=>e.slice(0,R)),r=e.route.kind===`fleet`?{kind:`fleet`,fleet:e.route.fleet.slice(0,R),role:E(e.route.role)}:e.route;return{modes:[...new Set(e.modes.map(String))].sort().map(e=>e.slice(0,40)),loop:{active:!!e.loop.active,intervalSec:e.loop.intervalSec==null?null:Math.max(0,Math.floor(e.loop.intervalSec))},carry:e.carry===`cold`?`cold`:`warm`,route:r,scope:{workspace:e.scope.workspace.slice(0,R),harness:E(e.scope.harness),plan:E(e.scope.plan),items:n,...t.length>n.length?{itemsMore:t.length-n.length}:{}}}}function O(e){return Math.ceil(Buffer.byteLength(JSON.stringify(e),`utf8`)/4)}function k(e){return{origin:`system`,actorId:e,source:`control-anchor:reconcile`,ownerDirected:!1,recordedAt:new Date().toISOString()}}function A(e){let t={schemaVersion:F,generation:e.generation,state:D(e.state),provenance:{source:`harness_shared.session_briefs.control_state`,ownerId:e.ownerId,updatedAt:e.updatedAt},resync:{on:[`missing-base`,`schema-mismatch`,`generation-mismatch`],verb:`coord:orient`,args:{afterCompaction:!0},rule:`replace-full-never-merge-behind`}},n=O({...t,budget:{estimatedTokens:0,maxTokens:384}});if(n=O({...t,budget:{estimatedTokens:n,maxTokens:384}}),n>384)throw Error(`control_anchor_budget_exceeded: ${n} > 384 tokens`);return{...t,budget:{estimatedTokens:n,maxTokens:384}}}async function j(e,t=r().sql){let n=D(e.state),i=JSON.stringify(n),a={schemaVersion:I,previousGeneration:0,generation:1,state:n,provenance:{...e.transition??k(e.ownerId),recordedAt:e.transition?.recordedAt??new Date().toISOString()},resync:z},o=JSON.stringify(a),s=(await t`
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
  `)[0];if(!s)throw Error(`control_anchor_persist_returned_no_row`);return{generation:Number(s.control_generation),state:D(s.control_state),updatedAt:new Date(s.control_updated_at).toISOString(),transition:s.control_transition??null}}async function M(e,t,n={}){let i=n.sql??r().sql,[o,s,c,u,d]=await Promise.all([w(t,e,i),n.loop===void 0?l(e,{sql:i}):Promise.resolve(n.loop),a(t,e,i),b({ownerId:e}),i`
      SELECT harness_slug, plan_slug, item_id
        FROM harness_shared.plan_item_claims
       WHERE (workspace_id = ${t} OR workspace_id = 'default')
         AND owner = ${e}
         AND expires_ts > clock_timestamp()
       ORDER BY plan_slug, item_id
    `]),f=u?.currentPlanSlug?d.filter(e=>e.plan_slug===u.currentPlanSlug):d,p=f[0]??d[0]??null,m=c?.fleetSlug,h=u?.source?.toLowerCase()??``,g=m?{kind:`fleet`,fleet:m,role:c?.fleetRole??null}:h.includes(`mug`)?{kind:`mug`}:{kind:`self`};return D({modes:o.map(e=>e.mode),loop:{active:!!s?.active,intervalSec:s?.intervalSec??null},carry:s?.carry??`warm`,route:g,scope:{workspace:t,harness:u?.harnessSlug??p?.harness_slug??null,plan:u?.currentPlanSlug??p?.plan_slug??null,items:f.map(e=>e.item_id)}})}async function N(e,t,n={}){return A({ownerId:e,...await j({ownerId:e,workspaceId:t,state:await M(e,t,n),transition:n.transition},n.sql??r().sql)})}async function P(e){try{return await N(e.ownerId,e.workspaceId,{sql:e.sql,transition:{origin:e.origin,actorId:e.actorId,source:e.source,ownerDirected:!!e.ownerDirected}})}catch{return null}}var F,I,L,R,z,B=e((()=>{i(),T(),c(),o(),x(),F=`ctrl-v1`,I=`ctrl-transition-v1`,L=12,R=120,z={verb:`coord:orient`,args:{afterCompaction:!0},rule:`replace-full-never-merge-behind`}}));async function V(e,t,n,r,i){await s({workspaceId:e,ownerId:t,fleetSlug:n,fleetRole:r},i),await P({ownerId:t,workspaceId:e,origin:`agent`,actorId:t,source:`fleet:membership`,sql:i})}function H(e){if(!e.pid||!e.host||e.host!==Z)return null;try{return process.kill(e.pid,0),!0}catch(e){return e?.code===`ESRCH`?!1:null}}async function U(e){await X.touchActivity(e)}async function W(e,t){await X.setCompactionLimit(e,t)}async function G(e,t){await X.setContextEstimate(e,t)}async function K(e){await X.heartbeat(e)}async function q(e={}){return X.list(e)}async function J(e){return X.get(e)}var Y,X,Z,Q=e((()=>{Y=t(n(),1),i(),_(),v(),x(),o(),B(),X=new h({getSql:()=>r().sql,ensureSchema:async()=>{}}),Z=(0,Y.hostname)()}));export{H as a,V as c,u as d,d as f,q as i,U as l,K as n,W as o,Q as r,G as s,J as t,_ as u};