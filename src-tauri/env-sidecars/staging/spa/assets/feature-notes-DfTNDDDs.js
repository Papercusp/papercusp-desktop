import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";async function r(e){let t=(0,a.join)(e.stateDir,`notes`,`${e.featureId}.md`);if(!e.pg||!e.workspaceId)return{written:!1,path:t};try{let n=(await e.pg`
      SELECT content
        FROM harness_shared.harness_feature_notes
       WHERE workspace_id = ${e.workspaceId}
         AND harness_slug = ${e.harnessSlug}
         AND feature_id = ${e.featureId}
       LIMIT 1
    `)[0]?.content;return typeof n!=`string`||!n.trim()?{written:!1,path:t}:(await(0,i.mkdir)((0,a.dirname)(t),{recursive:!0}),await(0,i.writeFile)(t,n,`utf8`),{written:!0,path:t})}catch{return{written:!1,path:t}}}var i,a;e((()=>{i=t(n(),1),a=t(n(),1)}))();export{r as materializeFeatureNote};