import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-C4H77EbW.js";async function r(e){let n=new Map;if(e.length===0)return n;let{sql:r}=t(),i=await r`
    SELECT owner_id, fleet_slug, fleet_role
      FROM harness_shared.coord_presence
     WHERE owner_id = ANY(${e}::text[])
       AND fleet_slug IS NOT NULL
  `;for(let e of i)n.set(e.owner_id,{fleetSlug:e.fleet_slug,fleetRole:e.fleet_role});return n}var i=e((()=>{n()}));export{i as n,r as t};