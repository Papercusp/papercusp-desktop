import{n as e}from"./chunk-CMxvf4Kt.js";import{i as t}from"./event-log-C8dilTin.js";import{C as n,c as r}from"./log-G9Pdopl-.js";function i(e){return`${e.kind}\x00${e.ref}`}var a,o=e((()=>{a=`tagged`})),s,c,l=e((()=>{o(),s=`topic`,c=class{links;now;constructor(e,t=()=>new Date().toISOString()){this.links=e,this.now=t}async addTag(e,t,n){await this.links.link(e,{kind:s,ref:t},a,{created_by:n.created_by,created_ts:n.created_ts})}async removeTag(e,t){await this.links.unlink(e,{kind:s,ref:t},a)}async listTags(e){return(await this.links.listOut(e,{rel:a})).filter(e=>e.dst.kind===s).map(e=>e.dst.ref)}async listTagsForMany(e){let t=new Map;if(e.length===0)return t;let n=await this.links.listOutMany(e,{rel:a});for(let e of n){if(e.dst.kind!==s)continue;let n=i(e.src),r=t.get(n);r?r.push(e.dst.ref):t.set(n,[e.dst.ref])}return t}async listTagged(e){return(await this.links.listIn({kind:s,ref:e},{rel:a})).map(e=>e.src)}}})),u=e((()=>{o(),l()}));function d(e){return`${e.kind}:${e.ref}`}function f(e,t){let n=e.get(t.subscriber_id);if(!n){e.set(t.subscriber_id,t);return}let r=h[t.delivery_mode]>=h[n.delivery_mode]?t.delivery_mode:n.delivery_mode,i=n.via===`object`||t.via===`object`?`object`:n.via;e.set(t.subscriber_id,{subscriber_id:t.subscriber_id,delivery_mode:r,via:i})}async function p(e,t){let n=new Map;for(let r of await t.subscriptions.listTargetSubscribers(`object`,d(e)))f(n,{subscriber_id:r.subscriber_id,delivery_mode:r.delivery_mode,via:`object`});let r=await t.tags.listTags(e),i=new Set;for(let e of r)i.add(await t.topics.resolve(e));for(let e of i)for(let r of await t.subscriptions.listTargetSubscribers(`topic`,e))f(n,{subscriber_id:r.subscriber_id,delivery_mode:r.delivery_mode,via:e});return[...n.values()]}var m,h,g=e((()=>{m=[`open`,`resolved`,`closed`],h={full:3,digest:2,mention:1,muted:0}})),_=e((()=>{g()})),v=e((()=>{u(),_()})),y=e((()=>{u()}));function b(e){return e instanceof Date?e.toISOString():new Date(e).toISOString()}function x(e){return e==null?null:b(e)}function S(e){return{slug:e.slug,title:e.title,description:e.description,created_by:e.created_by,merged_into:e.merged_into,created_ts:b(e.created_at)}}function C(e){return{id:Number(e.id),subscriber_id:e.subscriber_id,target_kind:e.target_kind,target_ref:e.target_ref,delivery_mode:e.delivery_mode,created_ts:b(e.created_at),expires_ts:x(e.expires_ts)}}function w(e){return{id:Number(e.id),src:{kind:e.src_kind,ref:e.src_ref},dst:{kind:e.dst_kind,ref:e.dst_ref},rel:e.rel,created_by:e.created_by,created_ts:b(e.created_at)}}function T(e){return{thread_id:e.thread_id,parent:{kind:e.parent_kind,ref:e.parent_ref},title:e.title,created_by:e.created_by,created_ts:b(e.created_at),last_post_ts:x(e.last_post_at),post_count:Number(e.post_count)}}var E,D,O,k,A,j=e((()=>{t(),r(),y(),E=class{opts;constructor(e){this.opts=e}get ws(){return this.opts.getWorkspaceId?.()?.trim()||(this.opts.workspaceId??`default`)}async create(e){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_topics (workspace_id, slug, title, description, created_by, created_at)
      VALUES (${this.ws}, ${e.slug}, ${e.title??null}, ${e.description}, ${e.created_by??null}, ${e.created_ts})
      ON CONFLICT (workspace_id, slug) DO NOTHING`;let t=await this.get(e.slug);if(!t)throw Error(`coord_topics: failed to read back topic ${e.slug}`);return t}async list(e={}){await this.opts.ensureSchema();let t=this.opts.getSql();return(await t`
      SELECT slug, title, description, created_by, merged_into, created_at
        FROM harness_shared.coord_topics
       WHERE workspace_id = ${this.ws}
         AND ${e.includeMerged?t`TRUE`:t`merged_into IS NULL`}
       ORDER BY created_at ASC, slug ASC`).map(S)}async get(e){await this.opts.ensureSchema();let t=await this.opts.getSql()`
      SELECT slug, title, description, created_by, merged_into, created_at
        FROM harness_shared.coord_topics
       WHERE workspace_id = ${this.ws} AND slug = ${e}`;return t[0]?S(t[0]):null}async merge(e,t){e!==t&&(await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_topics
         SET merged_into = ${t}
       WHERE workspace_id = ${this.ws} AND slug = ${e}`)}async resolve(e){await this.opts.ensureSchema();let t=this.opts.getSql(),n=e,r=new Set;for(let e=0;e<16&&!r.has(n);e++){r.add(n);let e=(await t`
        SELECT merged_into FROM harness_shared.coord_topics
         WHERE workspace_id = ${this.ws} AND slug = ${n}`)[0]?.merged_into;if(!e)return n;n=e}return n}},D=class{opts;constructor(e){this.opts=e}get ws(){return this.opts.getWorkspaceId?.()?.trim()||(this.opts.workspaceId??`default`)}async subscribe(e){await this.opts.ensureSchema();let t=this.opts.getSql(),n=e.delivery_mode??`full`;return C((await t`
      INSERT INTO harness_shared.coord_entity_subscriptions
        (workspace_id, subscriber_id, target_kind, target_ref, delivery_mode, expires_ts, created_at)
      VALUES (${this.ws}, ${e.subscriber_id}, ${e.target_kind}, ${e.target_ref},
              ${n}, ${e.expires_ts??null}, ${e.created_ts})
      ON CONFLICT (workspace_id, subscriber_id, target_kind, target_ref) WHERE cancelled_at IS NULL
      DO UPDATE SET delivery_mode = EXCLUDED.delivery_mode, expires_ts = EXCLUDED.expires_ts
      RETURNING id, subscriber_id, target_kind, target_ref, delivery_mode, created_at, expires_ts`)[0])}async unsubscribe(e,t,n){await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_entity_subscriptions
         SET cancelled_at = now()
       WHERE workspace_id = ${this.ws} AND subscriber_id = ${e}
         AND target_kind = ${t} AND target_ref = ${n}
         AND cancelled_at IS NULL`}async listSubscriptions(e){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      SELECT id, subscriber_id, target_kind, target_ref, delivery_mode, created_at, expires_ts
        FROM harness_shared.coord_entity_subscriptions
       WHERE workspace_id = ${this.ws} AND subscriber_id = ${e}
         AND cancelled_at IS NULL AND (expires_ts IS NULL OR expires_ts > now())
       ORDER BY created_at ASC, id ASC`).map(C)}async listTargetSubscribers(e,t){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      SELECT id, subscriber_id, target_kind, target_ref, delivery_mode, created_at, expires_ts
        FROM harness_shared.coord_entity_subscriptions
       WHERE workspace_id = ${this.ws} AND target_kind = ${e} AND target_ref = ${t}
         AND cancelled_at IS NULL AND (expires_ts IS NULL OR expires_ts > now())
       ORDER BY created_at ASC, id ASC`).map(C)}},O=class{opts;constructor(e){this.opts=e}get ws(){return this.opts.getWorkspaceId?.()?.trim()||(this.opts.workspaceId??`default`)}async link(e,t,n,r){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_links
        (workspace_id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at)
      VALUES (${this.ws}, ${e.kind}, ${e.ref}, ${t.kind}, ${t.ref}, ${n}, ${r.created_by??null}, ${r.created_ts})
      ON CONFLICT (workspace_id, src_kind, src_ref, dst_kind, dst_ref, rel) DO NOTHING`}async unlink(e,t,n){await this.opts.ensureSchema(),await this.opts.getSql()`
      DELETE FROM harness_shared.coord_links
       WHERE workspace_id = ${this.ws} AND src_kind = ${e.kind} AND src_ref = ${e.ref}
         AND dst_kind = ${t.kind} AND dst_ref = ${t.ref} AND rel = ${n}`}async listOut(e,t={}){await this.opts.ensureSchema();let n=this.opts.getSql();return(await n`
      SELECT id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at
        FROM harness_shared.coord_links
       WHERE workspace_id = ${this.ws} AND src_kind = ${e.kind} AND src_ref = ${e.ref}
         AND ${t.rel==null?n`TRUE`:n`rel = ${t.rel}`}
       ORDER BY created_at ASC, id ASC`).map(w)}async listIn(e,t={}){await this.opts.ensureSchema();let n=this.opts.getSql();return(await n`
      SELECT id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at
        FROM harness_shared.coord_links
       WHERE workspace_id = ${this.ws} AND dst_kind = ${e.kind} AND dst_ref = ${e.ref}
         AND ${t.rel==null?n`TRUE`:n`rel = ${t.rel}`}
       ORDER BY created_at ASC, id ASC`).map(w)}async listOutMany(e,t={}){if(e.length===0)return[];await this.opts.ensureSchema();let n=this.opts.getSql(),r=new Map;for(let t of e){let e=r.get(t.kind);e?e.push(t.ref):r.set(t.kind,[t.ref])}let i=[];for(let[e,a]of r){let r=await n`
        SELECT id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at
          FROM harness_shared.coord_links
         WHERE workspace_id = ${this.ws} AND src_kind = ${e} AND src_ref = ANY(${a})
           AND ${t.rel==null?n`TRUE`:n`rel = ${t.rel}`}
         ORDER BY created_at ASC, id ASC`;i.push(...r.map(w))}return i}async listInMany(e,t={}){if(e.length===0)return[];await this.opts.ensureSchema();let n=this.opts.getSql(),r=new Map;for(let t of e){let e=r.get(t.kind);e?e.push(t.ref):r.set(t.kind,[t.ref])}let i=[];for(let[e,a]of r){let r=await n`
        SELECT id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at
          FROM harness_shared.coord_links
         WHERE workspace_id = ${this.ws} AND dst_kind = ${e} AND dst_ref = ANY(${a})
           AND ${t.rel==null?n`TRUE`:n`rel = ${t.rel}`}
         ORDER BY created_at ASC, id ASC`;i.push(...r.map(w))}return i}},k=class extends c{constructor(e){super(new O(e))}},A=class{opts;constructor(e){this.opts=e}get ws(){return this.opts.getWorkspaceId?.()?.trim()||(this.opts.workspaceId??`default`)}async getOrCreateThread(e,t){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_threads
        (workspace_id, thread_id, parent_kind, parent_ref, title, created_by, created_at, harness_slug)
      VALUES (${this.ws}, ${t.thread_id}, ${e.kind}, ${e.ref}, ${t.title??null}, ${t.created_by??null}, ${t.created_ts}, ${t.harness_slug??null})
      ON CONFLICT DO NOTHING`;let n=await this.getThreadByParent(e)??await this.getThreadById(t.thread_id);if(!n)throw Error(`coord_threads: failed to read back thread for ${e.kind}:${e.ref} / ${t.thread_id}`);return n}async addPost(e){await this.opts.ensureSchema();let t=this.opts.getSql(),r=n(),i=await t`
      INSERT INTO harness_shared.coord_thread_posts (workspace_id, thread_id, author_id, body, created_at, post_msg_id, harness_slug)
      VALUES (${this.ws}, ${e.thread_id}, ${e.author_id??null}, ${e.body}, ${e.created_ts}, ${r},
        (SELECT harness_slug FROM harness_shared.coord_threads WHERE workspace_id = ${this.ws} AND thread_id = ${e.thread_id}))
      RETURNING id, created_at`;return await t`
      UPDATE harness_shared.coord_threads
         SET post_count = post_count + 1, last_post_at = ${e.created_ts}
       WHERE workspace_id = ${this.ws} AND thread_id = ${e.thread_id}`,{id:Number(i[0].id),thread_id:e.thread_id,author_id:e.author_id??null,body:e.body,created_ts:b(i[0].created_at)}}async listPosts(e,t={}){await this.opts.ensureSchema();let n=this.opts.getSql(),r=t.afterId??null;return(await n`
      SELECT id, thread_id, author_id, body, created_at
        FROM harness_shared.coord_thread_posts
       WHERE workspace_id = ${this.ws} AND thread_id = ${e}
         AND ${r==null?n`TRUE`:n`id > ${r}`}
       ORDER BY id ASC`).map(e=>({id:Number(e.id),thread_id:e.thread_id,author_id:e.author_id,body:e.body,created_ts:b(e.created_at)}))}async getThreadByParent(e){await this.opts.ensureSchema();let t=await this.opts.getSql()`
      SELECT thread_id, parent_kind, parent_ref, title, created_by, created_at, last_post_at, post_count
        FROM harness_shared.coord_threads
       WHERE workspace_id = ${this.ws} AND parent_kind = ${e.kind} AND parent_ref = ${e.ref}`;return t[0]?T(t[0]):null}async getThreadById(e){await this.opts.ensureSchema();let t=await this.opts.getSql()`
      SELECT thread_id, parent_kind, parent_ref, title, created_by, created_at, last_post_at, post_count
        FROM harness_shared.coord_threads
       WHERE workspace_id = ${this.ws} AND thread_id = ${e}`;return t[0]?T(t[0]):null}}})),M=e((()=>{v(),y(),j(),u(),_()}));export{A as a,m as c,p as d,k as i,g as l,D as n,E as o,O as r,j as s,M as t,d as u};