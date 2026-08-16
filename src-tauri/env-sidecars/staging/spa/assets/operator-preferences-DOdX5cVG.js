import{n as g}from"./chunk-ChpBd9eV.js";import{i as y,n as h,o as A}from"./operator-state-pg-Cytj1dEs.js";async function c(){const t=await y("operator_preferences");return typeof t?.content=="string"?t.content:""}async function l(t){await A("operator_preferences",{content:t})}async function R(){const t=await c();return{raw:t,standingApprovals:E(t)}}function E(t){const n=[];for(const e of t.matchAll(u))n.push({confirmedAt:e[1],capability:e[2],targetHarness:e[3]});return n}async function b(t){const n=new Date().toISOString().slice(0,10),e=new RegExp(`(^|\\n)## ${n}\\n`),r=await c(),s=t.trimEnd();let o;if(e.test(r))o=`${r.trimEnd()}
${s}
`;else{const f=r.trim()?`

`:"";o=`${r.trimEnd()}${f}## ${n}
${s}
`}await l(o)}async function S(){const t=await c();if(!t)return[];const n=[],e=t.split(/^## /m).filter(r=>r.trim());for(const r of e){const s=r.indexOf(`
`);if(s<0)continue;const o=r.slice(0,s).trim(),f=r.slice(s+1).split(`
`);let i=[];const p=()=>{const a=i.join(`
`).trim();if(!a)return;const d=[];for(const w of a.matchAll(m))d.push(w[1]);n.push({key:O(o,a),date:o,body:a,tags:d,addedAt:P(o)}),i=[]};for(const a of f)/^-\s/.test(a)?(p(),i.push(a)):i.length&&i.push(a);p()}return n}async function v(t){const n=(await S()).find(e=>e.key===t);return n?(await l((await c()).replace(n.body,"").replace(/\n{3,}/g,`

`)),!0):!1}function O(t,n){let e=0;const r=`${t}::${n}`;for(let s=0;s<r.length;s++)e=e*31+r.charCodeAt(s)|0;return Math.abs(e).toString(36)}function P(t){return/^\d{4}-\d{2}-\d{2}$/.test(t)?`${t}T00:00:00.000Z`:new Date(0).toISOString()}var u,m,x=g((()=>{h(),u=/\[OPERATOR-PROPOSED-USER-CONFIRMED-(\d{4}-\d{2}-\d{2})\]\s*\[STANDING-APPROVE\][\s\S]*?capability=([^\s,]+)[\s\S]*?target=([^\s\n]+)/g,m=/\[([A-Z][A-Z0-9_-]+(?:-\d{4}-\d{2}-\d{2})?)\]/g}));export{E as a,R as i,x as n,v as o,S as r,b as t};
