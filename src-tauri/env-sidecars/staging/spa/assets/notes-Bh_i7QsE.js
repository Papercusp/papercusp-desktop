import{n as i}from"./chunk-ChpBd9eV.js";import{st as r,t as o}from"./src-8fWtxfEz.js";import{c as d,r as n}from"./workspace-registry-Du2UbhlH.js";async function m(s){const{sql:a}=r(),e=n(),t=s?.trim();return t?await a`
        SELECT id, title, body, created_at, updated_at
          FROM harness_shared.notes
         WHERE workspace_id = ${e}
           AND (title ILIKE ${`%${t}%`} OR body ILIKE ${`%${t}%`})
         ORDER BY updated_at DESC`:await a`
        SELECT id, title, body, created_at, updated_at
          FROM harness_shared.notes
         WHERE workspace_id = ${e}
         ORDER BY updated_at DESC`}var c=i((()=>{o(),d()}));c();export{m as listNotes};
