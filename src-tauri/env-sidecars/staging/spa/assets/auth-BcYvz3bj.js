import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{t as r}from"./__vite-browser-external-CM3Eme-n.js";import{q as i,t as a}from"./src-BbbWoCsk.js";var o,s=e((()=>{o=class{map=new Map;ttlMs;maxEntries;constructor(e){this.ttlMs=e.ttlMs,this.maxEntries=e.maxEntries??1024}getEntry(e,t=Date.now()){let n=this.map.get(e);if(n){if(n.expiresAt<=t){this.map.delete(e);return}return n}}get(e,t=Date.now()){return this.getEntry(e,t)?.value}set(e,t,n=Date.now()){for(let[e,t]of this.map)t.expiresAt<=n&&this.map.delete(e);if(!this.map.has(e)&&this.map.size>=this.maxEntries){let e=this.map.keys().next().value;e!==void 0&&this.map.delete(e)}this.map.delete(e),this.map.set(e,{value:t,expiresAt:n+this.ttlMs})}delete(e){this.map.delete(e)}clear(){this.map.clear()}get size(){return this.map.size}}}));function c(e){let t=new Map;if(!e)return t;for(let n of e.split(`;`)){let e=n.indexOf(`=`);if(e<0)continue;let r=n.slice(0,e).trim();r&&t.set(r,decodeURIComponent(n.slice(e+1).trim()))}return t}async function l(e){if(e)return c(e.get(`cookie`)).get(d);try{let{cookies:e}=await n(async()=>{let{cookies:e}=await import(`next/headers`);return{cookies:e}},[]);return(await e()).get(d)?.value}catch{return}}async function u(e){let{sql:t}=i(),n=await l(e);if(!n)return null;let r=await t`
    SELECT s.user_id, s.expires_at,
           u.id, u.username, u.display_name, u.password_hash
      FROM harness_shared.user_sessions s
      JOIN harness_shared.users u ON u.id = s.user_id
     WHERE s.token = ${n}
       AND s.expires_at > now()
       AND u.is_active = true
     LIMIT 1
  `;if(r.length===0)return null;let a=r[0];return p.get(n)===void 0&&(p.set(n,!0),await t`
      UPDATE harness_shared.user_sessions
         SET last_seen_at = now()
       WHERE token = ${n}
    `.catch(()=>{})),{id:a.id,username:a.username,display_name:a.display_name,has_password:a.password_hash!==null}}var d,f,p;e((()=>{r(),a(),s(),t(),d=`papercusp_session`,f=6e4,p=new o({ttlMs:f,maxEntries:4096})}))();export{u as getSessionUser};