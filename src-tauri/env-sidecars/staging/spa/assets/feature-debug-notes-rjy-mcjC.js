import{n as c,o as s}from"./chunk-ChpBd9eV.js";import{t as n}from"./__vite-browser-external-56mrcCg8.js";async function f(e){if(!e.pg||!e.workspaceId)return{captured:!1,bytes:0};const t=(0,a.join)(e.stateDir,"debug",`${e.featureId}.md`);if(!(0,_.existsSync)(t))return{captured:!1,bytes:0};let r;try{r=(0,_.readFileSync)(t,"utf8")}catch{return{captured:!1,bytes:0}}if(!r.trim())return{captured:!1,bytes:0};try{const i=Date.now();return await e.pg`
      INSERT INTO harness_shared.harness_feature_debug_notes
        (workspace_id, harness_slug, feature_id, content, mtime_ms)
      VALUES
        (${e.workspaceId}, ${e.harnessSlug}, ${e.featureId}, ${r}, ${i})
      ON CONFLICT (workspace_id, harness_slug, feature_id)
      DO UPDATE SET content = EXCLUDED.content, mtime_ms = EXCLUDED.mtime_ms
    `,{captured:!0,bytes:r.length}}catch{return{captured:!1,bytes:0}}}async function l(e){const t=(0,a.join)(e.stateDir,"debug",`${e.featureId}.md`);if(!e.pg||!e.workspaceId)return{written:!1,path:t};try{const r=(await e.pg`
      SELECT content
        FROM harness_shared.harness_feature_debug_notes
       WHERE workspace_id = ${e.workspaceId}
         AND harness_slug = ${e.harnessSlug}
         AND feature_id = ${e.featureId}
       LIMIT 1
    `)[0]?.content;return typeof r!="string"||!r.trim()?{written:!1,path:t}:(await(0,o.mkdir)((0,a.dirname)(t),{recursive:!0}),await(0,o.writeFile)(t,r,"utf8"),{written:!0,path:t})}catch{return{written:!1,path:t}}}var _,o,a,m=c((()=>{_=s(n(),1),o=s(n(),1),a=s(n(),1)}));export{m as n,l as r,f as t};
