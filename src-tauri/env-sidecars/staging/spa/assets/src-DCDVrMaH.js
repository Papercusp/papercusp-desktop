import{n as w,o as y}from"./chunk-ChpBd9eV.js";import{n as j,t as fe}from"./postgres-browser-CFiHlG7w.js";import{t as I}from"./__vite-browser-external-56mrcCg8.js";import{a as Te,c as he,l as Ae,t as te}from"./src-ybKeBUj8.js";function nt(e){$=e}function ne(){if(!$)throw new Error("@papercusp/locks: configureLocks() must be called before using the locks API");return $}function Re(){const e=$;if(!e?.getTxnTimeouts)return D;try{const n=e.getTxnTimeouts();return{lockTimeoutMs:Number.isFinite(n?.lockTimeoutMs)?n.lockTimeoutMs:D.lockTimeoutMs,statementTimeoutMs:Number.isFinite(n?.statementTimeoutMs)?n.statementTimeoutMs:D.statementTimeoutMs}}catch{return D}}var D,$,V=w((()=>{D={lockTimeoutMs:5e3,statementTimeoutMs:5e3},$=null}));function ge(e){if(!e||e==="")throw new p(e,"empty");if(e.startsWith("/"))throw new p(e,"absolute");if(e===".."||e.startsWith("../")||e.endsWith("/..")||e.includes("/../"))throw new p(e,"traversal");if(e.includes("\\"))throw new p(e,"backslash");if(e.length>4096)throw new p(e,"too long");if(e.includes("\0"))throw new p(e,"null byte")}function Ne(e){return e.split("/").filter(n=>n!==""&&n!==".").join("/")}function at(e){for(const t of e)ge(t);const n=e.map((t,a)=>{const i=Ne(t);if(i==="")throw new p(e[a],"empty after canonicalization");return i});return Array.from(new Set(n)).sort()}var p,Se,De=w((()=>{p=class extends Error{constructor(e,n){super(`InvalidPathError: ${n}: ${e}`),this.name="InvalidPathError"}},Se=4096}));function ae(){return ne().getAdminBaseUrl().replace(/\/[^/?]+(\?|$)/,"/papercusp_su$1")}function $e(){return ne().getAdminBaseUrl()}function oe(e){return{onnotice:()=>{},connection:{application_name:`pcusp:${e}:p${process.pid}`.slice(0,63),client_connection_check_interval:"30000",tcp_keepalives_idle:"30",tcp_keepalives_interval:"10",tcp_keepalives_count:"3"}}}function b(){return U||(U=j(ae(),{...oe("su-lock-tx"),max:10,idle_timeout:ie,prepare:!1})),U}function Le(){return A||(A=j(ae(),{...oe("su-lock-listener"),max:20,idle_timeout:0,prepare:!1})),A}function Oe(){const e=A;A=null,e&&e.end({timeout:1}).catch(()=>{})}function xe(e){const n=h.join(e,"sql");if(L.existsSync(n))return n;let t=e;for(;;){const a=h.join(t,"libs","papercusp","packages","locks","src","sql");if(L.existsSync(a))return a;const i=h.dirname(t);if(i===t)break;t=i}return n}async function z(){if(B)return;const e=j($e(),{max:1,prepare:!1});try{(await e`
      SELECT EXISTS(
        SELECT 1 FROM pg_database WHERE datname = 'papercusp_su'
      ) AS exists
    `)[0]?.exists||(await e.unsafe("CREATE DATABASE papercusp_su").simple(),await e.unsafe("ALTER DATABASE papercusp_su SET idle_in_transaction_session_timeout = '30s'").simple(),await e.unsafe("ALTER DATABASE papercusp_su SET application_name = 'papercusp-su'").simple())}finally{await e.end({timeout:1})}const n=b();await n`
    CREATE TABLE IF NOT EXISTS su_meta (
      key   text PRIMARY KEY,
      value text NOT NULL
    )
  `,await n.begin(async t=>{await t`LOCK TABLE su_meta IN SHARE UPDATE EXCLUSIVE MODE`;const a=await t`
      SELECT key FROM su_meta WHERE key LIKE 'migration:%'
    `,i=new Set(a.map(s=>s.key)),o=L.readdirSync(X).filter(s=>/^\d{3}-.*\.sql$/.test(s)).filter(s=>!s.endsWith("-bootstrap.sql")).sort();for(const s of o){const c=`migration:${s}`;if(i.has(c))continue;const _=L.readFileSync(h.join(X,s),"utf8");await t.unsafe(_),await t`
        INSERT INTO su_meta (key, value) VALUES (${c}, ${new Date().toISOString()})
        ON CONFLICT (key) DO NOTHING
      `}}),B=!0}async function H(e,n){const t=await e`
    DELETE FROM agent_file_locks
     WHERE coordination_domain = ${n}
       AND expires_ts <= clock_timestamp()
    RETURNING path
  `,a=await e`
    UPDATE agent_lock_waiters
       SET status = 'expired'
     WHERE coordination_domain = ${n}
       AND status = 'waiting'
       AND wait_until <= clock_timestamp()
    RETURNING ticket_id
  `;return t.length>0||a.length>0}async function Ce(e,n,t){if(t.length===0)return!1;const a=await e`
    DELETE FROM agent_file_locks
     WHERE coordination_domain = ${n}
       AND path = ANY(${t}::text[])
       AND expires_ts <= clock_timestamp()
    RETURNING path
  `,i=await e`
    UPDATE agent_lock_waiters
       SET status = 'expired'
     WHERE coordination_domain = ${n}
       AND status = 'waiting'
       AND wait_until <= clock_timestamp()
       AND paths && ${t}::text[]
    RETURNING ticket_id
  `;return a.length>0||i.length>0}async function ot(e,n){await e`SET LOCAL statement_timeout = '500ms'`,await H(e,n)&&await e`SELECT grant_cascade(${n}, clock_timestamp())`}async function ye(){await z();const e=b(),n=await e`
    SELECT coordination_domain FROM agent_file_locks
      WHERE expires_ts <= clock_timestamp()
    UNION
    SELECT coordination_domain FROM agent_lock_waiters
      WHERE status = 'waiting' AND wait_until <= clock_timestamp()
  `;for(const{coordination_domain:t}of n)try{await e.begin(async a=>{const i=a;await i`SET LOCAL statement_timeout = '2s'`,(await i`
          SELECT pg_try_advisory_xact_lock(
            ${101}::int,
            hashtext(${"su:"+t})
          ) AS locked
        `)[0]?.locked&&await H(i,t)&&await i`SELECT grant_cascade(${t}, clock_timestamp())`})}catch(a){console.error(`[su-locks] background janitor: workspace ${t} sweep failed`,a)}try{await e.begin(async t=>{const a=t;await a`SET LOCAL statement_timeout = '5s'`,await a`
        DELETE FROM agent_lock_waiters
         WHERE status IN ('granted','expired','cancelled')
           AND queued_ts < clock_timestamp() - interval '24 hours'
      `})}catch(t){console.error("[su-locks] background janitor: terminal-waiter GC failed",t)}}async function G(e,n){const{coordinationDomain:t,owner:a,ownerLabel:i,paths:o,intent:s,ttlSec:c}=n,_=n.automatic??s.startsWith("PreToolUse:");if(o.length===0)return{ok:!0,lock_id:crypto.randomUUID(),expires_ts:new Date,held:[],newly_held:[]};await e`SET LOCAL statement_timeout = '500ms'`,await Ce(e,t,o)&&await e`SELECT grant_cascade(${t}, clock_timestamp())`;const r=await e`
    SELECT path, lock_id::text AS lock_id, expires_ts FROM agent_file_locks
     WHERE coordination_domain = ${t}
       AND owner = ${a}
       AND path = ANY(${o}::text[])
       AND expires_ts > clock_timestamp()
  `,u=new Set(r.map(m=>m.path)),l=o.filter(m=>!u.has(m));if(_&&r.length>0&&l.length===0){const m=r.reduce((d,T)=>T.expires_ts<d?T.expires_ts:d,r[0].expires_ts);return{ok:!0,lock_id:r[0].lock_id,expires_ts:m,held:o,newly_held:[]}}const E=Array.from(new Set(r.map(m=>m.lock_id)))[0];if((l.length===0?[]:await e`
        SELECT TRUE AS blocked FROM agent_lock_waiters
         WHERE coordination_domain = ${t}
           AND status = 'waiting'
           -- A waiter whose wait_until has elapsed is effectively dead
           -- (crashed agent / timed-out wait) and must not block a new
           -- acquire even if the janitor hasn't swept it yet
           -- (file-locking #4 — robust regardless of sweep timing).
           AND wait_until > clock_timestamp()
           AND paths && ${l}::text[]
           AND queued_ts < clock_timestamp()
         LIMIT 1
      `).length>0)return{ok:!1,busy:await q(e,t,o,a)};if(l.length>0&&(await e`
      SELECT path FROM agent_file_locks
       WHERE coordination_domain = ${t}
         AND path = ANY(${l}::text[])
         AND expires_ts > clock_timestamp()
         AND owner != ${a}
    `).length>0)return{ok:!1,busy:await q(e,t,o,a)};const x=_&&r.length>0?crypto.randomUUID():E??crypto.randomUUID(),R=_&&r.length>0?l:o,k=await e`
    WITH wanted AS (SELECT unnest(${R}::text[]) AS path)
    INSERT INTO agent_file_locks
      (coordination_domain, path, owner, owner_label, intent, lock_id, acquired_ts, expires_ts)
    SELECT
      ${t}, w.path, ${a}, ${i}, ${s},
      ${x}::uuid, clock_timestamp(), clock_timestamp() + ${`${c} seconds`}::interval
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
  `;return k.length!==R.length?{ok:!1,busy:await q(e,t,o,a)}:{ok:!0,lock_id:k[0].lock_id,expires_ts:new Date(Date.now()+c*1e3),held:o,newly_held:l}}async function q(e,n,t,a){return await e`
    SELECT path, owner, owner_label, intent, expires_ts
      FROM agent_file_locks
     WHERE coordination_domain = ${n}
       AND path = ANY(${t}::text[])
       AND expires_ts > clock_timestamp()
       ${a?e`AND owner != ${a}`:e``}
  `}async function Ie(e,n){const{coordinationDomain:t,owner:a,lockId:i,paths:o,allMine:s}=n;await e`SET LOCAL statement_timeout = '5s'`,await H(e,t);const c=(await e`
    SELECT count(*)::int AS held
      FROM agent_file_locks
     WHERE coordination_domain = ${t}
       AND owner = ${a}
  `)[0]?.held??0;let _;if(s)_=await e`
      DELETE FROM agent_file_locks
       WHERE coordination_domain = ${t}
         AND owner = ${a}
      RETURNING path
    `;else if(i&&o&&o.length>0)_=await e`
      DELETE FROM agent_file_locks
       WHERE coordination_domain = ${t}
         AND lock_id = ${i}::uuid
         AND owner = ${a}
         AND path = ANY(${o}::text[])
      RETURNING path
    `;else if(i)_=await e`
      DELETE FROM agent_file_locks
       WHERE coordination_domain = ${t}
         AND lock_id = ${i}::uuid
         AND owner = ${a}
      RETURNING path
    `;else throw new Error("locks:release requires lock_id or all_mine");return await e`SELECT grant_cascade(${t}, clock_timestamp())`,{released:_.map(r=>r.path),heldBefore:c}}async function Ue(e,n,t,a,i){await e`SET LOCAL statement_timeout = '500ms'`,await H(e,n)&&await e`SELECT grant_cascade(${n}, clock_timestamp())`;const o=await e`
    UPDATE agent_file_locks
       SET expires_ts = clock_timestamp() + ${`${i} seconds`}::interval
     WHERE coordination_domain = ${n}
       AND lock_id = ${a}::uuid
       AND owner = ${t}
       AND expires_ts > clock_timestamp()
     RETURNING expires_ts
  `;return o.length===0?{expires_ts:null,extended:!1}:{expires_ts:o[0].expires_ts,extended:!0}}async function it(e,n){return e.begin(async t=>(await t`SET LOCAL statement_timeout = '1s'`,Me(t,n)))}async function st(e,n,t){if(n.length===0)return[];const a=[...n],i=t?.coordinationDomain??null,o=i===null?e`TRUE`:e`coordination_domain = ${i}`;return t?.includeIntents===!1?e`
      SELECT owner, path AS node
        FROM agent_file_locks
       WHERE ${o}
         AND expires_ts > clock_timestamp()
         AND owner = ANY(${a}::text[])
    `:e`
    SELECT owner, path AS node
      FROM agent_file_locks
     WHERE ${o}
       AND expires_ts > clock_timestamp()
       AND owner = ANY(${a}::text[])
    UNION
    SELECT w.owner, p AS node
      FROM agent_lock_waiters w, LATERAL unnest(w.paths) AS p
     WHERE ${i===null?e`TRUE`:e`coordination_domain = ${i}`}
       AND w.wait_until > clock_timestamp()
       AND w.owner = ANY(${a}::text[])
  `}async function Me(e,n){const{coordinationDomain:t,paths:a,owner:i,includeCompleted:o}=n,s=a&&a.length>0?e`AND path = ANY(${a}::text[])`:e``,c=i?e`AND owner = ${i}`:e``,_=t===null?e`TRUE`:e`coordination_domain = ${t}`,r=await e`
    SELECT lock_id::text AS lock_id, path, owner, owner_label, intent, acquired_ts, expires_ts,
           coordination_domain
      FROM agent_file_locks
     WHERE ${_}
       AND expires_ts > clock_timestamp()
       ${s}
       ${c}
     ORDER BY acquired_ts ASC
  `,u=a&&a.length>0?e`AND paths && ${a}::text[]`:e``,l={active_locks:r,waiting:await e`
    SELECT ticket_id, owner, owner_label, paths, intent, queued_ts, wait_until,
           status::text AS status,
           coordination_domain,
           (ROW_NUMBER() OVER (PARTITION BY coordination_domain
                                   ORDER BY queued_ts ASC, ticket_id ASC) - 1)::int AS ahead_count
      FROM agent_lock_waiters
     WHERE ${_}
       AND status = 'waiting'
       ${u}
       ${c}
     ORDER BY queued_ts ASC, ticket_id ASC
  `};return o&&(l.completed=await e`
      SELECT ticket_id, owner, owner_label, paths, intent, queued_ts, wait_until,
             status::text AS status,
             coordination_domain
        FROM agent_lock_waiters
       WHERE ${_}
         AND status IN ('granted','expired','cancelled')
         AND queued_ts > clock_timestamp() - interval '24 hours'
         ${u}
         ${c}
       ORDER BY queued_ts DESC
       LIMIT 50
    `),l}async function rt(e,n){const t=await G(e,{coordinationDomain:n.coordinationDomain,owner:n.owner,ownerLabel:n.ownerLabel,paths:n.paths,intent:n.intent,ttlSec:n.ttlSec});if(t.ok)return{ok:!0,self_granted:!0,lock_id:t.lock_id,expires_ts:t.expires_ts,held:t.held};if(await e`SET LOCAL statement_timeout = '500ms'`,(await e`
    SELECT count(*) >= ${10} AS at_cap
      FROM agent_lock_waiters
     WHERE owner = ${n.owner}
       AND status = 'waiting'
  `)[0]?.at_cap)return{ok:!1,reason:"waiter_cap_exceeded"};const a=`${n.maxWaitSec} seconds`,i=n.pendingEdit?JSON.stringify(n.pendingEdit):null,o=await e`
    INSERT INTO agent_lock_waiters
      (coordination_domain, owner, owner_label, paths, intent, ttl_sec, wait_until, pending_edit)
    VALUES
      (${n.coordinationDomain}, ${n.owner}, ${n.ownerLabel},
       ${n.paths}, ${n.intent}, ${n.ttlSec},
       clock_timestamp() + ${a}::interval,
       ${i}::jsonb)
    RETURNING ticket_id, wait_until
  `;return{ok:!0,ticket_id:o[0].ticket_id,wait_until:o[0].wait_until}}async function ct(e,n){const t=(await e`
    UPDATE agent_lock_waiters
       SET pending_edit_status = 'claiming'
     WHERE ticket_id = ${n}::uuid
       AND status = 'granted'
       AND granted_lock_id IS NOT NULL
       AND pending_edit IS NOT NULL
       AND pending_edit_status IS NULL
    RETURNING ticket_id, pending_edit, granted_lock_id,
              coordination_domain, owner, owner_label, intent, paths
  `)[0];return!t||!t.pending_edit||!t.granted_lock_id?null:{ticket_id:t.ticket_id,pending_edit:t.pending_edit,granted_lock_id:t.granted_lock_id,coordination_domain:t.coordination_domain,owner:t.owner,owner_label:t.owner_label??null,intent:t.intent,paths:t.paths}}async function _t(e,n,t){await e`
    UPDATE agent_lock_waiters
       SET pending_edit_status = ${t}
     WHERE ticket_id = ${n}::uuid
  `}async function lt(e,n){const t=await e`
    SELECT pending_edit IS NOT NULL AS has, pending_edit_status AS st
      FROM agent_lock_waiters
     WHERE ticket_id = ${n}::uuid
     LIMIT 1
  `;if(t.length===0||!t[0].has)return"none";const a=t[0].st;return a==="applied"?"applied":a==="fallback"?"fallback":"claiming"}async function dt(e,n){const t=await e`
    SELECT status::text AS status, granted_lock_id, granted_expires_ts, paths
      FROM agent_lock_waiters
     WHERE ticket_id = ${n}::uuid
     LIMIT 1
  `;if(t.length===0)return{status:"missing"};const a=t[0];return{status:a.status,granted_lock_id:a.granted_lock_id??void 0,granted_expires_ts:a.granted_expires_ts??void 0,paths:a.paths}}async function ut(e,n){await e`SET LOCAL statement_timeout = '500ms'`,await e`
    UPDATE agent_lock_waiters
       SET status = 'expired'
     WHERE ticket_id = ${n}::uuid
       AND status = 'waiting'
  `}async function Et(e,n,t){return await e`SET LOCAL statement_timeout = '500ms'`,{cancelled:(await e`
    UPDATE agent_lock_waiters
       SET status = 'cancelled'
     WHERE ticket_id = ${n}::uuid
       AND owner = ${t}
       AND status = 'waiting'
     RETURNING ticket_id
  `).length>0}}var L,h,K,ve,U,A,B,ie,X,We,O=w((()=>{L=y(I(),1),h=y(I(),1),K=y(I(),1),fe(),V(),De(),ve=101,U=null,A=null,B=!1,ie=Math.max(0,Number({}.PAPERCUSP_DB_IDLE_TIMEOUT)||30),X=xe(h.dirname((0,K.fileURLToPath)(import.meta.url))),We=10}));async function be(e,n,t){return e`
    SELECT owner, owner_label, mode, status, lock_id::text AS lock_id, reason,
           acquired_ts, expires_ts, fence_seq::int AS fence_seq
      FROM agent_resource_locks
     WHERE coordination_domain = ${n}
       AND resource = ${t}
       AND expires_ts > clock_timestamp()
     ORDER BY acquired_ts ASC
  `}async function F(e,n){const t=await e`
    DELETE FROM agent_resource_locks
     WHERE coordination_domain = ${n}
       AND expires_ts <= clock_timestamp()
    RETURNING resource
  `;return await e`
    DELETE FROM agent_resource_waiters
     WHERE coordination_domain = ${n}
       AND expires_ts <= clock_timestamp()
  `,t.length>0}async function P(e,n){const{coordinationDomain:t,resource:a,owner:i,ownerLabel:o}=n;await e`
    INSERT INTO agent_resource_waiters (coordination_domain, resource, owner, owner_label, expires_ts)
    VALUES (${t}, ${a}, ${i}, ${o}, clock_timestamp() + ${`${ce} seconds`}::interval)
    ON CONFLICT (coordination_domain, resource, owner) DO UPDATE
      SET owner_label = EXCLUDED.owner_label,
          queued_ts   = clock_timestamp(),
          expires_ts  = EXCLUDED.expires_ts
  `}async function J(e,n,t,a){await e`
    DELETE FROM agent_resource_waiters
     WHERE coordination_domain = ${n} AND resource = ${t} AND owner = ${a}
  `}async function se(e,n,t){const a=await e`
    DELETE FROM agent_resource_waiters
     WHERE coordination_domain = ${n}
       AND resource = ${t}
       AND expires_ts > clock_timestamp()
    RETURNING owner
  `;return[...new Set(a.map(i=>i.owner))]}async function mt(e,n){await e`SET LOCAL statement_timeout = '500ms'`,await F(e,n),await e`SELECT resource_grant_cascade(${n}, clock_timestamp())`}async function wt(e,n){const{coordinationDomain:t,resource:a,mode:i,owner:o,ownerLabel:s,reason:c,ttlSec:_}=n;await e`SET LOCAL statement_timeout = '500ms'`;const r=await e`
    SELECT max_holders FROM agent_resource_registry WHERE resource = ${a} LIMIT 1
  `;if(r.length===0)return{ok:!1,reason:"unknown_resource",holders:[]};const u=r[0].max_holders;await F(e,t)&&await e`SELECT resource_grant_cascade(${t}, clock_timestamp())`;const l=await be(e,t,a),E=`${_} seconds`;if(i==="shared"){const d=l.find(g=>g.mode==="exclusive");if(d&&d.owner!==o)return await P(e,{coordinationDomain:t,resource:a,owner:o,ownerLabel:s}),{ok:!1,reason:"exclusive_pending",holders:l};if(u!=null){const g=l.some(N=>N.owner===o&&N.mode==="shared"),ke=l.filter(N=>N.mode==="shared"&&N.owner!==o).length;if(!g&&ke>=u)return await P(e,{coordinationDomain:t,resource:a,owner:o,ownerLabel:s}),{ok:!1,reason:"at_capacity",holders:l}}const T=await e`
      INSERT INTO agent_resource_locks
        (coordination_domain, resource, owner, owner_label, mode, status, reason, expires_ts)
      VALUES
        (${t}, ${a}, ${o}, ${s}, 'shared', 'held', ${c},
         clock_timestamp() + ${E}::interval)
      ON CONFLICT (coordination_domain, resource, owner) DO UPDATE
        SET owner_label = EXCLUDED.owner_label,
            reason      = EXCLUDED.reason,
            mode        = 'shared',
            status      = 'held',
            acquired_ts = clock_timestamp(),
            expires_ts  = EXCLUDED.expires_ts
        WHERE agent_resource_locks.mode = 'shared'
      RETURNING lock_id::text AS lock_id, expires_ts
    `;return T.length===0?{ok:!1,reason:"held_exclusive",holders:l}:(await J(e,t,a,o),{ok:!0,mode:"shared",status:"held",lock_id:T[0].lock_id,expires_ts:T[0].expires_ts,shared_holders:l.filter(g=>g.mode==="shared"),fence_seq:0})}if(l.some(d=>d.owner===o&&d.mode==="shared"))return{ok:!1,reason:"holds_shared",holders:l};if(l.some(d=>d.mode==="exclusive"&&d.owner!==o))return await P(e,{coordinationDomain:t,resource:a,owner:o,ownerLabel:s}),{ok:!1,reason:"held_exclusive",holders:l};const x=l.filter(d=>d.mode==="shared"),R=x.length===0?"held":"draining",k=await e`
    INSERT INTO agent_resource_locks
      (coordination_domain, resource, owner, owner_label, mode, status, reason, expires_ts)
    VALUES
      (${t}, ${a}, ${o}, ${s}, 'exclusive', ${R}, ${c},
       clock_timestamp() + ${E}::interval)
    ON CONFLICT (coordination_domain, resource, owner) DO UPDATE
      SET owner_label = EXCLUDED.owner_label,
          reason      = EXCLUDED.reason,
          mode        = 'exclusive',
          status      = ${R},
          acquired_ts = clock_timestamp(),
          expires_ts  = EXCLUDED.expires_ts
    RETURNING lock_id::text AS lock_id, expires_ts, status
  `;let m=0;return k[0].status==="held"&&(m=(await e`
      UPDATE agent_resource_locks
         SET fence_seq = resource_assign_fence(${t}, ${a})
       WHERE coordination_domain = ${t} AND resource = ${a}
         AND owner = ${o} AND mode = 'exclusive'
      RETURNING fence_seq::int AS fence_seq
    `)[0]?.fence_seq??0),await J(e,t,a,o),{ok:!0,mode:"exclusive",status:k[0].status,lock_id:k[0].lock_id,expires_ts:k[0].expires_ts,shared_holders:x,fence_seq:m}}async function pt(e,n){const{coordinationDomain:t,owner:a,lockId:i,resource:o}=n;await e`SET LOCAL statement_timeout = '5s'`,await F(e,t);let s;if(i)s=await e`
      DELETE FROM agent_resource_locks
       WHERE coordination_domain = ${t} AND lock_id = ${i}::uuid AND owner = ${a}
      RETURNING mode, resource
    `;else if(o)s=await e`
      DELETE FROM agent_resource_locks
       WHERE coordination_domain = ${t} AND resource = ${o} AND owner = ${a}
      RETURNING mode, resource
    `;else throw new Error("tryReleaseResource requires lockId or resource");await e`SELECT resource_grant_cascade(${t}, clock_timestamp())`;const c=[...new Set(s.filter(r=>r.mode==="exclusive").map(r=>r.resource))],_={};for(const r of c)_[r]=await se(e,t,r);return{released:s.length,releasedModes:s.map(r=>r.mode),exclusiveResources:c,waiters:_}}async function kt(e,n,t){await e`SET LOCAL statement_timeout = '5s'`;const a=await e`
    DELETE FROM agent_resource_locks
     WHERE coordination_domain = ${n} AND owner = ${t}
    RETURNING mode, resource
  `;await e`DELETE FROM agent_resource_waiters WHERE coordination_domain = ${n} AND owner = ${t}`,await e`SELECT resource_grant_cascade(${n}, clock_timestamp())`;const i=[...new Set(a.filter(s=>s.mode==="exclusive").map(s=>s.resource))],o={};for(const s of i)o[s]=await se(e,n,s);return{released:a.length,exclusiveResources:i,waiters:o}}async function ft(e,n,t,a,i){await e`SET LOCAL statement_timeout = '500ms'`,await F(e,n)&&await e`SELECT resource_grant_cascade(${n}, clock_timestamp())`;const o=await e`
    UPDATE agent_resource_locks
       SET expires_ts = clock_timestamp() + ${`${i} seconds`}::interval
     WHERE coordination_domain = ${n}
       AND lock_id = ${a}::uuid
       AND owner = ${t}
       AND expires_ts > clock_timestamp()
    RETURNING expires_ts
  `;return o.length===0?{expires_ts:null,extended:!1}:{expires_ts:o[0].expires_ts,extended:!0}}async function Tt(e,n){const t=await e`
    SELECT status, mode, resource, expires_ts, fence_seq::int AS fence_seq
      FROM agent_resource_locks
     WHERE lock_id = ${n}::uuid
       AND expires_ts > clock_timestamp()
     LIMIT 1
  `;return t.length===0?{status:"missing"}:{status:t[0].status,mode:t[0].mode,resource:t[0].resource,expires_ts:t[0].expires_ts,fence_seq:t[0].fence_seq}}async function ht(e,n){const{coordinationDomain:t,resource:a}=n,i=a?await e`
        SELECT owner, owner_label, mode, status, lock_id::text AS lock_id, reason,
               acquired_ts, expires_ts, fence_seq::int AS fence_seq
          FROM agent_resource_locks
         WHERE coordination_domain = ${t}
           AND resource = ${a}
           AND expires_ts > clock_timestamp()
         ORDER BY acquired_ts ASC
      `:await e`
        SELECT owner, owner_label, mode, status, lock_id::text AS lock_id, reason,
               acquired_ts, expires_ts, fence_seq::int AS fence_seq
          FROM agent_resource_locks
         WHERE coordination_domain = ${t}
           AND expires_ts > clock_timestamp()
         ORDER BY acquired_ts ASC
      `;return{holders:i,draining:i.some(o=>o.mode==="exclusive"&&o.status==="draining")}}async function At(e,n){const{coordinationDomain:t,resource:a,lockId:i,fenceSeq:o}=n,s=await e`
    SELECT lock_id::text AS lock_id, fence_seq::int AS fence_seq
      FROM agent_resource_locks
     WHERE coordination_domain = ${t}
       AND resource = ${a}
       AND mode = 'exclusive'
       AND status = 'held'
       AND expires_ts > clock_timestamp()
     LIMIT 1
  `;if(s.length===0)return{current:!1,reason:"expired_or_released"};const c=s[0];return c.lock_id!==i||c.fence_seq<o?{current:!1,reason:"superseded",live_fence_seq:c.fence_seq}:{current:!0,live_fence_seq:c.fence_seq}}async function Rt(e,n,t){const a=await e`
    SELECT fence_seq::int AS fence_seq, applied_ts
      FROM agent_resource_action_log
     WHERE coordination_domain = ${n} AND action_key = ${t}
     LIMIT 1
  `;return a.length===0?{applied:!1}:{applied:!0,fence_seq:a[0].fence_seq,applied_ts:a[0].applied_ts}}async function gt(e,n,t,a){return(await e`
    INSERT INTO agent_resource_action_log (coordination_domain, action_key, fence_seq)
    VALUES (${n}, ${t}, ${a})
    ON CONFLICT (coordination_domain, action_key) DO NOTHING
    RETURNING action_key
  `).length>0}function re(e){return{resource:e.resource,description:e.description,rule_text:e.rule_text,enforcement:e.enforcement,match_patterns:e.match_patterns??[],max_holders:e.max_holders??null}}async function Nt(e){return(await e`
    SELECT resource, description, rule_text, enforcement, match_patterns, max_holders
      FROM agent_resource_registry
     ORDER BY resource ASC
  `).map(re)}async function St(e,n){const t=await e`
    SELECT resource, description, rule_text, enforcement, match_patterns, max_holders
      FROM agent_resource_registry
     WHERE resource = ${n}
     LIMIT 1
  `;return t[0]?re(t[0]):null}var ce,He=w((()=>{ce=1800}));async function Fe(e,n){await e`
    DELETE FROM agent_granular_locks
     WHERE coordination_domain = ${n}
       AND expires_ts <= clock_timestamp()
  `}async function qe(e,n,t){return t.length===0?[]:e`
    SELECT node, mode, owner, owner_label, lock_id::text AS lock_id, intent, acquired_ts, expires_ts
      FROM agent_granular_locks
     WHERE coordination_domain = ${n}
       AND node = ANY(${t}::text[])
       AND expires_ts > clock_timestamp()
  `}async function Dt(e,n){const{coordinationDomain:t,mode:a,owner:i,ownerLabel:o,intent:s,ttlSec:c}=n,_=Ae(n.path);await e`SET LOCAL statement_timeout = '500ms'`,await Fe(e,t);const r=he(_,a),u=Te(await qe(e,t,r.map(E=>E.node)),r,i);if(u.length>0)return{ok:!1,reason:"conflict",conflicts:u};const l=crypto.randomUUID();return{ok:!0,lock_id:l,locks:r,expires_ts:(await e`
    INSERT INTO agent_granular_locks
      (coordination_domain, node, mode, owner, owner_label, lock_id, intent, expires_ts)
    SELECT ${t}, n.node, n.mode, ${i}, ${o}, ${l}::uuid, ${s},
           clock_timestamp() + ${`${c} seconds`}::interval
      FROM unnest(${r.map(E=>E.node)}::text[], ${r.map(E=>E.mode)}::text[]) AS n(node, mode)
    ON CONFLICT (coordination_domain, node, owner, mode) DO UPDATE
      SET owner_label = EXCLUDED.owner_label,
          lock_id     = EXCLUDED.lock_id,
          intent      = EXCLUDED.intent,
          acquired_ts = clock_timestamp(),
          expires_ts  = EXCLUDED.expires_ts
    RETURNING expires_ts
  `)[0].expires_ts}}async function $t(e,n,t,a){return await e`SET LOCAL statement_timeout = '5s'`,{released:(await e`
    DELETE FROM agent_granular_locks
     WHERE coordination_domain = ${n}
       AND lock_id = ${a}::uuid
       AND owner = ${t}
    RETURNING node
  `).length}}var Pe=w((()=>{te()}));function Q(e,n){return new Promise((t,a)=>{const i=setTimeout(()=>a(new W(e)),Y);n.then(o=>{clearTimeout(i),t(o)},o=>{clearTimeout(i),a(o)})})}function Z(){f.clear(),Oe()}function Ge(e){return`ch_coord_${(0,_e.createHash)("md5").update(e).digest("hex")}`}async function Lt(e,n){let t=f.get(e);if(!t){if(f.size>=le)throw new de;const a=Le(),i=Ge(e),o=new Set,s=a.listen(i,_=>{const r=_.indexOf(":"),u=r>=0?_.slice(0,r):_,l=r>=0?_.slice(r+1):"granted";for(const E of o)try{E(u,l)}catch{}});let c;try{c=await Q("listen",s)}catch(_){throw _ instanceof W&&Z(),_}t={unlisten:c.unlisten,listeners:o},f.set(e,t)}return t.listeners.add(n),async()=>{const a=f.get(e);if(a&&(a.listeners.delete(n),a.listeners.size===0)){f.delete(e);try{await Q("unlisten",a.unlisten())}catch(i){i instanceof W&&Z()}}}}function Be(){M||(M=setInterval(()=>{v||(v=!0,ye().catch(e=>console.error("[su-locks] background janitor pass failed",e)).finally(()=>{v=!1}))},ue),M.unref?.())}var _e,le,Y,W,f,de,ue,M,v,Ee=w((()=>{_e=y(I(),1),O(),le=20,Y=Math.max(1e3,Number({}.PAPERCUSP_LISTEN_OP_TIMEOUT_MS)||2e4),W=class extends Error{constructor(e){super(`listen_op_timeout: ${e} exceeded ${Y}ms — the LISTEN connection is presumed dead`),this.name="ListenOpTimeoutError"}},f=new Map,de=class extends Error{constructor(){super("too_many_active_workspaces"),this.name="TooManyActiveWorkspacesError"}},ue=3e4,M=null,v=!1}));function Xe(){return!!{}.VITEST||!1}function Ye(e){return!e||e.length===0?[]:Array.from(new Set(e)).sort()}async function je(e,n,t){const a=Ye(t);if(a.length===0){await e`SELECT pg_advisory_xact_lock(
      ${101}::int,
      hashtext(${"su:"+n})
    )`;return}await e`SELECT pg_advisory_xact_lock_shared(
    ${101}::int,
    hashtext(${"su:"+n})
  )`;for(const i of a)await e`SELECT pg_advisory_xact_lock(
      ${101}::int,
      hashtext(${"su:"+n+":"+i})
    )`}async function S(e,n,t,a={}){await z(),Xe()||Be();const i=b();let o;try{o=await i.begin(async s=>{await s`SELECT set_config('application_name', ${"papercusp-su:"+n}, true)`;const{lockTimeoutMs:c,statementTimeoutMs:_}=Re();return await s`SELECT set_config('lock_timeout', ${`${Math.trunc(c)}ms`}, true)`,await s`SELECT set_config('statement_timeout', ${`${Math.trunc(_)}ms`}, true)`,await je(s,e,a.paths),t(s)})}catch(s){const c=s?.code;throw typeof c=="string"&&we.has(c)?new me(e,c,s):s}return o}var me,we,pe=w((()=>{O(),Ee(),V(),me=class extends Error{coordinationDomain;pgCode;constructor(e,n,t){super(`workspace "${e}" contended (pg ${n}: lock/statement timeout)`),this.name="WorkspaceContendedError",this.coordinationDomain=e,this.pgCode=n,this.cause=t}},we=new Set(["55P03","57014"])}));function ee(e){return{path:e.path,owner:e.owner,ownerLabel:e.owner_label,intent:e.intent,expiresAt:e.expires_ts}}var C,Ve,ze=w((()=>{pe(),O(),C=1200,Ve=class{coordinationDomain;constructor(e){this.coordinationDomain=e.coordinationDomain}async acquire(e,n,t={}){const a=t.ttlMs?Math.max(1,Math.round(t.ttlMs/1e3)):C;return S(this.coordinationDomain,e,async i=>{const o=await G(i,{coordinationDomain:this.coordinationDomain,owner:e,ownerLabel:t.ownerLabel??null,paths:[...n],intent:t.intent??"file-claim",ttlSec:a});return o.ok?{ok:!0,claim:{claimId:o.lock_id,owner:e,paths:[...o.held],expiresAt:o.expires_ts}}:{ok:!1,busy:o.busy.map(ee)}},{paths:n})}async release(e){await S(this.coordinationDomain,e.owner,async n=>{await Ie(n,{coordinationDomain:this.coordinationDomain,owner:e.owner,lockId:e.claimId,paths:[...e.paths]})},{paths:e.paths})}async extend(e,n){const t=n.addPaths??[],a=n.ttlMs?Math.max(1,Math.round(n.ttlMs/1e3)):C,i=Array.from(new Set([...e.paths,...t]));return S(this.coordinationDomain,e.owner,async o=>{const s=await G(o,{coordinationDomain:this.coordinationDomain,owner:e.owner,ownerLabel:null,paths:i,intent:"file-claim:extend",ttlSec:a});return s.ok?{ok:!0,claim:{claimId:s.lock_id,owner:e.owner,paths:[...s.held],expiresAt:s.expires_ts}}:{ok:!1,busy:s.busy.map(ee)}},{paths:i})}async heartbeat(e,n){const t=n?Math.max(1,Math.round(n/1e3)):C;return S(this.coordinationDomain,e.owner,async a=>{const i=await Ue(a,this.coordinationDomain,e.owner,e.claimId,t);return i.extended?{ok:!0,claim:{claimId:e.claimId,owner:e.owner,paths:[...e.paths],expiresAt:i.expires_ts}}:{ok:!1,expired:!0}},{paths:e.paths})}async reap(e){return S(this.coordinationDomain,e,async n=>{const t=await n`
        WITH d AS (
          DELETE FROM agent_file_locks
           WHERE coordination_domain = ${this.coordinationDomain} AND owner = ${e}
          RETURNING lock_id
        )
        SELECT COUNT(DISTINCT lock_id)::int AS n FROM d
      `;await n`
        UPDATE agent_lock_waiters
           SET status = 'cancelled'
         WHERE coordination_domain = ${this.coordinationDomain}
           AND owner = ${e}
           AND status = 'waiting'
      `;const a=t[0]?.n??0;return a>0&&await n`SELECT grant_cascade(${this.coordinationDomain}, clock_timestamp())`,a})}}}));async function Ot(e,n){const t=e.trim(),a=n.trim();if(!t||!a||t===a)return{ok:!1,from:t,to:a,fileLocksMoved:0,waitersMoved:0};await z();const i=b(),o=await i`
    UPDATE agent_file_locks SET owner = ${a} WHERE owner = ${t} RETURNING path
  `,s=await i`
    UPDATE agent_lock_waiters SET owner = ${a} WHERE owner = ${t} RETURNING ticket_id
  `;return{ok:!0,from:t,to:a,fileLocksMoved:o.length,waitersMoved:s.length}}var Ke=w((()=>{O()})),xt=w((()=>{V(),O(),He(),te(),Pe(),pe(),Ee(),ze(),Ke()}));export{Ce as $,ht as A,ut as B,J as C,mt as D,Nt as E,wt as F,st as G,b as H,ft as I,dt as J,lt as K,pt as L,P as M,kt as N,se as O,F as P,_t as Q,ct as R,Rt as S,He as T,O as U,Le as V,ot as W,xe as X,Oe as Y,ye as Z,Pe as _,ze as a,Ie as at,Dt as b,pe as c,Ne as ct,Ge as d,ge as dt,H as et,Ee as f,D as ft,Q as g,Re as gt,Lt as h,ne as ht,Ve as i,rt as it,gt as j,Tt as k,W as l,De as lt,Be as m,V as mt,Ke as n,Et as nt,me as o,p as ot,Z as p,nt as pt,it as q,Ot as r,Ue as rt,S as s,Se as st,xt as t,G as tt,de as u,at as ut,$t as v,St as w,At as x,Fe as y,z};
