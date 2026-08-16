import{n as f}from"./chunk-ChpBd9eV.js";import{st as s,t as k}from"./src-8fWtxfEz.js";import{c as w,r as g}from"./workspace-registry-Du2UbhlH.js";function o(e){return e==="auto"||e==="manual"?e:null}function p(e,a){return e??a??"auto"}async function d(e){const{sql:a}=s();return(await a`SELECT value FROM harness_shared.operator_settings WHERE key = ${e} LIMIT 1`)[0]?.value??null}async function l(e,a,t){const{sql:n}=s();await n`
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    VALUES (${e}, ${a}, ${t}, ${Date.now()}, ${g()})
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `}async function E(){return o(await d(r))??"auto"}async function W(e,a){await E()!==e&&await l(r,e,a??"Global default agent wake mode (hive-agent-tabs P-015 / D-005).")}async function _(e){return o(await d(i(e)))}async function L(e,a,t){await _(e)!==a&&await l(i(e),a,t??`Per-agent wake mode for ${e} (hive-agent-tabs P-015).`)}async function O(e){return p(await _(e),await E())}async function T(){const{sql:e}=s(),a=await e`
    SELECT key, value FROM harness_shared.operator_settings
    WHERE key LIKE 'wake_mode:agent:%'
  `,t=new Map;for(const n of a){const u=n.key.slice(16),c=o(n.value);u&&c&&t.set(u,c)}return t}var y,r,i,h=f((()=>{k(),w(),y="auto",r="wake_mode:default",i=e=>`wake_mode:agent:${e}`}));export{_ as a,p as c,E as i,W as l,o as n,h as o,T as r,O as s,y as t,L as u};
