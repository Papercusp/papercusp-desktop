import{n as e}from"./chunk-CMxvf4Kt.js";import{u as t}from"./src-DW7JHyJi.js";import{U as n,t as r}from"./src-CwW4br4q.js";import{S as i,d as a}from"./source-C3EgMhmt.js";import{t as o}from"./content-hash-CwP8ZrEj.js";function s(e){return e.source===`principal`?`human`:`agent`}async function c(e){try{let r=t(e.content),a=s(e.identity),o=Date.now(),c=e.harnessSlug?.trim(),l=e.workspaceId?.trim(),{workspaceId:u,harnessSlug:d}=await i({...c?{harnessSlug:c}:{},...l?{workspaceId:l}:{}});return{seq:await n(u,async t=>{let n=await t`
        INSERT INTO harness_shared.plan_revisions (
          workspace_id, harness_slug, plan_slug, seq, content_hash, content_snapshot, rationale,
          author_kind, author_id, session_id, session_kind, created_at
        )
        SELECT
          ${u},
          ${d},
          ${e.planSlug},
          COALESCE(MAX(seq), 0) + 1,
          ${r},
          ${e.content},
          ${e.rationale??null},
          ${a},
          ${e.identity.ownerId},
          ${e.sessionId??null},
          ${e.sessionKind??null},
          ${o}
        FROM harness_shared.plan_revisions
        WHERE workspace_id = ${u}
          AND harness_slug = ${d} AND plan_slug = ${e.planSlug}
        RETURNING seq
      `;return Number(n[0].seq)}),contentHash:r}}catch(t){return console.warn(`[plan_revisions] failed to record revision for ${e.planSlug}: `+(t instanceof Error?t.message:String(t))),null}}function l(e,t){let n=e.length,r=t.length;if(n===0||r===0)return 0;let i=Array(r+1).fill(0);for(let a=1;a<=n;a++){let n=Array(r+1).fill(0);for(let o=1;o<=r;o++)n[o]=e[a-1]===t[o-1]?(i[o-1]??0)+1:Math.max(i[o]??0,n[o-1]??0);i=n}return i[r]??0}function u(e,t){let n=e.length>0?e.split(`
`):[],r=t.length>0?t.split(`
`):[],i=l(n,r);return{added:r.length-i,removed:n.length-i}}async function d(e,t={}){let{workspaceId:r,harnessSlug:a}=await i(t),o=await n(r,async t=>t`
      SELECT id, seq, content_hash, content_snapshot, rationale,
             author_kind, author_id, session_id, session_kind, created_at
      FROM harness_shared.plan_revisions
      WHERE workspace_id = ${r}
        AND harness_slug = ${a} AND plan_slug = ${e}
      ORDER BY seq ASC
    `),s=[],c=``;for(let e of o)s.push({id:Number(e.id),seq:Number(e.seq),contentHash:e.content_hash,rationale:e.rationale,authorKind:e.author_kind,authorId:e.author_id,sessionId:e.session_id,sessionKind:e.session_kind,createdAt:Number(e.created_at),diffStat:u(c,e.content_snapshot)}),c=e.content_snapshot;return s.reverse(),s}var f=e((()=>{r(),a(),o()}));export{d as n,c as r,f as t};