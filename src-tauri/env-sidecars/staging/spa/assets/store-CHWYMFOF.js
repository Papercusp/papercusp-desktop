import{n as e}from"./chunk-CMxvf4Kt.js";import{t}from"./src-DWIWFn85.js";var n,r=e((()=>{t(),n=class{sql;workspaceId;harnessSlug;constructor(e,t,n){this.sql=e,this.workspaceId=t,this.harnessSlug=n}async getParts(e){let t=await this.sql`
      SELECT part_key, kind, body, ordinal, fed_ts, author, tombstone
        FROM harness_shared.harness_plan_parts
       WHERE workspace_id = ${this.workspaceId}
         AND harness_slug = ${this.harnessSlug}
         AND plan_slug = ${e}
    `,n=new Map;for(let e of t)n.set(e.part_key,{key:e.part_key,kind:e.kind,text:e.body,order:e.ordinal,fedTs:Number(e.fed_ts),...e.author==null?{}:{author:e.author},...e.tombstone?{tombstone:!0}:{}});return n}async upsertPart(e,t,n=`local`){await this.sql`
      INSERT INTO harness_shared.harness_plan_parts
        (workspace_id, harness_slug, plan_slug, part_key, kind, body, ordinal, fed_ts, author, tombstone, origin)
      VALUES
        (${this.workspaceId}, ${this.harnessSlug}, ${e}, ${t.key}, ${t.kind},
         ${t.text}, ${t.order}, ${t.fedTs}, ${t.author??null}, ${t.tombstone??!1}, ${n})
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
    `}}}));export{r as n,n as t};