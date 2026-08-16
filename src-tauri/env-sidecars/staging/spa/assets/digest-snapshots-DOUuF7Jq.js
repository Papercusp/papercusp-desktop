import{n as c}from"./chunk-ChpBd9eV.js";import{st as r,t as _}from"./src-8fWtxfEz.js";import{c as d,r as i}from"./workspace-registry-Du2UbhlH.js";import{c as E,l as g}from"./lenses-B9ZkYICQ.js";async function m(s){const t=s.workspaceId??i(),{sql:e}=r();await e`
    INSERT INTO harness_shared.scout_digest_snapshots
      (workspace_id, install_slug, cycle_id, watermark_at, digest)
    VALUES (${t}, ${s.installSlug??null}, ${s.cycleId??null},
            ${s.watermarkAt?s.watermarkAt.toISOString():null},
            ${JSON.stringify(s.digest)}::text::jsonb)`,await e`
    DELETE FROM harness_shared.scout_digest_snapshots
     WHERE workspace_id = ${t}
       AND id NOT IN (
         SELECT id FROM harness_shared.scout_digest_snapshots
          WHERE workspace_id = ${t}
          ORDER BY created_at DESC
          LIMIT ${n})`}async function f(s={}){const t=s.workspaceId??i(),{sql:e}=r(),a=(await e`
    SELECT digest
      FROM harness_shared.scout_digest_snapshots
     WHERE workspace_id = ${t}
     ORDER BY created_at DESC
     LIMIT 1`)[0]?.digest;if(!a||typeof a!="object")return new Set;try{return new Set(E(a).map(o=>o.ref))}catch{return new Set}}var n,l=c((()=>{_(),d(),g(),n=30}));l();export{m as persistDigestSnapshot,f as readPreviousSnapshotRefs};
