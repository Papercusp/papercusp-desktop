import{n as u}from"./chunk-ChpBd9eV.js";import{st as g,t as N}from"./src-8fWtxfEz.js";function _(e,a){return e`COALESCE(jsonb_typeof(tags) = 'array' AND tags ? ${a}, false)`}function E(e,a){return e`COALESCE(jsonb_typeof(payload -> 'tags') = 'array' AND (payload -> 'tags') ? ${a}, false)`}async function A(e){const{sql:a}=g(),{id:t,workspaceId:n,topic:s}=e,i=e.remove===!0,l=!i;if(e.family==="feature"){if((i?await a`
          UPDATE harness_shared.harness_features_consolidated
             SET tags = CASE WHEN jsonb_typeof(tags) = 'array' THEN tags - ${s} ELSE '[]'::jsonb END,
                 updated_ts = ${Date.now()}
           WHERE workspace_id = ${n}
             AND ${e.harness?a`harness_slug = ${e.harness}`:a`TRUE`}
             AND feature_id = ${t}
             AND ${_(a,s)}
          RETURNING feature_id`:await a`
          UPDATE harness_shared.harness_features_consolidated
             SET tags = CASE WHEN jsonb_typeof(tags) = 'array' THEN tags ELSE '[]'::jsonb END
                        || to_jsonb(${s}::text),
                 updated_ts = ${Date.now()}
           WHERE workspace_id = ${n}
             AND ${e.harness?a`harness_slug = ${e.harness}`:a`TRUE`}
             AND feature_id = ${t}
             AND NOT ${_(a,s)}
          RETURNING feature_id`).length>0)return r("applied");const o=await a`
        SELECT ${_(a,s)} AS has_tag
          FROM harness_shared.harness_features_consolidated
         WHERE workspace_id = ${n}
           AND ${e.harness?a`harness_slug = ${e.harness}`:a`TRUE`}
           AND feature_id = ${t}`;return o.length===0?r("no-row"):r(o.every(p=>p.has_tag===l)?"already":"blocked")}if((i?await a`
        UPDATE harness_shared.engineer_issues
           SET payload = COALESCE(payload, '{}'::jsonb)
                         || jsonb_build_object('tags', (payload -> 'tags') - ${s}),
               origin = 'local',
               updated_at = now()
         WHERE workspace_id = ${n}
           AND issue_id = ${t}
           AND origin IS DISTINCT FROM 'remote'
           AND ${E(a,s)}
        RETURNING issue_id`:await a`
        UPDATE harness_shared.engineer_issues
           SET payload = COALESCE(payload, '{}'::jsonb)
                         || jsonb_build_object(
                              'tags',
                              CASE WHEN jsonb_typeof(payload -> 'tags') = 'array'
                                   THEN payload -> 'tags' ELSE '[]'::jsonb END
                              || to_jsonb(${s}::text)),
               origin = 'local',
               updated_at = now()
         WHERE workspace_id = ${n}
           AND issue_id = ${t}
           AND origin IS DISTINCT FROM 'remote'
           AND NOT ${E(a,s)}
        RETURNING issue_id`).length>0)return r("applied");const d=await a`
      SELECT origin, ${E(a,s)} AS has_tag
        FROM harness_shared.engineer_issues
       WHERE workspace_id = ${n}
         AND issue_id = ${t}`;return d.length===0?r("no-row"):d.some(o=>o.origin==="remote")?r("remote-origin"):r(d.every(o=>o.has_tag===l)?"already":"blocked")}var r,h=u((()=>{N(),r=e=>({outcome:e,mirrored:e==="applied"||e==="already",changed:e==="applied"})}));h();export{A as syncTopicTagToClaimTags};
