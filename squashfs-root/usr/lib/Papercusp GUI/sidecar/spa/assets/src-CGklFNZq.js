import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{n,t as r}from"./postgres-browser-zd-i1BMX.js";import{t as i}from"./__vite-browser-external-CM3Eme-n.js";import{t as a}from"./src-CRdNHN4C.js";function o(e){u=e}function s(){if(!u)throw Error(`@papercusp/locks: configureLocks() must be called before using the locks API`);return u}function c(){let e=u;if(!e?.getTxnTimeouts)return l;try{let t=e.getTxnTimeouts();return{lockTimeoutMs:Number.isFinite(t?.lockTimeoutMs)?t.lockTimeoutMs:l.lockTimeoutMs,statementTimeoutMs:Number.isFinite(t?.statementTimeoutMs)?t.statementTimeoutMs:l.statementTimeoutMs}}catch{return l}}var l,u,d=e((()=>{l={lockTimeoutMs:5e3,statementTimeoutMs:5e3},u=null}));function f(e){if(!e||e===``)throw new h(e,`empty`);if(e.startsWith(`/`))throw new h(e,`absolute`);if(e===`..`||e.startsWith(`../`)||e.endsWith(`/..`)||e.includes(`/../`))throw new h(e,`traversal`);if(e.includes(`\\`))throw new h(e,`backslash`);if(e.length>4096)throw new h(e,`too long`);if(e.includes(`\0`))throw new h(e,`null byte`)}function p(e){return e.split(`/`).filter(e=>e!==``&&e!==`.`).join(`/`)}function m(e){for(let t of e)f(t);let t=e.map((t,n)=>{let r=p(t);if(r===``)throw new h(e[n],`empty after canonicalization`);return r});return Array.from(new Set(t)).sort()}var h,g,ee=e((()=>{h=class extends Error{constructor(e,t){super(`InvalidPathError: ${t}: ${e}`),this.name=`InvalidPathError`}},g=4096}));function _(){return s().getAdminBaseUrl().replace(/\/[^/?]+(\?|$)/,`/papercusp_su$1`)}function te(){return s().getAdminBaseUrl()}function v(){return O||=n(_(),{max:10,prepare:!1}),O}function y(){return k||=n(_(),{max:20,prepare:!1}),k}async function b(){if(A)return;let e=n(te(),{max:1,prepare:!1});try{(await e`
      SELECT EXISTS(
        SELECT 1 FROM pg_database WHERE datname = 'papercusp_su'
      ) AS exists
    `)[0]?.exists||(await e.unsafe(`CREATE DATABASE papercusp_su`).simple(),await e.unsafe(`ALTER DATABASE papercusp_su SET idle_in_transaction_session_timeout = '30s'`).simple(),await e.unsafe(`ALTER DATABASE papercusp_su SET application_name = 'papercusp-su'`).simple())}finally{await e.end({timeout:1})}let t=v();await t`
    CREATE TABLE IF NOT EXISTS su_meta (
      key   text PRIMARY KEY,
      value text NOT NULL
    )
  `,await t.begin(async e=>{await e`LOCK TABLE su_meta IN SHARE UPDATE EXCLUSIVE MODE`;let t=await e`
      SELECT key FROM su_meta WHERE key LIKE 'migration:%'
    `,n=new Set(t.map(e=>e.key)),r=T.readdirSync(j).filter(e=>/^\d{3}-.*\.sql$/.test(e)).filter(e=>!e.endsWith(`-bootstrap.sql`)).sort();for(let t of r){let r=`migration:${t}`;if(n.has(r))continue;let i=T.readFileSync(E.join(j,t),`utf8`);await e.unsafe(i),await e`
        INSERT INTO su_meta (key, value) VALUES (${r}, ${new Date().toISOString()})
        ON CONFLICT (key) DO NOTHING
      `}}),A=!0}async function x(e,t){let n=await e`
    DELETE FROM agent_file_locks
     WHERE coordination_domain = ${t}
       AND expires_ts <= clock_timestamp()
    RETURNING path
  `,r=await e`
    UPDATE agent_lock_waiters
       SET status = 'expired'
     WHERE coordination_domain = ${t}
       AND status = 'waiting'
       AND wait_until <= clock_timestamp()
    RETURNING ticket_id
  `;return n.length>0||r.length>0}async function ne(e,t,n){if(n.length===0)return!1;let r=await e`
    DELETE FROM agent_file_locks
     WHERE coordination_domain = ${t}
       AND path = ANY(${n}::text[])
       AND expires_ts <= clock_timestamp()
    RETURNING path
  `,i=await e`
    UPDATE agent_lock_waiters
       SET status = 'expired'
     WHERE coordination_domain = ${t}
       AND status = 'waiting'
       AND wait_until <= clock_timestamp()
       AND paths && ${n}::text[]
    RETURNING ticket_id
  `;return r.length>0||i.length>0}async function S(){await b();let e=v(),t=await e`
    SELECT coordination_domain FROM agent_file_locks
      WHERE expires_ts <= clock_timestamp()
    UNION
    SELECT coordination_domain FROM agent_lock_waiters
      WHERE status = 'waiting' AND wait_until <= clock_timestamp()
  `;for(let{coordination_domain:n}of t)try{await e.begin(async e=>{let t=e;await t`SET LOCAL statement_timeout = '2s'`,(await t`
          SELECT pg_try_advisory_xact_lock(
            ${101}::int,
            hashtext(${`su:`+n})
          ) AS locked
        `)[0]?.locked&&await x(t,n)&&await t`SELECT grant_cascade(${n}, clock_timestamp())`})}catch(e){console.error(`[su-locks] background janitor: workspace ${n} sweep failed`,e)}try{await e.begin(async e=>{let t=e;await t`SET LOCAL statement_timeout = '5s'`,await t`
        DELETE FROM agent_lock_waiters
         WHERE status IN ('granted','expired','cancelled')
           AND queued_ts < clock_timestamp() - interval '24 hours'
      `})}catch(e){console.error(`[su-locks] background janitor: terminal-waiter GC failed`,e)}}async function C(e,t){let{coordinationDomain:n,owner:r,ownerLabel:i,paths:a,intent:o,ttlSec:s}=t;if(a.length===0)return{ok:!0,lock_id:crypto.randomUUID(),expires_ts:new Date,held:[]};await e`SET LOCAL statement_timeout = '500ms'`,await ne(e,n,a)&&await e`SELECT grant_cascade(${n}, clock_timestamp())`;let c=await e`
    SELECT path, lock_id::text AS lock_id FROM agent_file_locks
     WHERE coordination_domain = ${n}
       AND owner = ${r}
       AND path = ANY(${a}::text[])
       AND expires_ts > clock_timestamp()
  `,l=new Set(c.map(e=>e.path)),u=a.filter(e=>!l.has(e)),d=Array.from(new Set(c.map(e=>e.lock_id)))[0];if((u.length===0?[]:await e`
        SELECT TRUE AS blocked FROM agent_lock_waiters
         WHERE coordination_domain = ${n}
           AND status = 'waiting'
           -- A waiter whose wait_until has elapsed is effectively dead
           -- (crashed agent / timed-out wait) and must not block a new
           -- acquire even if the janitor hasn't swept it yet
           -- (file-locking #4 — robust regardless of sweep timing).
           AND wait_until > clock_timestamp()
           AND paths && ${u}::text[]
           AND queued_ts < clock_timestamp()
         LIMIT 1
      `).length>0||u.length>0&&(await e`
      SELECT path FROM agent_file_locks
       WHERE coordination_domain = ${n}
         AND path = ANY(${u}::text[])
         AND expires_ts > clock_timestamp()
         AND owner != ${r}
    `).length>0)return{ok:!1,busy:await w(e,n,a,r)};let f=await e`
    WITH wanted AS (SELECT unnest(${a}::text[]) AS path)
    INSERT INTO agent_file_locks
      (coordination_domain, path, owner, owner_label, intent, lock_id, acquired_ts, expires_ts)
    SELECT
      ${n}, w.path, ${r}, ${i}, ${o},
      ${d??crypto.randomUUID()}::uuid, clock_timestamp(), clock_timestamp() + ${`${s} seconds`}::interval
    FROM wanted w
    ON CONFLICT (coordination_domain, path) DO UPDATE
      SET owner       = EXCLUDED.owner,
          owner_label = EXCLUDED.owner_label,
          intent      = EXCLUDED.intent,
          lock_id     = EXCLUDED.lock_id,
          acquired_ts = clock_timestamp(),
          expires_ts  = EXCLUDED.expires_ts
      -- Refresh on two conditions:
      --   1. Expired locks (anyone can steal a stale row).
      --   2. Same-owner re-acquire (consecutive edits to the same
      --      file must not lock the agent out of itself).
      WHERE agent_file_locks.expires_ts <= clock_timestamp()
         OR agent_file_locks.owner = EXCLUDED.owner
    RETURNING path, lock_id
  `;return f.length===a.length?{ok:!0,lock_id:f[0].lock_id,expires_ts:new Date(Date.now()+s*1e3),held:a}:{ok:!1,busy:await w(e,n,a,r)}}async function w(e,t,n,r){return await e`
    SELECT path, owner, owner_label, intent, expires_ts
      FROM agent_file_locks
     WHERE coordination_domain = ${t}
       AND path = ANY(${n}::text[])
       AND expires_ts > clock_timestamp()
       ${r?e`AND owner != ${r}`:e``}
  `}async function re(e,t){let{coordinationDomain:n,owner:r,lockId:i,paths:a,allMine:o}=t;await e`SET LOCAL statement_timeout = '5s'`,await x(e,n);let s;if(o)s=await e`
      DELETE FROM agent_file_locks
       WHERE coordination_domain = ${n}
         AND owner = ${r}
      RETURNING path
    `;else if(i&&a&&a.length>0)s=await e`
      DELETE FROM agent_file_locks
       WHERE coordination_domain = ${n}
         AND lock_id = ${i}::uuid
         AND owner = ${r}
         AND path = ANY(${a}::text[])
      RETURNING path
    `;else if(i)s=await e`
      DELETE FROM agent_file_locks
       WHERE coordination_domain = ${n}
         AND lock_id = ${i}::uuid
         AND owner = ${r}
      RETURNING path
    `;else throw Error(`locks:release requires lock_id or all_mine`);return await e`SELECT grant_cascade(${n}, clock_timestamp())`,{released:s.map(e=>e.path)}}async function ie(e,t,n,r,i){await e`SET LOCAL statement_timeout = '500ms'`,await x(e,t)&&await e`SELECT grant_cascade(${t}, clock_timestamp())`;let a=await e`
    UPDATE agent_file_locks
       SET expires_ts = clock_timestamp() + ${`${i} seconds`}::interval
     WHERE coordination_domain = ${t}
       AND lock_id = ${r}::uuid
       AND owner = ${n}
       AND expires_ts > clock_timestamp()
     RETURNING expires_ts
  `;return a.length===0?{expires_ts:null,extended:!1}:{expires_ts:a[0].expires_ts,extended:!0}}async function ae(e,t){return e.begin(async e=>(await e`SET LOCAL statement_timeout = '1s'`,oe(e,t)))}async function oe(e,t){let{coordinationDomain:n,paths:r,owner:i,includeCompleted:a}=t,o=r&&r.length>0?e`AND path = ANY(${r}::text[])`:e``,s=i?e`AND owner = ${i}`:e``,c=await e`
    SELECT path, owner, owner_label, intent, acquired_ts, expires_ts
      FROM agent_file_locks
     WHERE coordination_domain = ${n}
       AND expires_ts > clock_timestamp()
       ${o}
       ${s}
     ORDER BY acquired_ts ASC
  `,l=r&&r.length>0?e`AND paths && ${r}::text[]`:e``,u={active_locks:c,waiting:await e`
    SELECT ticket_id, owner, owner_label, paths, intent, queued_ts, wait_until,
           status::text AS status,
           (ROW_NUMBER() OVER (ORDER BY queued_ts ASC, ticket_id ASC) - 1)::int AS ahead_count
      FROM agent_lock_waiters
     WHERE coordination_domain = ${n}
       AND status = 'waiting'
       ${l}
       ${s}
     ORDER BY queued_ts ASC, ticket_id ASC
  `};return a&&(u.completed=await e`
      SELECT ticket_id, owner, owner_label, paths, intent, queued_ts, wait_until,
             status::text AS status
        FROM agent_lock_waiters
       WHERE coordination_domain = ${n}
         AND status IN ('granted','expired','cancelled')
         AND queued_ts > clock_timestamp() - interval '24 hours'
         ${l}
         ${s}
       ORDER BY queued_ts DESC
       LIMIT 50
    `),u}var T,E,D,O,k,A,j,M=e((()=>{T=t(i(),1),E=t(i(),1),D=t(i(),1),r(),d(),ee(),O=null,k=null,A=!1,j=E.join(E.dirname((0,D.fileURLToPath)(import.meta.url)),`sql`)}));async function se(e,t,n){return e`
    SELECT owner, owner_label, mode, status, lock_id::text AS lock_id, reason,
           acquired_ts, expires_ts, fence_seq::int AS fence_seq
      FROM agent_resource_locks
     WHERE coordination_domain = ${t}
       AND resource = ${n}
       AND expires_ts > clock_timestamp()
     ORDER BY acquired_ts ASC
  `}async function N(e,t){let n=await e`
    DELETE FROM agent_resource_locks
     WHERE coordination_domain = ${t}
       AND expires_ts <= clock_timestamp()
    RETURNING resource
  `;return await e`
    DELETE FROM agent_resource_waiters
     WHERE coordination_domain = ${t}
       AND expires_ts <= clock_timestamp()
  `,n.length>0}async function P(e,t){let{coordinationDomain:n,resource:r,owner:i,ownerLabel:a}=t;await e`
    INSERT INTO agent_resource_waiters (coordination_domain, resource, owner, owner_label, expires_ts)
    VALUES (${n}, ${r}, ${i}, ${a}, clock_timestamp() + ${`${L} seconds`}::interval)
    ON CONFLICT (coordination_domain, resource, owner) DO UPDATE
      SET owner_label = EXCLUDED.owner_label,
          queued_ts   = clock_timestamp(),
          expires_ts  = EXCLUDED.expires_ts
  `}async function F(e,t,n,r){await e`
    DELETE FROM agent_resource_waiters
     WHERE coordination_domain = ${t} AND resource = ${n} AND owner = ${r}
  `}async function I(e,t,n){let r=await e`
    DELETE FROM agent_resource_waiters
     WHERE coordination_domain = ${t}
       AND resource = ${n}
       AND expires_ts > clock_timestamp()
    RETURNING owner
  `;return[...new Set(r.map(e=>e.owner))]}async function ce(e,t){await e`SET LOCAL statement_timeout = '500ms'`,await N(e,t),await e`SELECT resource_grant_cascade(${t}, clock_timestamp())`}async function le(e,t){let{coordinationDomain:n,resource:r,mode:i,owner:a,ownerLabel:o,reason:s,ttlSec:c}=t;await e`SET LOCAL statement_timeout = '500ms'`;let l=await e`
    SELECT max_holders FROM agent_resource_registry WHERE resource = ${r} LIMIT 1
  `;if(l.length===0)return{ok:!1,reason:`unknown_resource`,holders:[]};let u=l[0].max_holders;await N(e,n)&&await e`SELECT resource_grant_cascade(${n}, clock_timestamp())`;let d=await se(e,n,r),f=`${c} seconds`;if(i===`shared`){let t=d.find(e=>e.mode===`exclusive`);if(t&&t.owner!==a)return await P(e,{coordinationDomain:n,resource:r,owner:a,ownerLabel:o}),{ok:!1,reason:`exclusive_pending`,holders:d};if(u!=null){let t=d.some(e=>e.owner===a&&e.mode===`shared`),i=d.filter(e=>e.mode===`shared`&&e.owner!==a).length;if(!t&&i>=u)return await P(e,{coordinationDomain:n,resource:r,owner:a,ownerLabel:o}),{ok:!1,reason:`at_capacity`,holders:d}}let i=await e`
      INSERT INTO agent_resource_locks
        (coordination_domain, resource, owner, owner_label, mode, status, reason, expires_ts)
      VALUES
        (${n}, ${r}, ${a}, ${o}, 'shared', 'held', ${s},
         clock_timestamp() + ${f}::interval)
      ON CONFLICT (coordination_domain, resource, owner) DO UPDATE
        SET owner_label = EXCLUDED.owner_label,
            reason      = EXCLUDED.reason,
            mode        = 'shared',
            status      = 'held',
            acquired_ts = clock_timestamp(),
            expires_ts  = EXCLUDED.expires_ts
        WHERE agent_resource_locks.mode = 'shared'
      RETURNING lock_id::text AS lock_id, expires_ts
    `;return i.length===0?{ok:!1,reason:`held_exclusive`,holders:d}:(await F(e,n,r,a),{ok:!0,mode:`shared`,status:`held`,lock_id:i[0].lock_id,expires_ts:i[0].expires_ts,shared_holders:d.filter(e=>e.mode===`shared`),fence_seq:0})}if(d.some(e=>e.owner===a&&e.mode===`shared`))return{ok:!1,reason:`holds_shared`,holders:d};if(d.some(e=>e.mode===`exclusive`&&e.owner!==a))return await P(e,{coordinationDomain:n,resource:r,owner:a,ownerLabel:o}),{ok:!1,reason:`held_exclusive`,holders:d};let p=d.filter(e=>e.mode===`shared`),m=p.length===0?`held`:`draining`,h=await e`
    INSERT INTO agent_resource_locks
      (coordination_domain, resource, owner, owner_label, mode, status, reason, expires_ts)
    VALUES
      (${n}, ${r}, ${a}, ${o}, 'exclusive', ${m}, ${s},
       clock_timestamp() + ${f}::interval)
    ON CONFLICT (coordination_domain, resource, owner) DO UPDATE
      SET owner_label = EXCLUDED.owner_label,
          reason      = EXCLUDED.reason,
          mode        = 'exclusive',
          status      = ${m},
          acquired_ts = clock_timestamp(),
          expires_ts  = EXCLUDED.expires_ts
    RETURNING lock_id::text AS lock_id, expires_ts, status
  `,g=0;return h[0].status===`held`&&(g=(await e`
      UPDATE agent_resource_locks
         SET fence_seq = resource_assign_fence(${n}, ${r})
       WHERE coordination_domain = ${n} AND resource = ${r}
         AND owner = ${a} AND mode = 'exclusive'
      RETURNING fence_seq::int AS fence_seq
    `)[0]?.fence_seq??0),await F(e,n,r,a),{ok:!0,mode:`exclusive`,status:h[0].status,lock_id:h[0].lock_id,expires_ts:h[0].expires_ts,shared_holders:p,fence_seq:g}}async function ue(e,t){let{coordinationDomain:n,owner:r,lockId:i,resource:a}=t;await e`SET LOCAL statement_timeout = '5s'`,await N(e,n);let o;if(i)o=await e`
      DELETE FROM agent_resource_locks
       WHERE coordination_domain = ${n} AND lock_id = ${i}::uuid AND owner = ${r}
      RETURNING mode, resource
    `;else if(a)o=await e`
      DELETE FROM agent_resource_locks
       WHERE coordination_domain = ${n} AND resource = ${a} AND owner = ${r}
      RETURNING mode, resource
    `;else throw Error(`tryReleaseResource requires lockId or resource`);await e`SELECT resource_grant_cascade(${n}, clock_timestamp())`;let s=[...new Set(o.filter(e=>e.mode===`exclusive`).map(e=>e.resource))],c={};for(let t of s)c[t]=await I(e,n,t);return{released:o.length,releasedModes:o.map(e=>e.mode),exclusiveResources:s,waiters:c}}async function de(e,t,n){await e`SET LOCAL statement_timeout = '5s'`;let r=await e`
    DELETE FROM agent_resource_locks
     WHERE coordination_domain = ${t} AND owner = ${n}
    RETURNING mode, resource
  `;await e`DELETE FROM agent_resource_waiters WHERE coordination_domain = ${t} AND owner = ${n}`,await e`SELECT resource_grant_cascade(${t}, clock_timestamp())`;let i=[...new Set(r.filter(e=>e.mode===`exclusive`).map(e=>e.resource))],a={};for(let n of i)a[n]=await I(e,t,n);return{released:r.length,exclusiveResources:i,waiters:a}}async function fe(e,t){let n=await e`
    SELECT status, mode, resource, expires_ts, fence_seq::int AS fence_seq
      FROM agent_resource_locks
     WHERE lock_id = ${t}::uuid
       AND expires_ts > clock_timestamp()
     LIMIT 1
  `;return n.length===0?{status:`missing`}:{status:n[0].status,mode:n[0].mode,resource:n[0].resource,expires_ts:n[0].expires_ts,fence_seq:n[0].fence_seq}}async function pe(e,t){let{coordinationDomain:n,resource:r}=t,i=r?await e`
        SELECT owner, owner_label, mode, status, lock_id::text AS lock_id, reason,
               acquired_ts, expires_ts, fence_seq::int AS fence_seq
          FROM agent_resource_locks
         WHERE coordination_domain = ${n}
           AND resource = ${r}
           AND expires_ts > clock_timestamp()
         ORDER BY acquired_ts ASC
      `:await e`
        SELECT owner, owner_label, mode, status, lock_id::text AS lock_id, reason,
               acquired_ts, expires_ts, fence_seq::int AS fence_seq
          FROM agent_resource_locks
         WHERE coordination_domain = ${n}
           AND expires_ts > clock_timestamp()
         ORDER BY acquired_ts ASC
      `;return{holders:i,draining:i.some(e=>e.mode===`exclusive`&&e.status===`draining`)}}async function me(e,t){let{coordinationDomain:n,resource:r,lockId:i,fenceSeq:a}=t,o=await e`
    SELECT lock_id::text AS lock_id, fence_seq::int AS fence_seq
      FROM agent_resource_locks
     WHERE coordination_domain = ${n}
       AND resource = ${r}
       AND mode = 'exclusive'
       AND status = 'held'
       AND expires_ts > clock_timestamp()
     LIMIT 1
  `;if(o.length===0)return{current:!1,reason:`expired_or_released`};let s=o[0];return s.lock_id!==i||s.fence_seq<a?{current:!1,reason:`superseded`,live_fence_seq:s.fence_seq}:{current:!0,live_fence_seq:s.fence_seq}}var L,R=e((()=>{L=1800})),z=e((()=>{a()}));function B(e){return`ch_coord_${(0,H.createHash)(`md5`).update(e).digest(`hex`)}`}async function he(e,t){let n=W.get(e);if(!n){if(W.size>=U)throw new G;let t=y(),r=B(e),i=new Set;n={unlisten:(await t.listen(r,e=>{let t=e.indexOf(`:`),n=t>=0?e.slice(0,t):e,r=t>=0?e.slice(t+1):`granted`;for(let e of i)try{e(n,r)}catch{}})).unlisten,listeners:i},W.set(e,n)}return n.listeners.add(t),async()=>{let n=W.get(e);if(n&&(n.listeners.delete(t),n.listeners.size===0)){W.delete(e);try{await n.unlisten()}catch{}}}}function V(){q||(q=setInterval(()=>{J||(J=!0,S().catch(e=>console.error(`[su-locks] background janitor pass failed`,e)).finally(()=>{J=!1}))},K),q.unref?.())}var H,U,W,G,K,q,J,Y=e((()=>{H=t(i(),1),M(),U=20,W=new Map,G=class extends Error{constructor(){super(`too_many_active_workspaces`),this.name=`TooManyActiveWorkspacesError`}},K=3e4,q=null,J=!1}));function ge(){return!!{}.VITEST||!1}async function X(e,t,n){await b(),ge()||V();let r=v(),i;try{i=await r.begin(async r=>{await r`SELECT set_config('application_name', ${`papercusp-su:`+t}, true)`;let{lockTimeoutMs:i,statementTimeoutMs:a}=c();return await r`SELECT set_config('lock_timeout', ${`${Math.trunc(i)}ms`}, true)`,await r`SELECT set_config('statement_timeout', ${`${Math.trunc(a)}ms`}, true)`,await r`SELECT pg_advisory_xact_lock(
      ${101}::int,
      hashtext(${`su:`+e})
    )`,n(r)})}catch(t){let n=t?.code;throw typeof n==`string`&&_e.has(n)?new Z(e,n,t):t}return i}var Z,_e,Q=e((()=>{M(),Y(),d(),Z=class extends Error{coordinationDomain;pgCode;constructor(e,t,n){super(`workspace "${e}" contended (pg ${t}: lock/statement timeout)`),this.name=`WorkspaceContendedError`,this.coordinationDomain=e,this.pgCode=t,this.cause=n}},_e=new Set([`55P03`,`57014`])}));function ve(e){return{path:e.path,owner:e.owner,ownerLabel:e.owner_label,intent:e.intent,expiresAt:e.expires_ts}}var $,ye,be=e((()=>{Q(),M(),$=1200,ye=class{coordinationDomain;constructor(e){this.coordinationDomain=e.coordinationDomain}async acquire(e,t,n={}){let r=n.ttlMs?Math.max(1,Math.round(n.ttlMs/1e3)):$;return X(this.coordinationDomain,e,async i=>{let a=await C(i,{coordinationDomain:this.coordinationDomain,owner:e,ownerLabel:n.ownerLabel??null,paths:[...t],intent:n.intent??`file-claim`,ttlSec:r});return a.ok?{ok:!0,claim:{claimId:a.lock_id,owner:e,paths:[...a.held],expiresAt:a.expires_ts}}:{ok:!1,busy:a.busy.map(ve)}})}async release(e){await X(this.coordinationDomain,e.owner,async t=>{await re(t,{coordinationDomain:this.coordinationDomain,owner:e.owner,lockId:e.claimId})})}async extend(e,t){let n=t.addPaths??[],r=t.ttlMs?Math.max(1,Math.round(t.ttlMs/1e3)):$,i=Array.from(new Set([...e.paths,...n]));return X(this.coordinationDomain,e.owner,async t=>{let n=await C(t,{coordinationDomain:this.coordinationDomain,owner:e.owner,ownerLabel:null,paths:i,intent:`file-claim:extend`,ttlSec:r});return n.ok?{ok:!0,claim:{claimId:n.lock_id,owner:e.owner,paths:[...n.held],expiresAt:n.expires_ts}}:{ok:!1,busy:n.busy.map(ve)}})}async heartbeat(e,t){let n=t?Math.max(1,Math.round(t/1e3)):$;return X(this.coordinationDomain,e.owner,async t=>{let r=await ie(t,this.coordinationDomain,e.owner,e.claimId,n);return r.extended?{ok:!0,claim:{claimId:e.claimId,owner:e.owner,paths:[...e.paths],expiresAt:r.expires_ts}}:{ok:!1,expired:!0}})}async reap(e){return X(this.coordinationDomain,e,async t=>{let n=await t`
        WITH d AS (
          DELETE FROM agent_file_locks
           WHERE coordination_domain = ${this.coordinationDomain} AND owner = ${e}
          RETURNING lock_id
        )
        SELECT COUNT(DISTINCT lock_id)::int AS n FROM d
      `;await t`
        UPDATE agent_lock_waiters
           SET status = 'cancelled'
         WHERE coordination_domain = ${this.coordinationDomain}
           AND owner = ${e}
           AND status = 'waiting'
      `;let r=n[0]?.n??0;return r>0&&await t`SELECT grant_cascade(${this.coordinationDomain}, clock_timestamp())`,r})}}})),xe=e((()=>{M()})),Se=e((()=>{d(),M(),R(),a(),z(),Q(),Y(),be(),xe()}));export{ae as A,ee as B,N as C,y as D,b as E,ie as F,d as G,f as H,re as I,s as K,h as L,ne as M,x as N,v as O,C as P,g as R,de as S,ue as T,l as U,m as V,o as W,ce as _,Z as a,pe as b,G as c,V as d,he as f,R as g,F as h,be as i,S as j,M as k,B as l,me as m,xe as n,X as o,z as p,c as q,ye as r,Q as s,Se as t,Y as u,I as v,le as w,P as x,fe as y,p as z};