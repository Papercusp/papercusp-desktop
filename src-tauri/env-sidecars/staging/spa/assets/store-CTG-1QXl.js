import{n as e}from"./chunk-ChpBd9eV.js";import{t as n}from"./src-BB4lVSvl.js";var o,h=e((()=>{n(),o=class{sql;workspaceId;harnessSlug;constructor(t,s,a){this.sql=t,this.workspaceId=s,this.harnessSlug=a}async getParts(t){const s=await this.sql`
      SELECT part_key, kind, body, ordinal, fed_ts, author, tombstone
        FROM harness_shared.harness_plan_parts
       WHERE workspace_id = ${this.workspaceId}
         AND harness_slug = ${this.harnessSlug}
         AND plan_slug = ${t}
    `,a=new Map;for(const r of s)a.set(r.part_key,{key:r.part_key,kind:r.kind,text:r.body,order:r.ordinal,fedTs:Number(r.fed_ts),...r.author!=null?{author:r.author}:{},...r.tombstone?{tombstone:!0}:{}});return a}async upsertPart(t,s,a="local"){await this.sql`
      INSERT INTO harness_shared.harness_plan_parts
        (workspace_id, harness_slug, plan_slug, part_key, kind, body, ordinal, fed_ts, author, tombstone, origin)
      VALUES
        (${this.workspaceId}, ${this.harnessSlug}, ${t}, ${s.key}, ${s.kind},
         ${s.text}, ${s.order}, ${s.fedTs}, ${s.author??null}, ${s.tombstone??!1}, ${a})
      ON CONFLICT (workspace_id, harness_slug, plan_slug, part_key) DO UPDATE SET
        kind      = EXCLUDED.kind,
        body      = EXCLUDED.body,
        ordinal   = EXCLUDED.ordinal,
        fed_ts    = EXCLUDED.fed_ts,
        author    = EXCLUDED.author,
        tombstone = EXCLUDED.tombstone,
        origin    = EXCLUDED.origin
      WHERE EXCLUDED.fed_ts > harness_shared.harness_plan_parts.fed_ts
         OR (EXCLUDED.fed_ts = harness_shared.harness_plan_parts.fed_ts
             AND COALESCE(EXCLUDED.author, '') > COALESCE(harness_shared.harness_plan_parts.author, ''))
    `}}}));export{h as n,o as t};
