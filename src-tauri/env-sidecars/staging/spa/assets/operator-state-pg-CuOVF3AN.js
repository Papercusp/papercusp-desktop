import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-DTtGQmae.js";import{n as r,s as i}from"./workspace-registry-C3lTKlnO.js";import{n as a,r as o,t as s}from"./db-encryption-Cexy6VC7.js";function c(){let e=Number({}.PAPERCUSP_OPSTATE_CACHE_MS);return Number.isFinite(e)&&e>=0?e:2e3}function l(e,t){m.delete(h(e,t))}async function u(e,n,i){let{sql:o}=t(),l=n??r(),u=p.has(e)?c():0;if(u>0&&!i?.fresh){let t=m.get(h(e,l));if(t&&Date.now()-t.at<u)return t.value}let d;if(s.has(e)){let t=await o`
      SELECT
        CASE
          WHEN payload_ct IS NOT NULL
            THEN pgp_sym_decrypt(payload_ct, ${a()})::jsonb
          ELSE payload
        END AS plaintext
      FROM ${o(`harness_shared.${e}`)}
       WHERE workspace_id = ${l}
    `;d=t.length>0?t[0].plaintext??null:null}else{let t=await o`
      SELECT payload FROM ${o(`harness_shared.${e}`)}
       WHERE workspace_id = ${l}
    `;d=t.length>0?t[0].payload:null}return u>0&&m.set(h(e,l),{value:d,at:Date.now()}),d}async function d(e,n,i){let{sql:o}=t(),c=i??r(),u=Date.now();if(s.has(e)){let t=a(),r=JSON.stringify(n);await o`
      INSERT INTO ${o(`harness_shared.${e}`)}
        (workspace_id, payload, payload_ct, updated_at)
      VALUES (
        ${c},
        '{}'::jsonb,
        pgp_sym_encrypt(${r}, ${t}),
        ${u}
      )
      ON CONFLICT (workspace_id) DO UPDATE
        SET payload = '{}'::jsonb,
            payload_ct = EXCLUDED.payload_ct,
            updated_at = EXCLUDED.updated_at
    `,l(e,c);return}await o`
    INSERT INTO ${o(`harness_shared.${e}`)}
      (workspace_id, payload, updated_at)
    VALUES (${c}, ${JSON.stringify(n)}::text::jsonb, ${u})
    ON CONFLICT (workspace_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
  `,l(e,c)}async function f(e,n,i,o){let{sql:c}=t(),u=o??r(),d=s.has(e),f=d?a():null,p=await c.begin(async t=>{let r;if(d&&f!==null){let i=await t`
        SELECT
          CASE
            WHEN payload_ct IS NOT NULL
              THEN pgp_sym_decrypt(payload_ct, ${f})::jsonb
            ELSE payload
          END AS plaintext
        FROM ${t(`harness_shared.${e}`)}
         WHERE workspace_id = ${u}
         FOR UPDATE
      `;r=i.length>0?i[0].plaintext??n:n}else{let i=await t`
        SELECT payload FROM ${t(`harness_shared.${e}`)}
         WHERE workspace_id = ${u}
         FOR UPDATE
      `;r=i.length>0?i[0].payload:n}let a=i(r);if(d&&f!==null){let n=JSON.stringify(a);await t`
        INSERT INTO ${t(`harness_shared.${e}`)}
          (workspace_id, payload, payload_ct, updated_at)
        VALUES (
          ${u},
          '{}'::jsonb,
          pgp_sym_encrypt(${n}, ${f}),
          ${Date.now()}
        )
        ON CONFLICT (workspace_id) DO UPDATE
          SET payload = '{}'::jsonb,
              payload_ct = EXCLUDED.payload_ct,
              updated_at = EXCLUDED.updated_at
      `}else await t`
        INSERT INTO ${t(`harness_shared.${e}`)}
          (workspace_id, payload, updated_at)
        VALUES (${u}, ${JSON.stringify(a)}::text::jsonb, ${Date.now()})
        ON CONFLICT (workspace_id) DO UPDATE
          SET payload = EXCLUDED.payload,
              updated_at = EXCLUDED.updated_at
      `;return a});return l(e,u),p}var p,m,h,g=e((()=>{n(),i(),o(),p=new Set([`harness_registry`]),m=new Map,h=(e,t)=>`${e}\x00${t}`}));export{d as a,f as i,l as n,u as r,g as t};