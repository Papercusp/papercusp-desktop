import{n as r}from"./chunk-ChpBd9eV.js";import{st as _,t as n}from"./src-8fWtxfEz.js";function E(){return!!{}.VITEST}async function O(s,i){const e=i??_().sql,t=Date.now(),a=s.origin??(E()?"test":"real");await e`
    INSERT INTO harness_shared.boot_history_events
      (workspace_id, harness_slug, kind, message, ts, created_ts, origin)
    VALUES
      (${s.workspaceId}, ${s.harnessSlug}, ${s.kind}, ${s.message??null},
       ${s.ts}, ${t}, ${a})
  `,await e`
    DELETE FROM harness_shared.boot_history_events
    WHERE workspace_id = ${s.workspaceId}
      AND harness_slug = ${s.harnessSlug}
      AND id IN (
        SELECT id FROM harness_shared.boot_history_events
        WHERE workspace_id = ${s.workspaceId}
          AND harness_slug = ${s.harnessSlug}
        ORDER BY created_ts DESC, id DESC
        OFFSET ${o}
      )
  `}var o,c=r((()=>{n(),o=Number({}.PAPERCUSP_BOOT_HISTORY_PG_CAP)||2e3}));c();export{O as insertBootHistoryEventPg};
