import{n as e}from"./chunk-CMxvf4Kt.js";import{t}from"./__vite-browser-external-CM3Eme-n.js";var n=e((()=>{t(),t()})),r=e((()=>{n()}));function i(e,t){let n=typeof e==`string`?JSON.parse(e):e;return(typeof n.ts!=`string`||!n.ts)&&t?.ts!=null&&(n.ts=t.ts instanceof Date?t.ts.toISOString():String(t.ts)),(typeof n.msg_id!=`string`||!n.msg_id)&&t?.msg_id!=null&&(n.msg_id=String(t.msg_id)),n}function a(){let e=Number({}.PAPERCUSP_COORD_READLINES_CACHE_TTL_MS);return Number.isFinite(e)&&e>0?e:p}function o(){return{}.PAPERCUSP_COORD_READLINES_CACHE!==`0`}function s(){let e=Number({}.PAPERCUSP_COORD_READEVENTS_CACHE_TTL_MS);return Number.isFinite(e)&&e>0?e:p}function c(){return{}.PAPERCUSP_COORD_READEVENTS_CACHE!==`0`}function l(e){return[...e.byMsgId.values()].sort((e,t)=>e.id-t.id).map(e=>e.envelope)}var u,d,f,p,m,h,g=e((()=>{u=`default`,d=1e3,f=2e3,p=5*6e4,m=12e4,h=class{opts;fallbackWs;readLinesCache=new Map;readEventsCache=new Map;constructor(e){this.opts=e,this.fallbackWs=e.workspaceId??`default`}resolveWs(){let e=this.opts.getWorkspaceId?.();return e&&e.trim()?e:this.fallbackWs}get workspaceId(){return this.resolveWs()}getSql(){return this.opts.getSql()}async appendLine(e,t,n){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_event_log (workspace_id, surface, writer_key, msg_id, body, harness_slug, ts)
      VALUES (${this.resolveWs()}, ${e}, ${t}, ${n.msg_id}, ${JSON.stringify(n)}::text::jsonb, ${n.harness_slug??null}, ${n.ts}::timestamptz)
    `}async readLines(e,t={}){await this.opts.ensureSchema();let n=this.opts.getSql();if(!o())return(await n`
        SELECT body, ts, msg_id FROM harness_shared.coord_event_log
         WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
         ORDER BY id ASC
      `).map(e=>i(e.body,e));let r=this.resolveWs(),s=`${r}::${e}`,c=Date.now(),l=this.readLinesCache.get(s);if(!l||c-l.fullReadAtMs>a()){let t=await n`
        SELECT id, body, ts, msg_id FROM harness_shared.coord_event_log
         WHERE workspace_id = ${r} AND surface = ${e}
         ORDER BY id ASC
      `,a=new Set;for(let e=Math.max(0,t.length-f);e<t.length;e++)a.add(Number(t[e].id));let o={maxId:t.length>0?Number(t[t.length-1].id):0,rows:t.map(e=>i(e.body,e)),recentIds:a,fullReadAtMs:c};return this.readLinesCache.set(s,o),o.rows.slice()}let u=await n`
      SELECT id, body, ts, msg_id FROM harness_shared.coord_event_log
       WHERE workspace_id = ${r} AND surface = ${e} AND id > ${Math.max(0,l.maxId-d)}
       ORDER BY id ASC
    `;for(let e of u){let t=Number(e.id);l.recentIds.has(t)||(l.rows.push(i(e.body,e)),l.recentIds.add(t),t>l.maxId&&(l.maxId=t))}if(l.recentIds.size>f*2){let e=[...l.recentIds].sort((e,t)=>e-t).slice(-2e3);l.recentIds=new Set(e)}return l.rows.slice()}async putEvent(e,t,n){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_event_log (workspace_id, surface, writer_key, msg_id, body, harness_slug, ts)
      VALUES (${this.resolveWs()}, ${e}, NULL, ${t}, ${JSON.stringify(n)}::text::jsonb, ${n.harness_slug??null}, ${n.ts}::timestamptz)
      ON CONFLICT (workspace_id, surface, msg_id) WHERE surface IN ('handoffs', 'escalations')
      DO UPDATE SET body = EXCLUDED.body, ts = now(), harness_slug = EXCLUDED.harness_slug
    `}async putEvents(e,t){t.length!==0&&(await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_event_log (workspace_id, surface, writer_key, msg_id, body, harness_slug, ts)
      SELECT ${this.resolveWs()}, ${e}, NULL, t.msg_id, t.body::text::jsonb, t.harness_slug, t.ts::timestamptz
        FROM unnest(${t.map(e=>e.msgId)}::text[], ${t.map(e=>JSON.stringify(e.record))}::text[], ${t.map(e=>e.record.harness_slug??null)}::text[], ${t.map(e=>e.record.ts)}::text[])
          AS t(msg_id, body, harness_slug, ts)
      ON CONFLICT (workspace_id, surface, msg_id) WHERE surface IN ('handoffs', 'escalations')
      DO UPDATE SET body = EXCLUDED.body, ts = now(), harness_slug = EXCLUDED.harness_slug
    `)}async readEvents(e){await this.opts.ensureSchema();let t=this.opts.getSql();if(!c())return(await t`
        SELECT body, ts, msg_id FROM harness_shared.coord_event_log
         WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
         ORDER BY id ASC
      `).map(e=>i(e.body,e));let n=this.resolveWs(),r=`${n}::${e}`,a=Date.now(),o=this.readEventsCache.get(r);if(!o||a-o.fullReadAtMs>s()){let o=await t`
        SELECT id, body, ts, msg_id FROM harness_shared.coord_event_log
         WHERE workspace_id = ${n} AND surface = ${e}
         ORDER BY id ASC
      `,s=new Map,c=0;for(let e of o){let t=Number(e.id);s.set(e.msg_id,{id:t,envelope:i(e.body,e)}),t>c&&(c=t)}let u={maxId:c,byMsgId:s,lastReadStartMs:a,fullReadAtMs:a};return this.readEventsCache.set(r,u),l(u)}let u=await t`
      SELECT id, body, ts, msg_id FROM harness_shared.coord_event_log
       WHERE workspace_id = ${n} AND surface = ${e}
         AND (id > ${Math.max(0,o.maxId-d)} OR ts > ${new Date(o.lastReadStartMs-m).toISOString()}::timestamptz)
       ORDER BY id ASC
    `;for(let e of u){let t=Number(e.id);o.byMsgId.set(e.msg_id,{id:t,envelope:i(e.body,e)}),t>o.maxId&&(o.maxId=t)}return o.lastReadStartMs=a,l(o)}async readEventsBounded(e,t){await this.opts.ensureSchema();let n=this.opts.getSql(),r=Math.max(1,Math.min(Math.floor(t.limit)||1,1e3)),a=t.kinds?.filter(e=>typeof e==`string`&&e.trim());return(a&&a.length?await n`
            SELECT body, ts, msg_id FROM harness_shared.coord_event_log
             WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
               AND body->>'kind' = ANY(${a}::text[])
             ORDER BY id DESC
             LIMIT ${r}
          `:await n`
            SELECT body, ts, msg_id FROM harness_shared.coord_event_log
             WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
             ORDER BY id DESC
             LIMIT ${r}
          `).map(e=>i(e.body,e))}async readLinesBounded(e,t){await this.opts.ensureSchema();let n=this.opts.getSql(),r=Math.max(1,Math.min(Math.floor(t.limit)||1,1e3)),a=t.kinds?.filter(e=>typeof e==`string`&&e.trim()),o=typeof t.sinceTs==`string`&&t.sinceTs?t.sinceTs:null,s=typeof t.planSlug==`string`&&t.planSlug?t.planSlug:null;return(await n`
      SELECT body, ts, msg_id FROM harness_shared.coord_event_log
       WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
         ${a&&a.length?n`AND body->>'kind' = ANY(${a}::text[])`:n``}
         ${o?n`AND body->>'ts' > ${o}`:n``}
         ${s?n`AND body->>'plan_slug' = ${s}`:n``}
       ORDER BY id DESC
       LIMIT ${r}
    `).map(e=>i(e.body,e))}async getEvent(e,t){await this.opts.ensureSchema();let n=await this.opts.getSql()`
      SELECT body, ts, msg_id FROM harness_shared.coord_event_log
       WHERE workspace_id = ${this.resolveWs()} AND surface = ${e} AND msg_id = ${t}
       LIMIT 1
    `;return n.length>0?i(n[0].body,n[0]):null}async readEventsBoundedCursor(e,t){await this.opts.ensureSchema();let n=this.opts.getSql(),r=Math.max(1,Math.min(Math.floor(t.limit)||1,1e3)),a=t.kinds?.filter(e=>typeof e==`string`&&e.trim()),o=typeof t.beforeId==`number`&&Number.isFinite(t.beforeId)?Math.floor(t.beforeId):null,s=await n`
      SELECT id, body, ts, msg_id FROM harness_shared.coord_event_log
       WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
         ${a&&a.length?n`AND body->>'kind' = ANY(${a}::text[])`:n``}
         ${o===null?n``:n`AND id < ${o}`}
       ORDER BY id DESC
       LIMIT ${r+1}
    `,c=s.length<=r;return{rows:s.slice(0,r).map(e=>({id:Number(e.id),envelope:i(e.body,e)})),exhausted:c}}async readLinesBoundedCursor(e,t){await this.opts.ensureSchema();let n=this.opts.getSql(),r=Math.max(1,Math.min(Math.floor(t.limit)||1,1e3)),a=t.kinds?.filter(e=>typeof e==`string`&&e.trim()),o=typeof t.sinceTs==`string`&&t.sinceTs?t.sinceTs:null,s=typeof t.planSlug==`string`&&t.planSlug?t.planSlug:null,c=typeof t.beforeId==`number`&&Number.isFinite(t.beforeId)?Math.floor(t.beforeId):null,l=await n`
      SELECT id, body, ts, msg_id FROM harness_shared.coord_event_log
       WHERE workspace_id = ${this.resolveWs()} AND surface = ${e}
         ${a&&a.length?n`AND body->>'kind' = ANY(${a}::text[])`:n``}
         ${o?n`AND body->>'ts' > ${o}`:n``}
         ${s?n`AND body->>'plan_slug' = ${s}`:n``}
         ${c===null?n``:n`AND id < ${c}`}
       ORDER BY id DESC
       LIMIT ${r+1}
    `,u=l.length<=r;return{rows:l.slice(0,r).map(e=>({id:Number(e.id),envelope:i(e.body,e)})),exhausted:u}}}})),_=e((()=>{r(),g()}));export{g as i,u as n,h as r,_ as t};