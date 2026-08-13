import{n as m}from"./chunk-ChpBd9eV.js";async function I(e){if(!e.pg||!e.workspaceId)return"";const t=e.notesMaxChars??4e3,s=e.debugMaxChars??4e3,a=e.auditRows??10,r=e.relatedMax??5,c=e.messagesMax??10,o=e.pg,u=e.workspaceId,d=e.harnessSlug,i=e.featureId,S=`harness_${d.replace(/-/g,"_")}`,[_,l,g,h,$]=await Promise.all([o`
      SELECT content, updated_at
        FROM harness_shared.harness_feature_notes
       WHERE workspace_id = ${u} AND harness_slug = ${d} AND feature_id = ${i}
       LIMIT 1
    `.catch(()=>[]),o`
      SELECT content, mtime_ms
        FROM harness_shared.harness_feature_debug_notes
       WHERE workspace_id = ${u} AND harness_slug = ${d} AND feature_id = ${i}
       LIMIT 1
    `.catch(()=>[]),o`
      SELECT ts, field, old_value, new_value, actor
        FROM harness_shared.feature_audit_consolidated
       WHERE workspace_id = ${u} AND harness_slug = ${d} AND feature_id = ${i}
       ORDER BY ts DESC
       LIMIT ${a}
    `.catch(()=>[]),A(o,d,i,r).catch(()=>[]),p(o,S,i,c).catch(()=>[])]),n=[];if(_.length>0&&typeof _[0].content=="string"&&_[0].content.trim().length>0&&(n.push("### Notes"),n.push(E(_[0].content,t))),l.length>0&&typeof l[0].content=="string"&&l[0].content.trim().length>0&&(n.push("### Debugger findings"),n.push(E(l[0].content,s))),g.length>0){n.push("### Recent activity");for(const f of g)n.push(D(f))}if(h.length>0){n.push("### Related features");for(const f of h)n.push(M(f))}if($.length>0){n.push("### Messages from other features");for(const f of $)n.push(y(f))}return n.length===0?"":[`## This feature's history (${i})`,...n].join(`
`)}async function A(e,t,s,a){const r=await e`
    SELECT tags, see_also
      FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${t} AND feature_id = ${s}
     LIMIT 1
  `;if(r.length===0)return[];const c=Array.isArray(r[0].tags)?r[0].tags.filter(u=>typeof u=="string"):[],o=Array.isArray(r[0].see_also)?r[0].see_also:[];return c.length===0&&o.length===0?[]:e`
    SELECT feature_id, title, status,
           (SELECT array_agg(value) FROM jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb))) AS tags,
           CASE
             WHEN feature_id = ANY(${o}::text[]) AND tags ?| ${c}::text[] THEN 'both'
             WHEN feature_id = ANY(${o}::text[]) THEN 'see_also'
             ELSE 'tag'
           END AS relation_kind
      FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${t}
       AND feature_id <> ${s}
       AND (
         feature_id = ANY(${o}::text[])
         OR (${c.length>0}::boolean AND tags ?| ${c}::text[])
       )
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT ${a}
  `}function M(e){const t=(e.tags??[]).join(", "),s=t?` [${t}]`:"",a=e.relation_kind==="both"?" (tag+see-also)":e.relation_kind==="see_also"?" (see-also)":" (tag)";return`- \`${e.feature_id}\` (${e.status})${s} — ${e.title}${a}`}async function p(e,t,s,a){const r=`
    SELECT id, created_at, from_slug, from_feature_id, kind, subject, body
      FROM ${t}.messages
     WHERE to_feature_id = $1
       AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT $2
  `,c=e;return typeof c.unsafe!="function"?[]:c.unsafe(r,[s,a])}function y(e){const t=typeof e.created_at=="string"||typeof e.created_at=="number"?new Date(e.created_at).toISOString().replace(/\.\d{3}Z$/,"Z"):e.created_at instanceof Date?e.created_at.toISOString().replace(/\.\d{3}Z$/,"Z"):String(e.created_at),s=e.from_feature_id?`${e.from_slug}/${e.from_feature_id}`:e.from_slug,a=(e.body??"").slice(0,400);return`- ${t} from \`${s}\` [${e.kind}] **${e.subject}**
  ${a}`}function E(e,t){return e.length<=t?e:e.slice(0,t)+`

[…truncated, exceeded `+t+" chars]"}function D(e){const t=new Date(Number(e.ts)).toISOString().replace(/\.\d{3}Z$/,"Z"),s=R(e.old_value),a=R(e.new_value),r=s===""?`→ ${a}`:`${s} → ${a}`;return`- ${t} \`${e.field}\` ${r} (${e.actor})`}function R(e){return e==null?"":typeof e=="string"&&e.length>=2&&e.startsWith('"')&&e.endsWith('"')?e.slice(1,-1):e}var N=m((()=>{}));N();export{I as fetchFeatureHistory};
