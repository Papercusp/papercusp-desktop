import{n as e}from"./chunk-CMxvf4Kt.js";function t(e,t){return e`(item_kind IN ('feature', 'chunk')
       OR item_kind IN (
         SELECT work_item_kind FROM harness_shared.datatype_registry
          WHERE workspace_id = ${t} AND tier = 'generic-kind' AND status = 'active'
            AND work_item_kind IS NOT NULL
            AND ${n} = ANY(tags)
       ))`}var n,r=e((()=>{n=`hive-placement`}));export{r as n,t};