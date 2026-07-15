import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-C4H77EbW.js";import{d as r}from"./source-BK5RyRFU.js";async function i(e,n){let{sql:r}=t();return(await r`
    SELECT agent_name FROM harness_shared.agent_name_sessions
     WHERE workspace_id = ${e} AND session_owner_id = ${n}
  `)[0]?.agent_name??null}e((()=>{n(),r()}))();export{i as resolveAdoptedName};