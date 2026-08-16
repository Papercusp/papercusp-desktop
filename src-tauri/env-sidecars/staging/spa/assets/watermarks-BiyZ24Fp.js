import{n as o}from"./chunk-ChpBd9eV.js";import{st as m,t as f}from"./src-8fWtxfEz.js";import{b as p,t as _,v as n,x as i}from"./core-DKHauaoa.js";import{t as k}from"./core-BvZl9m32.js";import{o as l,r as d}from"./log-CmoS19XU.js";import{n as w}from"./pg-log-CSjhEHvU.js";var h=o((()=>{}));function S(r){if(typeof r=="string")try{return i(JSON.parse(r))}catch{return n()}return r&&typeof r=="object"?i(r):n()}var c,W=o((()=>{_(),w(),c=class{opts;fallbackWs;constructor(r){this.opts=r,this.fallbackWs=r.workspaceId??"default"}resolveWs(){const r=this.opts.getWorkspaceId?.();return r&&r.trim()?r:this.fallbackWs}async read(r){await this.opts.ensureSchema();const t=await this.opts.getSql()`
      SELECT surfaces FROM harness_shared.coord_watermarks
       WHERE workspace_id = ${this.resolveWs()} AND owner_id = ${r}
       LIMIT 1
    `;return t.length>0?S(t[0].surfaces):n()}async write(r,t){await this.opts.ensureSchema();const e=this.opts.getSql(),a=p(await this.read(r),t);return await e`
      INSERT INTO harness_shared.coord_watermarks (workspace_id, owner_id, surfaces, updated_at)
      VALUES (${this.resolveWs()}, ${r}, ${JSON.stringify(a)}::text::jsonb, now())
      ON CONFLICT (workspace_id, owner_id)
      DO UPDATE SET surfaces = EXCLUDED.surfaces, updated_at = now()
    `,a}}})),g=o((()=>{h(),W()}));function $(r,t){const e=r||null,a=t||null;return e&&a?a>e?a:e:a??e}function u(){return new c({getSql:()=>m().sql,ensureSchema:async()=>{},getWorkspaceId:()=>d()})}function v(r){s=r}function L(){s=u()}async function q(r){return s.read(r)}async function A(r,t){return s.write(r,t)}var s,R=o((()=>{f(),g(),k(),l(),s=u()}));export{L as a,q as i,R as n,A as o,$ as r,v as t};
