import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,r as n,t as r}from"./categories-Cc2AsxTG.js";import{a as i,i as a,n as o,r as s}from"./policy-BS1jtsHb.js";function c(e){let t=e.category,n=a(e.ceiling)?e.ceiling:`never-auto`,r=a(e.graduated_level)?e.graduated_level:`never-auto`;return{category:t,ceiling:n,locked:!!e.locked,graduatedLevel:i(r,n),thresholdOverrides:e.threshold_overrides??{},ownerOverride:e.owner_override??null}}async function l(e,t){let i=new Map;try{let r=await e`
      SELECT category, ceiling, locked, graduated_level, threshold_overrides, owner_override
        FROM harness_shared.autonomy_policy
       WHERE workspace_id = ${t}`;for(let e of r)n(e.category)&&i.set(e.category,c(e))}catch(e){if(e.code!==p)throw e}return r.map(e=>i.get(e)??o(e))}async function u(e,t,r){let i=r;if(!n(r))return o(i);try{let i=await e`
      SELECT category, ceiling, locked, graduated_level, threshold_overrides, owner_override
        FROM harness_shared.autonomy_policy
       WHERE workspace_id = ${t} AND category = ${r}
       LIMIT 1`;if(i.length>0&&n(i[0].category))return c(i[0])}catch(e){if(e.code!==p)throw e}return o(i)}async function d(e,t,r,o){if(!n(r.category))throw Error(`autonomy:policy_set — unknown category "${r.category}"`);if(r.ceiling!==void 0&&!a(r.ceiling))throw Error(`autonomy:policy_set — invalid ceiling "${r.ceiling}"`);if(r.graduatedLevel!==void 0&&!a(r.graduatedLevel))throw Error(`autonomy:policy_set — invalid graduated_level "${r.graduatedLevel}"`);let s=r.category,c=await u(e,t,s),l=r.ceiling??c.ceiling,d=r.locked??c.locked,p=i(r.graduatedLevel??c.graduatedLevel,l),m=r.thresholdOverrides??c.thresholdOverrides,h=r.ownerOverride===void 0?c.ownerOverride:r.ownerOverride;return await e`
    INSERT INTO harness_shared.autonomy_policy
      (workspace_id, category, ceiling, locked, graduated_level, threshold_overrides, owner_override, updated_by, updated_at)
    VALUES (${t}, ${s}, ${l}, ${d}, ${p},
            ${JSON.stringify(m)}::text::jsonb,
            ${h==null?null:JSON.stringify(h)}::text::jsonb,
            ${o}, now())
    ON CONFLICT (workspace_id, category) DO UPDATE SET
      ceiling = EXCLUDED.ceiling,
      locked = EXCLUDED.locked,
      graduated_level = EXCLUDED.graduated_level,
      threshold_overrides = EXCLUDED.threshold_overrides,
      owner_override = EXCLUDED.owner_override,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at`,await f(e,o,`autonomy:policy_set`,s,t,{ceiling:l,locked:d,graduatedLevel:p,...r.reason?{reason:r.reason}:{}}),{category:s,ceiling:l,locked:d,graduatedLevel:p,thresholdOverrides:m,ownerOverride:h}}async function f(e,t,n,r,i,a){try{await e`
      INSERT INTO harness_shared.audit_log (id, ts, actor, action, subject, details, workspace_id)
      VALUES (${`aut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}, ${Date.now()}, ${t}, ${n}, ${r},
              ${JSON.stringify(a??{})}::text::jsonb, ${i})`}catch(e){console.warn(`[autonomy] audit write failed:`,e?.message)}}var p;e((()=>{t(),s(),p=`42P01`}))();export{u as getAutonomyCategoryPolicy,l as readAutonomyPolicy,d as setAutonomyPolicy};