import{n as s}from"./chunk-ChpBd9eV.js";import{st as i,t as _}from"./src-8fWtxfEz.js";async function h(t=e){try{const{sql:r}=i(),a=await r`
      SELECT DISTINCT owner_sid
        FROM harness_shared.pty_viewer_heartbeats
       WHERE owner_sid IS NOT NULL
         AND owner_sid <> ''
         AND viewer_attached_at > now() - make_interval(secs => ${Math.max(1,Math.round(t/1e3))})`;return new Set(a.map(n=>n.owner_sid))}catch{return new Set}}var e,d=s((()=>{_(),e=90*1e3}));export{d as n,h as t};
