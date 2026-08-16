import{n as w}from"./chunk-ChpBd9eV.js";import{Q as c,t as f}from"./src-8fWtxfEz.js";import{C as g}from"./src-BB4lVSvl.js";import{d as E,s as S}from"./identity-HZdRK23v.js";import{t as R}from"./content-hash-CEklRgBJ.js";import{T as d,d as k}from"./source-BL7J0oFl.js";function N(s){return s.source==="principal"?"human":"agent"}async function m(s){try{const e=g(s.content),r=N(s.identity),n=Date.now(),a=s.harnessSlug?.trim(),i=s.workspaceId?.trim(),{workspaceId:o,harnessSlug:t}=await d({...a?{harnessSlug:a}:{},...i?{workspaceId:i}:{}});return{seq:await c(o,async l=>{const u=await l`
        INSERT INTO harness_shared.plan_revisions (
          workspace_id, harness_slug, plan_slug, seq, content_hash, content_snapshot, rationale,
          author_kind, author_id, session_id, session_kind, created_at
        )
        SELECT
          ${o},
          ${t},
          ${s.planSlug},
          COALESCE(MAX(seq), 0) + 1,
          ${e},
          ${s.content},
          ${s.rationale??null},
          ${r},
          ${s.identity.ownerId},
          ${s.sessionId??null},
          ${s.sessionKind??null},
          ${n}
        FROM harness_shared.plan_revisions
        WHERE workspace_id = ${o}
          AND harness_slug = ${t} AND plan_slug = ${s.planSlug}
        RETURNING seq
      `;return Number(u[0].seq)}),contentHash:e}}catch(e){return console.warn(`[plan_revisions] failed to record revision for ${s.planSlug}: `+(e instanceof Error?e.message:String(e))),null}}function $(s){const e=s.planRunSessionId;return typeof e=="string"&&e.length>0?{sessionId:e,sessionKind:"plan_run"}:{sessionId:null,sessionKind:null}}function O(s,e,r,n={}){let a=null;try{a=E(s)}catch{a=null}const i=a,o=$(s),t={current:null};return{afterWrite:i?async(l,u)=>{const h=n.harnessSlug??u?.harnessSlug,p=n.workspaceId??u?.workspaceId;t.current=await m({planSlug:e,...h?{harnessSlug:h}:{},...p?{workspaceId:p}:{},content:l,rationale:r??null,identity:i,sessionId:o.sessionId,sessionKind:o.sessionKind})}:async()=>{},recorded:t}}function _(s){const e=s.workspaceId?.trim();if(!e)throw new Error("plan_revisions: workspaceId is required — revision rows are RLS-isolated per workspace. Resolve it via resolvePlanScope(opts) from the harness before calling. (No silent workspace default — workspace-data-isolation-leaks P-001.)");return e}function v(s,e){const r=s.length,n=e.length;if(r===0||n===0)return 0;let a=new Array(n+1).fill(0);for(let i=1;i<=r;i++){const o=new Array(n+1).fill(0);for(let t=1;t<=n;t++)o[t]=s[i-1]===e[t-1]?(a[t-1]??0)+1:Math.max(a[t]??0,o[t-1]??0);a=o}return a[n]??0}function I(s,e){const r=s.length>0?s.split(`
`):[],n=e.length>0?e.split(`
`):[],a=v(r,n);return{added:n.length-a,removed:r.length-a}}async function P(s,e={}){const{workspaceId:r,harnessSlug:n}=await d(e),a=await c(r,async t=>t`
      SELECT id, seq, content_hash, content_snapshot, rationale,
             author_kind, author_id, session_id, session_kind, created_at
      FROM harness_shared.plan_revisions
      WHERE workspace_id = ${r}
        AND harness_slug = ${n} AND plan_slug = ${s}
      ORDER BY seq ASC
    `),i=[];let o="";for(const t of a)i.push({id:Number(t.id),seq:Number(t.seq),contentHash:t.content_hash,rationale:t.rationale,authorKind:t.author_kind,authorId:t.author_id,sessionId:t.session_id,sessionKind:t.session_kind,createdAt:Number(t.created_at),diffStat:I(o,t.content_snapshot)}),o=t.content_snapshot;return i.reverse(),i}async function W(s,e={}){return c(_(e),async r=>{const n=(await r`
      SELECT id, plan_slug, seq, rationale, session_id, session_kind, created_at
      FROM harness_shared.plan_revisions
      WHERE id = ${s}
    `)[0];return n?{id:Number(n.id),planSlug:n.plan_slug,seq:Number(n.seq),rationale:n.rationale,sessionId:n.session_id,sessionKind:n.session_kind,createdAt:Number(n.created_at)}:null})}async function H(s,e={}){return c(_(e),async r=>{const n=await r`
      WITH target AS (
        SELECT workspace_id, harness_slug, plan_slug, seq
        FROM harness_shared.plan_revisions
        WHERE id = ${s}
      )
      SELECT r.id, r.plan_slug, r.seq, r.content_snapshot, r.created_at,
             (r.seq = (SELECT seq FROM target)) AS is_target
      FROM harness_shared.plan_revisions r, target t
      WHERE r.workspace_id = t.workspace_id
        AND r.harness_slug = t.harness_slug
        AND r.plan_slug = t.plan_slug
        AND r.seq IN (t.seq, t.seq - 1)
      ORDER BY r.seq DESC
    `,a=n.find(o=>o.is_target);if(!a)return null;const i=n.find(o=>!o.is_target);return{newer:{id:Number(a.id),planSlug:a.plan_slug,seq:Number(a.seq),contentSnapshot:a.content_snapshot,createdAt:Number(a.created_at)},older:i?{seq:Number(i.seq),contentSnapshot:i.content_snapshot,createdAt:Number(i.created_at)}:null}})}async function M(s,e,r={}){return c(_(r),async n=>(await n`
      UPDATE harness_shared.plan_revisions
      SET rationale = ${e}
      WHERE id = ${s} AND rationale IS NULL
      RETURNING id
    `).length>0)}async function K(s,e={}){const{workspaceId:r,harnessSlug:n}=await d(e);return c(r,async a=>{const i=await a`
      SELECT COUNT(*)::int AS n
      FROM harness_shared.plan_revisions
      WHERE workspace_id = ${r}
        AND harness_slug = ${n} AND plan_slug = ${s}
    `;return Number(i[0]?.n??0)})}async function F(s,e,r={}){const{workspaceId:n,harnessSlug:a}=await d(r);return c(n,async i=>{const o=await i`
      SELECT COUNT(*)::int AS n
      FROM harness_shared.plan_revisions
      WHERE workspace_id = ${n}
        AND harness_slug = ${a} AND plan_slug = ${s}
    `;if(Number(o[0]?.n??0)>0)return{inserted:0,skippedExisting:!0};let t=0;for(const l of e)t+=1,await i`
        INSERT INTO harness_shared.plan_revisions (
          workspace_id, harness_slug, plan_slug, seq, content_hash, content_snapshot, rationale,
          author_kind, author_id, session_id, session_kind, created_at
        ) VALUES (
          ${n}, ${a}, ${s}, ${t}, ${l.contentHash}, ${l.content}, ${l.rationale},
          'human', ${l.authorId}, NULL, 'git_backfill', ${l.createdAt}
        )
      `;return{inserted:t,skippedExisting:!1}})}var U=w((()=>{f(),k(),R(),S()}));export{F as a,m as c,U as i,M as l,W as n,P as o,H as r,O as s,K as t};
