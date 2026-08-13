import{n as o}from"./chunk-ChpBd9eV.js";import{t as y,w as D}from"./core-DKHauaoa.js";import{n as A}from"./pg-log-CSjhEHvU.js";function T(e){return`${e.kind}\0${e.ref}`}var c,E=o((()=>{c="tagged"})),n,S,R=o((()=>{E(),n="topic",S=class{links;now;constructor(e,t=()=>new Date().toISOString()){this.links=e,this.now=t}async addTag(e,t,s){await this.links.link(e,{kind:n,ref:t},c,{created_by:s.created_by,created_ts:s.created_ts})}async removeTag(e,t){await this.links.unlink(e,{kind:n,ref:t},c)}async listTags(e){return(await this.links.listOut(e,{rel:c})).filter(t=>t.dst.kind===n).map(t=>t.dst.ref)}async listTagsForMany(e){const t=new Map;if(e.length===0)return t;const s=await this.links.listOutMany(e,{rel:c});for(const i of s){if(i.dst.kind!==n)continue;const a=T(i.src),r=t.get(a);r?r.push(i.dst.ref):t.set(a,[i.dst.ref])}return t}async listTagged(e){return(await this.links.listIn({kind:n,ref:e},{rel:c})).map(t=>t.src)}}})),w=o((()=>{E(),R()}));function v(e){return`${e.kind}:${e.ref}`}function p(e,t){const s=e.get(t.subscriber_id);if(!s){e.set(t.subscriber_id,t);return}const i=f[t.delivery_mode]>=f[s.delivery_mode]?t.delivery_mode:s.delivery_mode,a=s.via==="object"||t.via==="object"?"object":s.via;e.set(t.subscriber_id,{subscriber_id:t.subscriber_id,delivery_mode:i,via:a})}async function B(e,t){const s=new Map;for(const r of await t.subscriptions.listTargetSubscribers("object",v(e)))p(s,{subscriber_id:r.subscriber_id,delivery_mode:r.delivery_mode,via:"object"});const i=await t.tags.listTags(e),a=new Set;for(const r of i)a.add(await t.topics.resolve(r));for(const r of a)for(const d of await t.subscriptions.listTargetSubscribers("topic",r))p(s,{subscriber_id:d.subscriber_id,delivery_mode:d.delivery_mode,via:r});return[...s.values()]}var f,O=o((()=>{f={full:3,digest:2,mention:1,muted:0}})),$=o((()=>{O()})),L=o((()=>{w(),$()})),N=o((()=>{w()}));function _(e){return e instanceof Date?e.toISOString():new Date(e).toISOString()}function m(e){return e==null?null:_(e)}function k(e){return{slug:e.slug,title:e.title,description:e.description,created_by:e.created_by,merged_into:e.merged_into,created_ts:_(e.created_at)}}function u(e){return{id:Number(e.id),subscriber_id:e.subscriber_id,target_kind:e.target_kind,target_ref:e.target_ref,delivery_mode:e.delivery_mode,created_ts:_(e.created_at),expires_ts:m(e.expires_ts),follow_blockers:e.follow_blockers??!1,derived_from:e.derived_from_kind&&e.derived_from_ref?{kind:e.derived_from_kind,ref:e.derived_from_ref}:null}}function l(e){return{id:Number(e.id),src:{kind:e.src_kind,ref:e.src_ref},dst:{kind:e.dst_kind,ref:e.dst_ref},rel:e.rel,created_by:e.created_by,created_ts:_(e.created_at)}}function b(e){return{thread_id:e.thread_id,parent:{kind:e.parent_kind,ref:e.parent_ref},title:e.title,created_by:e.created_by,created_ts:_(e.created_at),last_post_ts:m(e.last_post_at),post_count:Number(e.post_count)}}var I,C,g,U,q,M=o((()=>{A(),y(),N(),I=class{opts;constructor(e){this.opts=e}get ws(){return this.opts.getWorkspaceId?.()?.trim()||(this.opts.workspaceId??"default")}async create(e){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_topics (workspace_id, slug, title, description, created_by, created_at)
      VALUES (${this.ws}, ${e.slug}, ${e.title??null}, ${e.description}, ${e.created_by??null}, ${e.created_ts})
      ON CONFLICT (workspace_id, slug) DO NOTHING`;const t=await this.get(e.slug);if(!t)throw new Error(`coord_topics: failed to read back topic ${e.slug}`);return t}async list(e={}){await this.opts.ensureSchema();const t=this.opts.getSql();return(await t`
      SELECT slug, title, description, created_by, merged_into, created_at
        FROM harness_shared.coord_topics
       WHERE workspace_id = ${this.ws}
         AND ${e.includeMerged?t`TRUE`:t`merged_into IS NULL`}
       ORDER BY created_at ASC, slug ASC`).map(k)}async get(e){await this.opts.ensureSchema();const t=await this.opts.getSql()`
      SELECT slug, title, description, created_by, merged_into, created_at
        FROM harness_shared.coord_topics
       WHERE workspace_id = ${this.ws} AND slug = ${e}`;return t[0]?k(t[0]):null}async merge(e,t){e!==t&&(await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_topics
         SET merged_into = ${t}
       WHERE workspace_id = ${this.ws} AND slug = ${e}`)}async resolve(e){await this.opts.ensureSchema();const t=this.opts.getSql();let s=e;const i=new Set;for(let a=0;a<16&&!i.has(s);a++){i.add(s);const r=(await t`
        SELECT merged_into FROM harness_shared.coord_topics
         WHERE workspace_id = ${this.ws} AND slug = ${s}`)[0]?.merged_into;if(!r)return s;s=r}return s}},C=class{opts;constructor(e){this.opts=e}get ws(){return this.opts.getWorkspaceId?.()?.trim()||(this.opts.workspaceId??"default")}async subscribe(e){await this.opts.ensureSchema();const t=this.opts.getSql(),s=e.delivery_mode??"full";return u((await t`
      INSERT INTO harness_shared.coord_entity_subscriptions
        (workspace_id, subscriber_id, target_kind, target_ref, delivery_mode, expires_ts, created_at,
         follow_blockers, derived_from_kind, derived_from_ref)
      VALUES (${this.ws}, ${e.subscriber_id}, ${e.target_kind}, ${e.target_ref},
              ${s}, ${e.expires_ts??null}, ${e.created_ts}, ${e.follow_blockers??!1}, NULL, NULL)
      ON CONFLICT (workspace_id, subscriber_id, target_kind, target_ref) WHERE cancelled_at IS NULL
      DO UPDATE SET delivery_mode = EXCLUDED.delivery_mode, expires_ts = EXCLUDED.expires_ts,
                    follow_blockers = EXCLUDED.follow_blockers,
                    derived_from_kind = NULL, derived_from_ref = NULL
      RETURNING id, subscriber_id, target_kind, target_ref, delivery_mode, created_at, expires_ts,
                follow_blockers, derived_from_kind, derived_from_ref`)[0])}async subscribeDerived(e){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_entity_subscriptions
        (workspace_id, subscriber_id, target_kind, target_ref, delivery_mode, created_at,
         follow_blockers, derived_from_kind, derived_from_ref)
      VALUES (${this.ws}, ${e.subscriber_id}, 'object', ${`${e.target.kind}:${e.target.ref}`},
              ${e.delivery_mode??"full"}, ${e.created_ts}, FALSE,
              ${e.derived_from.kind}, ${e.derived_from.ref})
      ON CONFLICT (workspace_id, subscriber_id, target_kind, target_ref) WHERE cancelled_at IS NULL
      DO NOTHING`}async unsubscribeDerivedForEdge(e,t){await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_entity_subscriptions
         SET cancelled_at = now()
       WHERE workspace_id = ${this.ws} AND target_kind = 'object'
         AND target_ref = ${`${t.kind}:${t.ref}`}
         AND derived_from_kind = ${e.kind} AND derived_from_ref = ${e.ref}
         AND cancelled_at IS NULL`}async unsubscribeDerivedForDependent(e,t){await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_entity_subscriptions
         SET cancelled_at = now()
       WHERE workspace_id = ${this.ws} AND subscriber_id = ${e}
         AND derived_from_kind = ${t.kind} AND derived_from_ref = ${t.ref}
         AND cancelled_at IS NULL`}async unsubscribeDerivedForTarget(e){await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_entity_subscriptions
         SET cancelled_at = now()
       WHERE workspace_id = ${this.ws} AND target_kind = 'object'
         AND target_ref = ${`${e.kind}:${e.ref}`}
         AND derived_from_kind IS NOT NULL AND cancelled_at IS NULL`}async unsubscribe(e,t,s){await this.opts.ensureSchema(),await this.opts.getSql()`
      UPDATE harness_shared.coord_entity_subscriptions
         SET cancelled_at = now()
       WHERE workspace_id = ${this.ws} AND subscriber_id = ${e}
         AND target_kind = ${t} AND target_ref = ${s}
         AND cancelled_at IS NULL`}async listSubscriptions(e){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      SELECT id, subscriber_id, target_kind, target_ref, delivery_mode, created_at, expires_ts,
             follow_blockers, derived_from_kind, derived_from_ref
        FROM harness_shared.coord_entity_subscriptions
       WHERE workspace_id = ${this.ws} AND subscriber_id = ${e}
         AND cancelled_at IS NULL AND (expires_ts IS NULL OR expires_ts > now())
       ORDER BY created_at ASC, id ASC`).map(u)}async listTargetSubscribers(e,t){return await this.opts.ensureSchema(),(await this.opts.getSql()`
      SELECT id, subscriber_id, target_kind, target_ref, delivery_mode, created_at, expires_ts,
             follow_blockers, derived_from_kind, derived_from_ref
        FROM harness_shared.coord_entity_subscriptions
       WHERE workspace_id = ${this.ws} AND target_kind = ${e} AND target_ref = ${t}
         AND cancelled_at IS NULL AND (expires_ts IS NULL OR expires_ts > now())
       ORDER BY created_at ASC, id ASC`).map(u)}},g=class{opts;constructor(e){this.opts=e}get ws(){return this.opts.getWorkspaceId?.()?.trim()||(this.opts.workspaceId??"default")}async link(e,t,s,i){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_links
        (workspace_id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at)
      VALUES (${this.ws}, ${e.kind}, ${e.ref}, ${t.kind}, ${t.ref}, ${s}, ${i.created_by??null}, ${i.created_ts})
      ON CONFLICT (workspace_id, src_kind, src_ref, dst_kind, dst_ref, rel) DO NOTHING`}async unlink(e,t,s){await this.opts.ensureSchema(),await this.opts.getSql()`
      DELETE FROM harness_shared.coord_links
       WHERE workspace_id = ${this.ws} AND src_kind = ${e.kind} AND src_ref = ${e.ref}
         AND dst_kind = ${t.kind} AND dst_ref = ${t.ref} AND rel = ${s}`}async listOut(e,t={}){await this.opts.ensureSchema();const s=this.opts.getSql();return(await s`
      SELECT id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at
        FROM harness_shared.coord_links
       WHERE workspace_id = ${this.ws} AND src_kind = ${e.kind} AND src_ref = ${e.ref}
         AND ${t.rel==null?s`TRUE`:s`rel = ${t.rel}`}
       ORDER BY created_at ASC, id ASC`).map(l)}async listIn(e,t={}){await this.opts.ensureSchema();const s=this.opts.getSql();return(await s`
      SELECT id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at
        FROM harness_shared.coord_links
       WHERE workspace_id = ${this.ws} AND dst_kind = ${e.kind} AND dst_ref = ${e.ref}
         AND ${t.rel==null?s`TRUE`:s`rel = ${t.rel}`}
       ORDER BY created_at ASC, id ASC`).map(l)}async listOutMany(e,t={}){if(e.length===0)return[];await this.opts.ensureSchema();const s=this.opts.getSql(),i=new Map;for(const r of e){const d=i.get(r.kind);d?d.push(r.ref):i.set(r.kind,[r.ref])}const a=[];for(const[r,d]of i){const h=await s`
        SELECT id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at
          FROM harness_shared.coord_links
         WHERE workspace_id = ${this.ws} AND src_kind = ${r} AND src_ref = ANY(${d})
           AND ${t.rel==null?s`TRUE`:s`rel = ${t.rel}`}
         ORDER BY created_at ASC, id ASC`;a.push(...h.map(l))}return a}async listInMany(e,t={}){if(e.length===0)return[];await this.opts.ensureSchema();const s=this.opts.getSql(),i=new Map;for(const r of e){const d=i.get(r.kind);d?d.push(r.ref):i.set(r.kind,[r.ref])}const a=[];for(const[r,d]of i){const h=await s`
        SELECT id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by, created_at
          FROM harness_shared.coord_links
         WHERE workspace_id = ${this.ws} AND dst_kind = ${r} AND dst_ref = ANY(${d})
           AND ${t.rel==null?s`TRUE`:s`rel = ${t.rel}`}
         ORDER BY created_at ASC, id ASC`;a.push(...h.map(l))}return a}},U=class extends S{constructor(e){super(new g(e))}},q=class{opts;constructor(e){this.opts=e}get ws(){return this.opts.getWorkspaceId?.()?.trim()||(this.opts.workspaceId??"default")}async getOrCreateThread(e,t){await this.opts.ensureSchema(),await this.opts.getSql()`
      INSERT INTO harness_shared.coord_threads
        (workspace_id, thread_id, parent_kind, parent_ref, title, created_by, created_at, harness_slug)
      VALUES (${this.ws}, ${t.thread_id}, ${e.kind}, ${e.ref}, ${t.title??null}, ${t.created_by??null}, ${t.created_ts}, ${t.harness_slug??null})
      ON CONFLICT DO NOTHING`;const s=await this.getThreadByParent(e)??await this.getThreadById(t.thread_id);if(!s)throw new Error(`coord_threads: failed to read back thread for ${e.kind}:${e.ref} / ${t.thread_id}`);return s}async addPost(e){await this.opts.ensureSchema();const t=this.opts.getSql(),s=D(),i=await t`
      INSERT INTO harness_shared.coord_thread_posts (workspace_id, thread_id, author_id, body, created_at, post_msg_id, harness_slug)
      VALUES (${this.ws}, ${e.thread_id}, ${e.author_id??null}, ${e.body}, ${e.created_ts}, ${s},
        (SELECT harness_slug FROM harness_shared.coord_threads WHERE workspace_id = ${this.ws} AND thread_id = ${e.thread_id}))
      RETURNING id, created_at`;return await t`
      UPDATE harness_shared.coord_threads
         SET post_count = post_count + 1, last_post_at = ${e.created_ts}
       WHERE workspace_id = ${this.ws} AND thread_id = ${e.thread_id}`,{id:Number(i[0].id),thread_id:e.thread_id,author_id:e.author_id??null,body:e.body,created_ts:_(i[0].created_at)}}async listPosts(e,t={}){await this.opts.ensureSchema();const s=this.opts.getSql(),i=t.afterId??null;return(await s`
      SELECT id, thread_id, author_id, body, created_at
        FROM harness_shared.coord_thread_posts
       WHERE workspace_id = ${this.ws} AND thread_id = ${e}
         AND ${i==null?s`TRUE`:s`id > ${i}`}
       ORDER BY id ASC`).map(a=>({id:Number(a.id),thread_id:a.thread_id,author_id:a.author_id,body:a.body,created_ts:_(a.created_at)}))}async listRecentPosts(e,t){await this.opts.ensureSchema();const s=this.opts.getSql(),i=Math.max(1,Math.floor(t)),a=await s`
      SELECT id, thread_id, author_id, body, created_at, COUNT(*) OVER () AS total
        FROM harness_shared.coord_thread_posts
       WHERE workspace_id = ${this.ws} AND thread_id = ${e}
       ORDER BY id DESC
       LIMIT ${i}`;return a.length===0?{posts:[],total:0}:{posts:a.slice().reverse().map(r=>({id:Number(r.id),thread_id:r.thread_id,author_id:r.author_id,body:r.body,created_ts:_(r.created_at)})),total:Number(a[0].total)}}async getThreadByParent(e){await this.opts.ensureSchema();const t=await this.opts.getSql()`
      SELECT thread_id, parent_kind, parent_ref, title, created_by, created_at, last_post_at, post_count
        FROM harness_shared.coord_threads
       WHERE workspace_id = ${this.ws} AND parent_kind = ${e.kind} AND parent_ref = ${e.ref}`;return t[0]?b(t[0]):null}async getThreadById(e){await this.opts.ensureSchema();const t=await this.opts.getSql()`
      SELECT thread_id, parent_kind, parent_ref, title, created_by, created_at, last_post_at, post_count
        FROM harness_shared.coord_threads
       WHERE workspace_id = ${this.ws} AND thread_id = ${e}`;return t[0]?b(t[0]):null}}})),Y=o((()=>{L(),N(),M(),w(),$()}));export{q as a,O as c,E as d,T as f,U as i,v as l,C as n,I as o,g as r,M as s,Y as t,B as u};
