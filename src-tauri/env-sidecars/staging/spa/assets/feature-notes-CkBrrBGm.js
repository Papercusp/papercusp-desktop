import{n as o,o as i}from"./chunk-ChpBd9eV.js";import{t as n}from"./__vite-browser-external-56mrcCg8.js";async function c(e){const r=(0,s.join)(e.stateDir,"notes",`${e.featureId}.md`);if(!e.pg||!e.workspaceId)return{written:!1,path:r};try{const t=(await e.pg`
      SELECT content
        FROM harness_shared.harness_feature_notes
       WHERE workspace_id = ${e.workspaceId}
         AND harness_slug = ${e.harnessSlug}
         AND feature_id = ${e.featureId}
       LIMIT 1
    `)[0]?.content;return typeof t!="string"||!t.trim()?{written:!1,path:r}:(await(0,a.mkdir)((0,s.dirname)(r),{recursive:!0}),await(0,a.writeFile)(r,t,"utf8"),{written:!0,path:r})}catch{return{written:!1,path:r}}}var a,s,_=o((()=>{a=i(n(),1),s=i(n(),1)}));_();export{c as materializeFeatureNote};
