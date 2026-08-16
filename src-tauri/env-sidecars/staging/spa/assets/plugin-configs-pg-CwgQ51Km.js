import{n as g,o}from"./chunk-ChpBd9eV.js";import{Q as c,t as f}from"./src-8fWtxfEz.js";import{t as _}from"./__vite-browser-external-56mrcCg8.js";import{c as m,r as a}from"./workspace-registry-Du2UbhlH.js";import{n as p,r as y}from"./db-encryption-ByK3NqqK.js";import{n as E,t as d}from"./papercusp-root-CxP2KZTu.js";function w(){return E("harnesses")}async function S(n){if(!(0,e.existsSync)(n))return null;try{return JSON.parse(await e.promises.readFile(n,"utf8"))}catch{return null}}async function D(n,i,r=null){r===null&&(r=await S((0,l.join)(w(),n,"plugin-configs",`${i}.json`))??{});const t=JSON.stringify(r),s=p();await c(a(),async u=>{await u`
      INSERT INTO harness_shared.plugin_configs
        (harness_slug, plugin_slug, config_ct, updated_at, workspace_id)
      VALUES (
        ${n}, ${i},
        pgp_sym_encrypt(${t}, ${s}),
        (extract(epoch from now()) * 1000)::bigint, ${a()}
      )
      ON CONFLICT (harness_slug, plugin_slug) DO UPDATE
        SET config_ct = pgp_sym_encrypt(${t}, ${s}),
            updated_at = (extract(epoch from now()) * 1000)::bigint,
            workspace_id = EXCLUDED.workspace_id
    `})}async function I(n,i){const r=p();let t=null;return await c(a(),async s=>{t=(await s`
      SELECT
        CASE
          WHEN config_ct IS NOT NULL
            THEN pgp_sym_decrypt(config_ct, ${r})::jsonb
          ELSE config
        END AS payload
      FROM harness_shared.plugin_configs
      WHERE harness_slug = ${n} AND plugin_slug = ${i}
      LIMIT 1
    `)[0]?.payload??null}),t}var e,l,L=g((()=>{e=o(_(),1),l=o(_(),1),f(),d(),m(),y()}));export{I as n,D as r,L as t};
