import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{U as r,t as i}from"./src-C8OEUO3c.js";import{n as a,s as o}from"./workspace-registry-C3lTKlnO.js";import{n as s,r as c}from"./db-encryption-Cexy6VC7.js";import{n as l,t as u}from"./papercusp-root-BnAoNWG3.js";function d(){return l(`harnesses`)}async function f(e){if(!(0,h.existsSync)(e))return null;try{return JSON.parse(await h.promises.readFile(e,`utf8`))}catch{return null}}async function p(e,t,n=null){n===null&&(n=await f((0,g.join)(d(),e,`plugin-configs`,`${t}.json`))??{});let i=JSON.stringify(n),o=s();await r(a(),async n=>{await n`
      INSERT INTO harness_shared.plugin_configs
        (harness_slug, plugin_slug, config_ct, updated_at, workspace_id)
      VALUES (
        ${e}, ${t},
        pgp_sym_encrypt(${i}, ${o}),
        (extract(epoch from now()) * 1000)::bigint, ${a()}
      )
      ON CONFLICT (harness_slug, plugin_slug) DO UPDATE
        SET config_ct = pgp_sym_encrypt(${i}, ${o}),
            updated_at = (extract(epoch from now()) * 1000)::bigint,
            workspace_id = EXCLUDED.workspace_id
    `})}async function m(e,t){let n=s(),i=null;return await r(a(),async r=>{i=(await r`
      SELECT
        CASE
          WHEN config_ct IS NOT NULL
            THEN pgp_sym_decrypt(config_ct, ${n})::jsonb
          ELSE config
        END AS payload
      FROM harness_shared.plugin_configs
      WHERE harness_slug = ${e} AND plugin_slug = ${t}
      LIMIT 1
    `)[0]?.payload??null}),i}var h,g,_=e((()=>{h=t(n(),1),g=t(n(),1),i(),u(),o(),c()}));export{m as n,p as r,_ as t};