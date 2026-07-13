import{n as e}from"./chunk-CMxvf4Kt.js";function t(e,t){return e`(item_kind IN ('feature', 'chunk')
       OR item_kind IN (
         SELECT work_item_kind FROM harness_shared.datatype_registry
          WHERE workspace_id = ${t} AND tier = 'generic-kind' AND status = 'active'
            AND work_item_kind IS NOT NULL
            AND ${n} = ANY(tags)
       ))`}var n,r=e((()=>{n=`hive-placement`}));function i(e){if(!e||typeof e!=`object`||Array.isArray(e))return[];let t=e.externalBlockers;return Array.isArray(t)?t.filter(e=>{if(!e||typeof e!=`object`||Array.isArray(e))return!1;let t=e;return[`event`,`gate`,`runtime`,`human`].includes(String(t.kind))&&typeof t.ref==`string`&&typeof t.summary==`string`&&(t.status===`active`||t.status===`cleared`)&&typeof t.createdAt==`string`&&typeof t.createdBy==`string`&&typeof t.updatedAt==`string`}):[]}function a(e){return i(e).filter(e=>e.status===`active`)}var o=e((()=>{}));export{r as a,t as i,o as n,i as r,a as t};