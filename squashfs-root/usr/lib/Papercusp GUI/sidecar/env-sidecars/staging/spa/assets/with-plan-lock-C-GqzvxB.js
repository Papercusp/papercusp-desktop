const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/server-CaCvLHcs.js","assets/server-9Vqtu2Uh.js","assets/chunk-CMxvf4Kt.js","assets/types-CMElFzKx.js","assets/store-Cb-4XAD0.js","assets/store-BzEYsFqN.js","assets/src-DW7JHyJi.js","assets/__vite-browser-external-CM3Eme-n.js","assets/federation-hizXIUyn.js","assets/federation-Bxf7QPTn.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{s as r}from"./types-CMElFzKx.js";import{t as i}from"./src-BfVE3IJL.js";import{u as a}from"./src-DW7JHyJi.js";import{U as o,t as s}from"./src-BvZp-r10.js";import{S as c,d as l,i as u,r as d,w as f}from"./source-B7NJdK_B.js";import{t as p}from"./content-hash-CwP8ZrEj.js";async function m(e,t,i,a,s){try{let{getFlag:c}=await n(async()=>{let{getFlag:e}=await import(`./server-CaCvLHcs.js`);return{getFlag:e}},__vite__mapDeps([0,1,2,3]));if(!c(r.PLAN_PART_FEDERATION,`system`))return;let{PgPlanPartsStore:l}=await n(async()=>{let{PgPlanPartsStore:e}=await import(`./store-Cb-4XAD0.js`);return{PgPlanPartsStore:e}},__vite__mapDeps([4,5,2,6,7])),{capturePlanParts:u,ensurePlanPartsBaseline:d}=await n(async()=>{let{capturePlanParts:e,ensurePlanPartsBaseline:t}=await import(`./federation-hizXIUyn.js`);return{capturePlanParts:e,ensurePlanPartsBaseline:t}},__vite__mapDeps([8,9,2,6,7]));await o(e,async n=>{let r=new l(n,e,t);a&&await d(r,i,a),await u(r,i,s,Date.now(),`local`)})}catch{}}async function h(e,t,n){if(typeof t.slug!=`string`||!d.test(t.slug))throw Error(`withPlanLock: invalid plan slug ${JSON.stringify(t.slug)}`);let{workspaceId:r,harnessSlug:i}=await c({harnessSlug:t.harnessSlug,workspaceId:t.workspaceId}),s=t.slug,l=f(i,s),p=`${r}:${i}:${s}`,h=(t.ttlSec??5)*1e3;return o(r,async e=>{let t=!1,o=Date.now()+h;for(;;){if((await e`
        SELECT pg_try_advisory_xact_lock(hashtext('harness_plans'), hashtext(${p})) AS ok
      `)[0]?.ok){t=!0;break}if(Date.now()>=o)break;await _(50)}if(!t)return{kind:`busy`,busy:[{path:l,owner:`unknown`,owner_label:null,intent:`another plans write is in progress`,expires_ts:null}]};let c=(await e`
      SELECT content, version, content_hash
        FROM harness_shared.harness_plans
       WHERE workspace_id = ${r} AND harness_slug = ${i}
         AND plan_slug = ${s}
    `)[0]??null,d=c?Number(c.version):0,f=c?{version:d,contentHash:c.content_hash}:null,{newBody:m,value:g,templateData:v}=await n(c?.content??null,f),y=v!==void 0,b=d,x=null;if(m!==null){b=d+1,x=m;let t=u(m),n=a(m),o=JSON.stringify(t.items),c=JSON.stringify(t.decisions),l=JSON.stringify(t.promotePolicy);await e`
        INSERT INTO harness_shared.harness_plans (
          workspace_id, harness_slug, plan_slug, content, content_hash, version,
          title, status, created, updated, owner, initiative, template, supersedes, superseded_by,
          is_legacy, items, decisions, now_state, now_next, promote_policy, origin
        ) VALUES (
          ${r}, ${i}, ${s}, ${m}, ${n}, ${b},
          ${t.title}, ${t.status}, ${t.created}, ${t.updated}, ${t.owner}, ${t.initiative}, ${t.template},
          ${t.supersedes}, ${t.supersededBy}, ${t.isLegacy},
          ${o}::text::jsonb, ${c}::text::jsonb, ${t.nowState}, ${t.nowNext}, ${l}::text::jsonb, 'local'
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
      `}return y&&(c||m!==null)&&(m===null&&(b=d+1,x=c.content),await e`
        UPDATE harness_shared.harness_plans
           SET template_data = ${v.data===null?null:JSON.stringify(v.data)}::text::jsonb,
               version       = ${b},
               updated_at    = now(),
               origin        = 'local'
         WHERE workspace_id = ${r} AND harness_slug = ${i}
           AND plan_slug = ${s}
      `),{kind:`applied`,value:g,filePath:l,version:b,writtenBody:x,priorBody:c?.content??null}}).then(async e=>{if(e.kind===`applied`){let{writtenBody:n,priorBody:a,...o}=e;return n!==null&&t.afterWrite&&await t.afterWrite(n,{workspaceId:r,harnessSlug:i}),n!==null&&await m(r,i,s,a,n),o}return e}).catch(e=>{if(e?.code===g)return{kind:`busy`,busy:[{path:l,owner:`unknown`,owner_label:null,intent:`another plans write is in progress`,expires_ts:null}]};throw e})}var g,_,v=e((()=>{s(),i(),p(),l(),t(),g=`55P03`,_=e=>new Promise(t=>setTimeout(t,e))}));export{h as n,v as t};