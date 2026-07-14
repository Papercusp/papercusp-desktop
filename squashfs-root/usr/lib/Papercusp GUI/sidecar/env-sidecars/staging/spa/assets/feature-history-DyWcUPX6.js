import{n as e}from"./chunk-CMxvf4Kt.js";async function t(e){if(!e.pg||!e.workspaceId)return``;let t=e.notesMaxChars??4e3,c=e.debugMaxChars??4e3,l=e.auditRows??10,u=e.relatedMax??5,d=e.messagesMax??10,f=e.pg,p=e.workspaceId,m=e.harnessSlug,h=e.featureId,g=`harness_${m.replace(/-/g,`_`)}`,[_,v,y,b,x]=await Promise.all([f`
      SELECT content, updated_at
        FROM harness_shared.harness_feature_notes
       WHERE workspace_id = ${p} AND harness_slug = ${m} AND feature_id = ${h}
       LIMIT 1
    `.catch(()=>[]),f`
      SELECT content, mtime_ms
        FROM harness_shared.harness_feature_debug_notes
       WHERE workspace_id = ${p} AND harness_slug = ${m} AND feature_id = ${h}
       LIMIT 1
    `.catch(()=>[]),f`
      SELECT ts, field, old_value, new_value, actor
        FROM harness_shared.feature_audit_consolidated
       WHERE workspace_id = ${p} AND harness_slug = ${m} AND feature_id = ${h}
       ORDER BY ts DESC
       LIMIT ${l}
    `.catch(()=>[]),n(f,m,h,u).catch(()=>[]),i(f,g,h,d).catch(()=>[])]),S=[];if(_.length>0&&typeof _[0].content==`string`&&_[0].content.trim().length>0&&(S.push(`### Notes`),S.push(o(_[0].content,t))),v.length>0&&typeof v[0].content==`string`&&v[0].content.trim().length>0&&(S.push(`### Debugger findings`),S.push(o(v[0].content,c))),y.length>0){S.push(`### Recent activity`);for(let e of y)S.push(s(e))}if(b.length>0){S.push(`### Related features`);for(let e of b)S.push(r(e))}if(x.length>0){S.push(`### Messages from other features`);for(let e of x)S.push(a(e))}return S.length===0?``:[`## This feature's history (${h})`,...S].join(`
`)}async function n(e,t,n,r){let i=await e`
    SELECT tags, see_also
      FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${t} AND feature_id = ${n}
     LIMIT 1
  `;if(i.length===0)return[];let a=Array.isArray(i[0].tags)?i[0].tags.filter(e=>typeof e==`string`):[],o=Array.isArray(i[0].see_also)?i[0].see_also:[];return a.length===0&&o.length===0?[]:e`
    SELECT feature_id, title, status,
           (SELECT array_agg(value) FROM jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb))) AS tags,
           CASE
             WHEN feature_id = ANY(${o}::text[]) AND tags ?| ${a}::text[] THEN 'both'
             WHEN feature_id = ANY(${o}::text[]) THEN 'see_also'
             ELSE 'tag'
           END AS relation_kind
      FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${t}
       AND feature_id <> ${n}
       AND (
         feature_id = ANY(${o}::text[])
         OR (${a.length>0}::boolean AND tags ?| ${a}::text[])
       )
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT ${r}
  `}function r(e){let t=(e.tags??[]).join(`, `),n=t?` [${t}]`:``,r=e.relation_kind===`both`?` (tag+see-also)`:e.relation_kind===`see_also`?` (see-also)`:` (tag)`;return`- \`${e.feature_id}\` (${e.status})${n} — ${e.title}${r}`}async function i(e,t,n,r){let i=`
    SELECT id, created_at, from_slug, from_feature_id, kind, subject, body
      FROM ${t}.messages
     WHERE to_feature_id = $1
       AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT $2
  `,a=e;return typeof a.unsafe==`function`?a.unsafe(i,[n,r]):[]}function a(e){let t=typeof e.created_at==`string`||typeof e.created_at==`number`?new Date(e.created_at).toISOString().replace(/\.\d{3}Z$/,`Z`):e.created_at instanceof Date?e.created_at.toISOString().replace(/\.\d{3}Z$/,`Z`):String(e.created_at),n=e.from_feature_id?`${e.from_slug}/${e.from_feature_id}`:e.from_slug,r=(e.body??``).slice(0,400);return`- ${t} from \`${n}\` [${e.kind}] **${e.subject}**\n  ${r}`}function o(e,t){return e.length<=t?e:e.slice(0,t)+`

[…truncated, exceeded `+t+` chars]`}function s(e){let t=new Date(Number(e.ts)).toISOString().replace(/\.\d{3}Z$/,`Z`),n=c(e.old_value),r=c(e.new_value),i=n===``?`→ ${r}`:`${n} → ${r}`;return`- ${t} \`${e.field}\` ${i} (${e.actor})`}function c(e){return e==null?``:typeof e==`string`&&e.length>=2&&e.startsWith(`"`)&&e.endsWith(`"`)?e.slice(1,-1):e}e((()=>{}))();export{t as fetchFeatureHistory};