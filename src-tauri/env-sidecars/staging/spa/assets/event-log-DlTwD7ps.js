import{n as e}from"./chunk-CMxvf4Kt.js";import{t}from"./__vite-browser-external-CM3Eme-n.js";var n=e((()=>{t(),t()})),r=e((()=>{n()}));function i(e){return typeof e==`string`?JSON.parse(e):e}var a,o,s=e((()=>{a=`default`,o=class{opts;fallbackWs;constructor(e){this.opts=e,this.fallbackWs=e.workspaceId??`default`}resolveWs(){let e=this.opts.getWorkspaceId?.();return e&&e.trim()?e:this.fallbackWs}get workspaceId(){return this.resolveWs()}getSql(){return this.opts.getSql()}async appendLine(e,t,n){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_event_log (workspace_id, surface, writer_key, msg_id, body, harness_slug)
      VALUES (${this.resolveWs()}, ${e}, ${t}, ${n.msg_id}, ${JSON.stringify(n)}::text::jsonb, ${n.harness_slug??null})
    `}async readLines(e,t={}){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      SELECT body FROM harness_shared.coord_event_log
       WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
       ORDER BY id ASC
    `).map(e=>i(e.body))}async putEvent(e,t,n){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_event_log (workspace_id, surface, writer_key, msg_id, body, harness_slug)
      VALUES (${this.resolveWs()}, ${e}, NULL, ${t}, ${JSON.stringify(n)}::text::jsonb, ${n.harness_slug??null})
      ON CONFLICT (workspace_id, surface, msg_id) WHERE surface IN ('handoffs', 'escalations')
      DO UPDATE SET body = EXCLUDED.body, ts = now(), harness_slug = EXCLUDED.harness_slug
    `}async putEvents(e,t){t.length!==0&&(await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_event_log (workspace_id, surface, writer_key, msg_id, body, harness_slug)
      SELECT ${this.resolveWs()}, ${e}, NULL, t.msg_id, t.body::text::jsonb, t.harness_slug
        FROM unnest(${t.map(e=>e.msgId)}::text[], ${t.map(e=>JSON.stringify(e.record))}::text[], ${t.map(e=>e.record.harness_slug??null)}::text[])
          AS t(msg_id, body, harness_slug)
      ON CONFLICT (workspace_id, surface, msg_id) WHERE surface IN ('handoffs', 'escalations')
      DO UPDATE SET body = EXCLUDED.body, ts = now(), harness_slug = EXCLUDED.harness_slug
    `)}async readEvents(e){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      SELECT body FROM harness_shared.coord_event_log
       WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
       ORDER BY id ASC
    `).map(e=>i(e.body))}async readEventsBounded(e,t){await this.opts.ensureSchema();let n=this.opts.getSql(),r=Math.max(1,Math.min(Math.floor(t.limit)||1,1e3)),a=t.kinds?.filter(e=>typeof e==`string`&&e.trim());return(a&&a.length?await n`
            SELECT body FROM harness_shared.coord_event_log
             WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
               AND body->>'kind' = ANY(${a}::text[])
             ORDER BY id DESC
             LIMIT ${r}
          `:await n`
            SELECT body FROM harness_shared.coord_event_log
             WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
             ORDER BY id DESC
             LIMIT ${r}
          `).map(e=>i(e.body))}async readLinesBounded(e,t){await this.opts.ensureSchema();let n=this.opts.getSql(),r=Math.max(1,Math.min(Math.floor(t.limit)||1,1e3)),a=t.kinds?.filter(e=>typeof e==`string`&&e.trim()),o=typeof t.sinceTs==`string`&&t.sinceTs?t.sinceTs:null,s=typeof t.planSlug==`string`&&t.planSlug?t.planSlug:null;return(await n`
      SELECT body FROM harness_shared.coord_event_log
       WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
         ${a&&a.length?n`AND body->>'kind' = ANY(${a}::text[])`:n``}
         ${o?n`AND body->>'ts' > ${o}`:n``}
         ${s?n`AND body->>'plan_slug' = ${s}`:n``}
       ORDER BY id DESC
       LIMIT ${r}
    `).map(e=>i(e.body))}async getEvent(e,t){await this.opts.ensureSchema();let n=await this.opts.getSql()`
      SELECT body FROM harness_shared.coord_event_log
       WHERE workspace_id = ${this.resolveWs()} AND surface = ${e} AND msg_id = ${t}
       LIMIT 1
    `;return n.length>0?i(n[0].body):null}}})),c=e((()=>{r(),s()}));export{s as i,a as n,o as r,c as t};