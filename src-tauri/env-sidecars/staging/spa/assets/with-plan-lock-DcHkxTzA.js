const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/server-B1pdzCNE.js","assets/server-BnQHKcnx.js","assets/chunk-CMxvf4Kt.js","assets/types-BVF2mMkr.js","assets/path-Blx-PRXi.js","assets/__vite-browser-external-CM3Eme-n.js","assets/store-B0lJesjH.js","assets/store-mhjE4v-Q.js","assets/src-Ci9Y0gx7.js","assets/federation-Co63cjqq.js","assets/federation-DMiSLFt8.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{a as r}from"./types-BVF2mMkr.js";import{t as i}from"./src-hh0DlH_5.js";import{U as a,t as o}from"./src-BbbWoCsk.js";import{o as s}from"./src-Ci9Y0gx7.js";import{g as c,h as l,i as u,r as d,u as f}from"./source-myMelN6-.js";import{t as p}from"./content-hash-BA5hvcB8.js";async function m(e,t,i,o,s){try{let{getFlag:c}=await n(async()=>{let{getFlag:e}=await import(`./server-B1pdzCNE.js`);return{getFlag:e}},__vite__mapDeps([0,1,2,3,4,5]));if(!c(r.PLAN_PART_FEDERATION,`system`))return;let{PgPlanPartsStore:l}=await n(async()=>{let{PgPlanPartsStore:e}=await import(`./store-B0lJesjH.js`);return{PgPlanPartsStore:e}},__vite__mapDeps([6,7,2,8,5])),{capturePlanParts:u,ensurePlanPartsBaseline:d}=await n(async()=>{let{capturePlanParts:e,ensurePlanPartsBaseline:t}=await import(`./federation-Co63cjqq.js`);return{capturePlanParts:e,ensurePlanPartsBaseline:t}},__vite__mapDeps([9,10,2,8,5]));await a(e,async n=>{let r=new l(n,e,t);o&&await d(r,i,o),await u(r,i,s,Date.now(),`local`)})}catch{}}async function h(e,t,n){if(typeof t.slug!=`string`||!d.test(t.slug))throw Error(`withPlanLock: invalid plan slug ${JSON.stringify(t.slug)}`);let{workspaceId:r,harnessSlug:i}=await l({harnessSlug:t.harnessSlug,workspaceId:t.workspaceId}),o=t.slug,f=c(i,o),p=`${r}:${i}:${o}`,h=(t.ttlSec??5)*1e3;return a(r,async e=>{let t=!1,a=Date.now()+h;for(;;){if((await e`
        SELECT pg_try_advisory_xact_lock(hashtext('harness_plans'), hashtext(${p})) AS ok
      `)[0]?.ok){t=!0;break}if(Date.now()>=a)break;await _(50)}if(!t)return{kind:`busy`,busy:[{path:f,owner:`unknown`,owner_label:null,intent:`another plans write is in progress`,expires_ts:null}]};let c=(await e`
      SELECT content, version, content_hash
        FROM harness_shared.harness_plans
       WHERE workspace_id = ${r} AND harness_slug = ${i}
         AND plan_slug = ${o}
    `)[0]??null,l=c?Number(c.version):0,d=c?{version:l,contentHash:c.content_hash}:null,{newBody:m,value:g,templateData:v}=await n(c?.content??null,d),y=v!==void 0,b=l,x=null;if(m!==null){b=l+1,x=m;let t=u(m),n=s(m),a=JSON.stringify(t.items),c=JSON.stringify(t.decisions),d=JSON.stringify(t.promotePolicy);await e`
        INSERT INTO harness_shared.harness_plans (
          workspace_id, harness_slug, plan_slug, content, content_hash, version,
          title, status, created, updated, owner, initiative, template, supersedes, superseded_by,
          is_legacy, items, decisions, now_state, now_next, promote_policy, origin
        ) VALUES (
          ${r}, ${i}, ${o}, ${m}, ${n}, ${b},
          ${t.title}, ${t.status}, ${t.created}, ${t.updated}, ${t.owner}, ${t.initiative}, ${t.template},
          ${t.supersedes}, ${t.supersededBy}, ${t.isLegacy},
          ${a}::text::jsonb, ${c}::text::jsonb, ${t.nowState}, ${t.nowNext}, ${d}::text::jsonb, 'local'
        )
        ON CONFLICT (workspace_id, harness_slug, plan_slug) DO UPDATE SET
          content       = EXCLUDED.content,
          content_hash  = EXCLUDED.content_hash,
          version       = ${b},
          title         = EXCLUDED.title,
          status        = EXCLUDED.status,
          created       = EXCLUDED.created,
          updated       = EXCLUDED.updated,
          owner         = EXCLUDED.owner,
          initiative    = EXCLUDED.initiative,
          template      = EXCLUDED.template,
          supersedes    = EXCLUDED.supersedes,
          superseded_by = EXCLUDED.superseded_by,
          is_legacy     = EXCLUDED.is_legacy,
          items         = EXCLUDED.items,
          decisions     = EXCLUDED.decisions,
          now_state     = EXCLUDED.now_state,
          now_next      = EXCLUDED.now_next,
          promote_policy = EXCLUDED.promote_policy,
          -- EI-117: a genuine local write must RESET origin — without this a row
          -- last touched by a hyperbee projection (origin='remote') keeps that
          -- origin, the CDC capture trigger skips the local write, and the edit
          -- never reaches the outbox/log (so a later replay reverts it).
          origin        = 'local'
      `}else y&&c&&(b=l+1,x=c.content,await e`
        UPDATE harness_shared.harness_plans
           SET template_data = ${v.data===null?null:JSON.stringify(v.data)}::text::jsonb,
               version       = ${b},
               updated_at    = now(),
               origin        = 'local'
         WHERE workspace_id = ${r} AND harness_slug = ${i}
           AND plan_slug = ${o}
      `);return{kind:`applied`,value:g,filePath:f,version:b,writtenBody:x,priorBody:c?.content??null}}).then(async e=>{if(e.kind===`applied`){let{writtenBody:n,priorBody:a,...s}=e;return n!==null&&t.afterWrite&&await t.afterWrite(n,{workspaceId:r,harnessSlug:i}),n!==null&&await m(r,i,o,a,n),s}return e}).catch(e=>{if(e?.code===g)return{kind:`busy`,busy:[{path:f,owner:`unknown`,owner_label:null,intent:`another plans write is in progress`,expires_ts:null}]};throw e})}var g,_,v=e((()=>{o(),i(),p(),f(),t(),g=`55P03`,_=e=>new Promise(t=>setTimeout(t,e))}));export{h as n,v as t};