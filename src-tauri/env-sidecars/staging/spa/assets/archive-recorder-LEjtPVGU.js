import{n as u}from"./chunk-ChpBd9eV.js";import{st as g,t as v}from"./src-8fWtxfEz.js";import{D as k,N as D,X as S}from"./store-sTftUd-1.js";import{i as N,n as I,t as A}from"./elite-outcome-record-CrPiNAN5.js";import{a as $,c as y,l as p,n as b,o as _,s as m}from"./niche-Du2kGJT9.js";function K(e,t){return t.fitness-e.fitness||(e.nicheKey<t.nicheKey?-1:e.nicheKey>t.nicheKey?1:0)}function L(e,t){const s=[...e].sort(K);if(s.length<=t)return s;const i=[s[0]];for(;i.length<t;){let r=null,n=-1;for(const a of s){if(i.includes(a))continue;let o=1/0;for(const l of i){const c=_(a.descriptor.features,l.descriptor.features);c<o&&(o=c)}(o>n||o===n&&r!==null&&a.nicheKey<r.nicheKey)&&(n=o,r=a)}if(!r)break;i.push(r)}return i}var E,U=u((()=>{m(),E=class{store;constructor(e){this.store=e}async upsertElite(e,t=Date.now()){const s=y(e.descriptor.coords),i=await this.store.list(),r=p(e.descriptor.features,i.map(o=>o.descriptor.features),1,{excludeSelf:!1}),n=i.find(o=>o.nicheKey===s)??null,a={nicheKey:s,coords:e.descriptor.coords,candidateId:e.candidateId,fitness:e.fitness,descriptor:e.descriptor,source:e.source??"gym",rationale:e.rationale??null,updatedAt:t};return n?e.fitness>n.fitness?(await this.store.put(a),{admitted:!0,reason:"improved",nicheKey:s,isNewNiche:!1,novelty:r,replaced:n.candidateId,elite:a}):{admitted:!1,reason:"dominated",nicheKey:s,isNewNiche:!1,novelty:r,elite:n}:(await this.store.put(a),{admitted:!0,reason:"new-niche",nicheKey:s,isNewNiche:!0,novelty:r,elite:a})}async getElite(e){return this.store.get(e)}async listElites(e){return this.store.list(e)}async noveltyScore(e,t=3){const s=await this.store.list();return p(e.features,s.map(i=>i.descriptor.features),t)}async coverage(){const e=(await this.store.list()).length,t=b;return{filled:e,total:t,fraction:t?e/t:0}}async steppingStones(e={}){const t=Math.max(1,e.k??5),s=await this.store.list();if(s.length<=t)return s;if(e.descriptor){const i=e.descriptor.features;return[...s].map(r=>({e:r,d:_(i,r.descriptor.features)})).sort((r,n)=>n.d-r.d||(r.e.nicheKey<n.e.nicheKey?-1:r.e.nicheKey>n.e.nicheKey?1:0)).slice(0,t).map(r=>r.e)}return L(s,t)}}}));function f(e){const t=e.descriptor,s=typeof t=="string"?JSON.parse(t):t,i={scope:String(e.scope),domain:String(e.domain),risk:String(e.risk)};return{nicheKey:String(e.niche_key),coords:i,candidateId:String(e.candidate_id),fitness:Number(e.fitness),descriptor:s,source:String(e.source),rationale:e.rationale==null?null:String(e.rationale),updatedAt:Number(e.updated_at)}}var w,C=u((()=>{w=class{sql;scope;constructor(e,t){this.sql=e,this.scope=t}async get(e){const t=await this.sql`
      SELECT * FROM harness_shared.gym_qd_archive
       WHERE workspace_id = ${this.scope.workspaceId}
         AND harness_slug = ${this.scope.harnessSlug}
         AND niche_key = ${e}
       LIMIT 1`;return t.length?f(t[0]):null}async put(e){await this.sql`
      INSERT INTO harness_shared.gym_qd_archive
        (workspace_id, harness_slug, niche_key, candidate_id, scope, domain, risk, fitness, descriptor, source, rationale, updated_at)
      VALUES (${this.scope.workspaceId}, ${this.scope.harnessSlug}, ${e.nicheKey}, ${e.candidateId},
              ${e.coords.scope}, ${e.coords.domain}, ${e.coords.risk}, ${e.fitness},
              ${JSON.stringify(e.descriptor)}::text::jsonb, ${e.source}, ${e.rationale??null}, ${e.updatedAt})
      ON CONFLICT (workspace_id, harness_slug, niche_key) DO UPDATE SET
        candidate_id = EXCLUDED.candidate_id,
        scope = EXCLUDED.scope, domain = EXCLUDED.domain, risk = EXCLUDED.risk,
        fitness = EXCLUDED.fitness, descriptor = EXCLUDED.descriptor,
        source = EXCLUDED.source, rationale = EXCLUDED.rationale, updated_at = EXCLUDED.updated_at`}async list(e){return(await this.sql`
      SELECT * FROM harness_shared.gym_qd_archive
       WHERE workspace_id = ${this.scope.workspaceId}
         AND harness_slug = ${this.scope.harnessSlug}
         ${e?.source?this.sql`AND source = ${e.source}`:this.sql``}
       ORDER BY fitness DESC, niche_key ASC
       ${e?.limit!=null?this.sql`LIMIT ${e.limit}`:this.sql``}`).map(f)}}}));async function T(e,t){if(!k(e.eligibility))return{federatable:!1,reason:"not-eligible"};if(!S(e.workspaceId))throw new Error(`markEliteFederatable — an eligible elite cannot federate from the '${e.workspaceId}' workspace partition (WI-1564): the coordination/'*' partition never federates, so the elite would be captured then stranded on every peer. Publish from a hive-scoped workspace.`);const s=t??g().sql;if(!e.outcomeSigner){const o=await s`
      UPDATE harness_shared.gym_qd_archive
         SET federatable = true
       WHERE workspace_id = ${e.workspaceId}
         AND harness_slug = ${e.harnessSlug}
         AND niche_key = ${e.nicheKey}
         AND source_hive IS NULL
      RETURNING niche_key`,l=Array.isArray(o)&&o.length>0;return{federatable:l,reason:l?"stamped":"no-row"}}const i=await s`
    UPDATE harness_shared.gym_qd_archive
       SET federatable = true
     WHERE workspace_id = ${e.workspaceId}
       AND harness_slug = ${e.harnessSlug}
       AND niche_key = ${e.nicheKey}
       AND source_hive IS NULL
    RETURNING candidate_id, fitness, updated_at`;if(!Array.isArray(i)||i.length===0)return{federatable:!1,reason:"no-row"};const r=i[0],n=e.eligibility.outcome==="won"?"won":"graded",a=await N({nicheKey:e.nicheKey,candidateId:String(r.candidate_id),sourceHive:e.harnessSlug,outcome:n,grade:Number(e.eligibility.grade??0),fitness:Number(r.fitness),devicePubkeyBase64:e.outcomeSigner.devicePubkeyBase64,nowMs:Number(r.updated_at)},e.outcomeSigner.sign);return await s`
    UPDATE harness_shared.gym_qd_archive
       SET outcome_record = ${JSON.stringify(a)}::text::jsonb
     WHERE workspace_id = ${e.workspaceId}
       AND harness_slug = ${e.harnessSlug}
       AND niche_key = ${e.nicheKey}
       AND source_hive IS NULL`,{federatable:!0,reason:"stamped",outcomeRecordId:A(a)}}var q=u((()=>{v(),D(),I()}));function W(e,t,s={}){const i=s.archive??O(e,t),r=t.now??(()=>Date.now()),n=new Map;return{recordArchive:async c=>{const d=$({overlay:c.overlay,parentOverlay:c.parentOverlay});n.set(c.variantId,d),await i.upsertElite({candidateId:c.variantId,descriptor:d,fitness:c.fitness,source:"gym",rationale:c.rationale??null},r())},noveltyForVariant:async c=>{const d=n.get(c);return d?i.noveltyScore(d,s.k):1},federateAcceptedElite:async(c,d)=>{const h=n.get(c);h&&await T({workspaceId:t.workspaceId,harnessSlug:t.harnessSlug,nicheKey:y(h.coords),eligibility:d,outcomeSigner:s.outcomeSigner},e)}}}function O(e,t){return new E(new w(e,t))}var x=u((()=>{m(),U(),C(),q()}));export{U as i,O as n,W as r,x as t};
