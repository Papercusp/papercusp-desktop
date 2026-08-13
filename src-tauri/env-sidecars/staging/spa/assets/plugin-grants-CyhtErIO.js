import{n as m,o as u}from"./chunk-ChpBd9eV.js";import{st as y,t as d}from"./src-BmBNODK0.js";import{t as f}from"./__vite-browser-external-56mrcCg8.js";import{n as $,t as N}from"./papercusp-root-CxP2KZTu.js";function S(){const n=(0,b.join)($(),"granted-capabilities.json");if(!(0,l.existsSync)(n))return[];try{const i=(0,l.readFileSync)(n,"utf8"),r=JSON.parse(i).grants??{},a=new Map;for(const e of Object.keys(r)){const s=e.split(":");if(s.length<3)continue;const t=s[0],g=s[1],h=s.slice(2).join(":"),o=t.lastIndexOf("@"),p=o>0?t.slice(0,o):t,_=o>0?t.slice(o+1):"0.0.0",c=`${p}@${_}${g}`;a.has(c)||a.set(c,{pluginName:p,pluginVersion:_,harnessSlug:g,capabilities:[],reason:"legacy-file backfill"}),a.get(c).capabilities.push(h)}return Array.from(a.values())}catch{return[]}}async function I(n,i,r,a){const e=new Set;try{const s=await(a?.sql??y().sql)`
      SELECT capability FROM harness_shared.plugin_capability_grants
      WHERE plugin_name = ${n}
        AND plugin_version = ${i}
        AND harness_slug IN (${r}, '')
    `;for(const t of s)e.add(t.capability)}catch{}if(!a?.skipLegacy){for(const s of S())if(s.pluginName===n&&!(s.pluginVersion!==i&&s.pluginVersion!=="0.0.0")&&!(s.harnessSlug!==r&&s.harnessSlug!==""))for(const t of s.capabilities)e.add(t)}return Array.from(e)}async function q(n,i){if(n.capabilities.length===0)return;const r=i?.sql??y().sql;for(const a of n.capabilities)await r`
      INSERT INTO harness_shared.plugin_capability_grants
        (plugin_name, plugin_version, harness_slug, capability, granted_by, reason)
      VALUES (${n.pluginName}, ${n.pluginVersion}, ${n.harnessSlug}, ${a},
              ${n.grantedBy??null}, ${n.reason??null})
      ON CONFLICT DO NOTHING
    `}var l,b,A=m((()=>{l=u(f(),1),b=u(f(),1),d(),N()}));export{q as n,A as r,I as t};
