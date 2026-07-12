import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CgbVJkBN.js";async function r(e){let n=new Map,r=e.filter(Boolean);if(!r.length)return n;try{let{sql:e}=t(),a=await e`
      SELECT coord_owner_id, MAX(invoked_at) AS last_read
        FROM harness_shared.tool_invocations
       WHERE coord_owner_id = ANY(${r})
         AND tool_name = ANY(${[...i]})
       GROUP BY coord_owner_id
    `;for(let e of a){let t=e.last_read instanceof Date?e.last_read:new Date(e.last_read);Number.isNaN(t.getTime())||n.set(e.coord_owner_id,t.toISOString())}}catch{}return n}var i,a=e((()=>{n(),i=[`coord:inbox`,`coord:orient`,`coord_inbox`,`coord_orient`]}));export{r as n,a as t};