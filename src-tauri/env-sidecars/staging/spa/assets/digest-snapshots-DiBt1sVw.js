import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CRqYcphb.js";import{n as r,s as i}from"./workspace-registry-Bu1Yy540.js";import{c as a,s as o}from"./lenses-BDxwepOL.js";async function s(e){let n=e.workspaceId??r(),{sql:i}=t();await i`
    INSERT INTO harness_shared.scout_digest_snapshots
      (workspace_id, install_slug, cycle_id, watermark_at, digest)
    VALUES (${n}, ${e.installSlug??null}, ${e.cycleId??null},
            ${e.watermarkAt?e.watermarkAt.toISOString():null},
            ${JSON.stringify(e.digest)}::jsonb)`,await i`
    DELETE FROM harness_shared.scout_digest_snapshots
     WHERE workspace_id = ${n}
       AND id NOT IN (
         SELECT id FROM harness_shared.scout_digest_snapshots
          WHERE workspace_id = ${n}
          ORDER BY created_at DESC
          LIMIT ${l})`}async function c(e={}){let n=e.workspaceId??r(),{sql:i}=t(),a=(await i`
    SELECT digest
      FROM harness_shared.scout_digest_snapshots
     WHERE workspace_id = ${n}
     ORDER BY created_at DESC
     LIMIT 1`)[0]?.digest;if(!a||typeof a!=`object`)return new Set;try{return new Set(o(a).map(e=>e.ref))}catch{return new Set}}var l;e((()=>{n(),i(),a(),l=30}))();export{s as persistDigestSnapshot,c as readPreviousSnapshotRefs};