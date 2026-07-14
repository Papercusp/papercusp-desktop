import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";async function r(e){if(!e.pg||!e.workspaceId)return{captured:!1,bytes:0};let t=(0,s.join)(e.stateDir,`debug`,`${e.featureId}.md`);if(!(0,a.existsSync)(t))return{captured:!1,bytes:0};let n;try{n=(0,a.readFileSync)(t,`utf8`)}catch{return{captured:!1,bytes:0}}if(!n.trim())return{captured:!1,bytes:0};try{let t=Date.now();return await e.pg`
      INSERT INTO harness_shared.harness_feature_debug_notes
        (workspace_id, harness_slug, feature_id, content, mtime_ms)
      VALUES
        (${e.workspaceId}, ${e.harnessSlug}, ${e.featureId}, ${n}, ${t})
      ON CONFLICT (workspace_id, harness_slug, feature_id)
      DO UPDATE SET content = EXCLUDED.content, mtime_ms = EXCLUDED.mtime_ms
    `,{captured:!0,bytes:n.length}}catch{return{captured:!1,bytes:0}}}async function i(e){let t=(0,s.join)(e.stateDir,`debug`,`${e.featureId}.md`);if(!e.pg||!e.workspaceId)return{written:!1,path:t};try{let n=(await e.pg`
      SELECT content
        FROM harness_shared.harness_feature_debug_notes
       WHERE workspace_id = ${e.workspaceId}
         AND harness_slug = ${e.harnessSlug}
         AND feature_id = ${e.featureId}
       LIMIT 1
    `)[0]?.content;return typeof n!=`string`||!n.trim()?{written:!1,path:t}:(await(0,o.mkdir)((0,s.dirname)(t),{recursive:!0}),await(0,o.writeFile)(t,n,`utf8`),{written:!0,path:t})}catch{return{written:!1,path:t}}}var a,o,s,c=e((()=>{a=t(n(),1),o=t(n(),1),s=t(n(),1)}));export{c as n,i as r,r as t};