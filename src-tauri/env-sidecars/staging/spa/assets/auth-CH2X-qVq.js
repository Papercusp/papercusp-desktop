import{n as p,o as f}from"./chunk-ChpBd9eV.js";import{n as m,t as S}from"./preload-helper-CcgcQsTF.js";import{st as o,t as T}from"./src-BmBNODK0.js";import{t as O}from"./__vite-browser-external-56mrcCg8.js";import{n as y,t as g}from"./ttl-map-BGmnBd3B.js";function C(){i.clear()}function R(){return(0,l.randomBytes)(32).toString("hex")}function L(s){const e=new Map;if(!s)return e;for(const a of s.split(";")){const r=a.indexOf("=");if(r<0)continue;const n=a.slice(0,r).trim();n&&e.set(n,decodeURIComponent(a.slice(r+1).trim()))}return e}async function $(s){if(s)return L(s.get("cookie")).get(_);try{const{cookies:e}=await S(async()=>{const{cookies:a}=await import("next/headers");return{cookies:a}},[]);return(await e()).get(_)?.value}catch{return}}async function D(s){const{sql:e}=o(),a=await $(s);if(!a)return null;const r=await e`
    SELECT s.user_id, s.expires_at,
           u.id, u.username, u.display_name, u.password_hash
      FROM harness_shared.user_sessions s
      JOIN harness_shared.users u ON u.id = s.user_id
     WHERE s.token = ${a}
       AND s.expires_at > now()
       AND u.is_active = true
     LIMIT 1
  `;if(r.length===0)return null;const n=r[0];return i.get(a)===void 0&&(i.set(a,!0),await e`
      UPDATE harness_shared.user_sessions
         SET last_seen_at = now()
       WHERE token = ${a}
    `.catch(()=>{})),{id:n.id,username:n.username,display_name:n.display_name,has_password:n.password_hash!==null}}async function H(s){const{sql:e}=o(),a=await D(s);if(a)return a;await I();const r=await e`
    SELECT id, username, display_name, password_hash
      FROM harness_shared.users
     WHERE username = 'default'
       AND is_active = true
     LIMIT 1
  `;if(r.length===0)throw new Error("default user not present after ensureDefaultUser");const n=r[0];return{id:n.id,username:n.username,display_name:n.display_name,has_password:n.password_hash!==null}}async function q(s,e,a){const{sql:r}=o(),n=await r`
    SELECT id, display_name, password_hash, is_active
      FROM harness_shared.users
     WHERE username = ${s}
     LIMIT 1
  `;if(n.length===0)throw Object.assign(new Error("unknown user"),{code:"unknown_user"});const t=n[0];if(!t.is_active)throw Object.assign(new Error("inactive"),{code:"inactive"});if(t.password_hash!==null){if(!e)throw Object.assign(new Error("password required"),{code:"bad_password"});if(!(await r`
      SELECT crypt(${e}, ${t.password_hash}) = ${t.password_hash} AS ok
    `)[0]?.ok)throw Object.assign(new Error("bad password"),{code:"bad_password"})}await r`
    DELETE FROM harness_shared.user_sessions
     WHERE expires_at < now()
        OR (created_at < now() - interval '48 hours'
            AND (last_seen_at IS NULL OR last_seen_at < created_at + interval '1 minute'))
  `.catch(E=>console.error("[auth] session sweep failed (non-fatal):",E));const d=R(),w=a?.ttl_ms??2592e6,c=new Date(Date.now()+w);return await r`
    INSERT INTO harness_shared.user_sessions (token, user_id, expires_at, user_agent, remote_addr)
    VALUES (${d}, ${t.id}, ${c.toISOString()}, ${a?.user_agent??null}, ${a?.remote_addr??null})
  `,await r`
    UPDATE harness_shared.users SET last_login_at = now() WHERE id = ${t.id}
  `,{token:d,user:{id:t.id,username:s,display_name:t.display_name,has_password:t.password_hash!==null},expires_at:c}}async function W(s){const{sql:e}=o();await e`DELETE FROM harness_shared.user_sessions WHERE token = ${s}`}async function x(s,e,a){const{sql:r}=o();if(s=s.trim().toLowerCase(),!/^[a-z0-9_-]{2,32}$/.test(s))throw Object.assign(new Error("invalid username"),{code:"bad_username"});if(!e.trim())throw Object.assign(new Error("display name required"),{code:"bad_display_name"});const n=a?(await r`SELECT crypt(${a}, gen_salt('bf')) AS hash`)[0].hash:null;return{id:(await r`
    INSERT INTO harness_shared.users (username, display_name, password_hash)
    VALUES (${s}, ${e.trim()}, ${n})
    RETURNING id
  `)[0].id,username:s,display_name:e.trim(),has_password:n!==null}}async function F(s,e,a){const{sql:r}=o(),n=await r`
    SELECT password_hash FROM harness_shared.users WHERE id = ${s} LIMIT 1
  `;if(n.length===0)throw Object.assign(new Error("not found"),{code:"unknown_user"});const t=n[0].password_hash;if(t!==null){if(!e)throw Object.assign(new Error("current password required"),{code:"bad_password"});if(!(await r`
      SELECT crypt(${e}, ${t}) = ${t} AS ok
    `)[0]?.ok)throw Object.assign(new Error("bad password"),{code:"bad_password"})}await r`UPDATE harness_shared.users SET password_hash = ${a?(await r`SELECT crypt(${a}, gen_salt('bf')) AS hash`)[0].hash:null} WHERE id = ${s}`,await r`DELETE FROM harness_shared.user_sessions WHERE user_id = ${s}`}async function I(){const{sql:s}=o();u||(await s`
    INSERT INTO harness_shared.users (username, display_name, password_hash)
    VALUES ('default', 'User', NULL)
    ON CONFLICT (username) DO NOTHING
  `,u=!0)}async function j(s,e){const{sql:a}=o();await a`
    UPDATE harness_shared.users
       SET display_name = ${e}
     WHERE id = ${s}
  `}async function P(){const{sql:s}=o();return(await s`
    SELECT id, username, display_name, password_hash
      FROM harness_shared.users
     WHERE is_active = true
     ORDER BY username
  `).map(e=>({id:e.id,username:e.username,display_name:e.display_name,has_password:e.password_hash!==null}))}var l,_,N,h,i,u,V=p((()=>{l=f(O(),1),T(),y(),m(),_="papercusp_session",N=720*60*60*1e3,h=6e4,i=new g({ttlMs:h,maxEntries:4096}),u=!1}));export{F as a,H as c,q as d,W as f,C as i,V as l,j as m,h as n,I as o,x as p,_ as r,D as s,N as t,P as u};
