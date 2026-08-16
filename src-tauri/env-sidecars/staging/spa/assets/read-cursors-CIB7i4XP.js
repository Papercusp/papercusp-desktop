import{n as _}from"./chunk-ChpBd9eV.js";import{st as r,t as u}from"./src-8fWtxfEz.js";import{o as p,r as a}from"./log-CmoS19XU.js";async function w(e,s,n){return o.ackAndAdvance(e,s,n)}async function h(e,s){return o.ackAndRead(e,s)}async function N(e,s,n){return o.stage(e,s,n)}var c,o,S=_((()=>{u(),p(),c=class{async ackAndAdvance(e,s,n){const{sql:t}=r(),d=a(),i=(await t`
      WITH old AS (
        SELECT committed, pending FROM harness_shared.coord_read_cursors
         WHERE workspace_id = ${d} AND owner_id = ${e} AND surface = ${s}
      ), up AS (
        INSERT INTO harness_shared.coord_read_cursors
               (workspace_id, owner_id, surface, committed, pending, pending_at, updated_at)
        VALUES (${d}, ${e}, ${s},
                (SELECT COALESCE(pending, committed) FROM old),
                -- WI-7092 / EI-607: this sql is getOrgPg's client (line 53) -- sql.json(next)
                -- THROWS on it in production (a postgres-js CJS/ESM dual-package
                -- module-instance mismatch; see
                -- agent-insights/sql-json-throws-on-getorgpg-client). Bind as
                -- JSON.stringify(next)::jsonb instead -- portable, server-side cast, and
                -- correct under vitest too (vitest's module transform does not reproduce
                -- the CJS/ESM split, so a vitest-run test cannot tell the two forms apart --
                -- this comment plus lint:no-sql-json are what actually guard the class).
                ${JSON.stringify(n)}::jsonb, now(), now())
        ON CONFLICT (workspace_id, owner_id, surface) DO UPDATE
           SET committed  = COALESCE(harness_shared.coord_read_cursors.pending,
                                     harness_shared.coord_read_cursors.committed),
               pending    = EXCLUDED.pending,
               pending_at = now(),
               updated_at = now()
        RETURNING committed
      )
      SELECT committed FROM up
    `)[0]?.committed??null;return{committed:i,baseline:i===null}}async ackAndRead(e,s){const{sql:n}=r(),t=(await n`
      INSERT INTO harness_shared.coord_read_cursors
             (workspace_id, owner_id, surface, committed, pending, pending_at, updated_at)
      VALUES (${a()}, ${e}, ${s}, NULL, NULL, now(), now())
      ON CONFLICT (workspace_id, owner_id, surface) DO UPDATE
         SET committed  = COALESCE(harness_shared.coord_read_cursors.pending,
                                   harness_shared.coord_read_cursors.committed),
             pending    = NULL,
             updated_at = now()
      RETURNING committed
    `)[0]?.committed??null;return{committed:t,baseline:t===null}}async stage(e,s,n){const{sql:t}=r();await t`
      INSERT INTO harness_shared.coord_read_cursors
             (workspace_id, owner_id, surface, committed, pending, pending_at, updated_at)
      VALUES (${a()}, ${e}, ${s}, NULL, ${JSON.stringify(n)}::jsonb, now(), now())
      ON CONFLICT (workspace_id, owner_id, surface) DO UPDATE
         SET pending    = EXCLUDED.pending,
             pending_at = now(),
             updated_at = now()
    `}async clear(e,s){const{sql:n}=r();await n`
      DELETE FROM harness_shared.coord_read_cursors
       WHERE workspace_id = ${a()} AND owner_id = ${e} AND surface = ${s}`}},o=new c}));export{N as i,h as n,S as r,w as t};
