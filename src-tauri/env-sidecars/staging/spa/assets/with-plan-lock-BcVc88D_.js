const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/server-BdefWo3P.js","assets/server-CB1HiStO.js","assets/chunk-ChpBd9eV.js","assets/types-B6UfiA7g.js","assets/src-6Py4l2MU.js","assets/store-BUKc8LII.js","assets/store-CRXaCRrz.js","assets/src-DgKPQFfC.js","assets/__vite-browser-external-56mrcCg8.js","assets/federation-DiXxpdH-.js","assets/federation-dW_OL4HI.js"])))=>i.map(i=>d[i]);
import{n as T}from"./chunk-ChpBd9eV.js";import{n as I,t as y}from"./preload-helper-CcgcQsTF.js";import{s as U}from"./types-B6UfiA7g.js";import{t as X}from"./src-CL56NiZm.js";import{Q as b,t as F}from"./src-BmBNODK0.js";import{g as M}from"./src-DgKPQFfC.js";import{t as W}from"./content-hash-DugvSCp8.js";import{D as q,T as B,d as J,i as j,r as H}from"./source-Ca8i7FlY.js";function C(a){const i=new Map;for(const l of a)!l||typeof l.id!="string"||l.id===""||i.set(l.id,l);return[...i.values()]}function S(a){return Array.isArray(a)?a.filter(i=>typeof i=="string"):[]}async function V(a,i,l){const{workspaceId:t,harnessSlug:n,planSlug:r}=i,p=C(l.items??[]).map((s,e)=>({id:s.id,seq:e,itemText:typeof s.text=="string"?s.text:"",status:typeof s.status=="string"&&s.status!==""?s.status:"todo",importance:typeof s.importance=="string"?s.importance:null,phase:typeof s.phase=="string"?s.phase:null,blockedBy:S(s.blockedBy),decisionRefs:S(s.decisionRefs)})),d=C(l.decisions??[]).map((s,e)=>({id:s.id,seq:e,title:typeof s.title=="string"?s.title:"",body:typeof s.body=="string"?s.body:"",decisionDate:typeof s.date=="string"?s.date:null,itemRefs:S(s.itemRefs)}));return await a`
    DELETE FROM harness_shared.plan_items
     WHERE workspace_id = ${t} AND harness_slug = ${n}
       AND plan_slug = ${r}
  `,await a`
    DELETE FROM harness_shared.plan_decisions
     WHERE workspace_id = ${t} AND harness_slug = ${n}
       AND plan_slug = ${r}
  `,p.length>0&&await a`
      INSERT INTO harness_shared.plan_items (
        workspace_id, harness_slug, plan_slug,
        item_id, seq, item_text, status, importance, phase, blocked_by, decision_refs
      )
      SELECT ${t}, ${n}, ${r},
             e.id, e.seq, e."itemText", e.status, e.importance, e.phase,
             COALESCE(e."blockedBy", '{}'), COALESCE(e."decisionRefs", '{}')
        FROM jsonb_to_recordset(${JSON.stringify(p)}::text::jsonb) AS e(
               id text, seq integer, "itemText" text, status text,
               importance text, phase text, "blockedBy" text[], "decisionRefs" text[]
             )
    `,d.length>0&&await a`
      INSERT INTO harness_shared.plan_decisions (
        workspace_id, harness_slug, plan_slug,
        decision_id, seq, title, body, decision_date, item_refs
      )
      SELECT ${t}, ${n}, ${r},
             e.id, e.seq, e.title, e.body, e."decisionDate",
             COALESCE(e."itemRefs", '{}')
        FROM jsonb_to_recordset(${JSON.stringify(d)}::text::jsonb) AS e(
               id text, seq integer, title text, body text,
               "decisionDate" text, "itemRefs" text[]
             )
    `,{items:p.length,decisions:d.length}}var G=T((()=>{}));async function K(a,i,l,t,n){try{const{getFlag:r}=await y(async()=>{const{getFlag:e}=await import("./server-BdefWo3P.js");return{getFlag:e}},__vite__mapDeps([0,1,2,3,4]));if(!r(U.PLAN_PART_FEDERATION,"system"))return;const{PgPlanPartsStore:p}=await y(async()=>{const{PgPlanPartsStore:e}=await import("./store-BUKc8LII.js");return{PgPlanPartsStore:e}},__vite__mapDeps([5,6,2,7,8])),{capturePlanParts:d,ensurePlanPartsBaseline:s}=await y(async()=>{const{capturePlanParts:e,ensurePlanPartsBaseline:_}=await import("./federation-DiXxpdH-.js");return{capturePlanParts:e,ensurePlanPartsBaseline:_}},__vite__mapDeps([9,10,2,7,8]));await b(a,async e=>{const _=new p(e,a,i);t&&await s(_,l,t),await d(_,l,n,Date.now(),"local")})}catch{}}async function oe(a,i,l){if(typeof i.slug!="string"||!H.test(i.slug))throw new Error(`withPlanLock: invalid plan slug ${JSON.stringify(i.slug)}`);const{workspaceId:t,harnessSlug:n}=await B({harnessSlug:i.harnessSlug,workspaceId:i.workspaceId}),r=i.slug,p=q(n,r),d=`${t}:${n}:${r}`,s=(i.ttlSec??5)*1e3;return b(t,async e=>{let _=!1;const g=Date.now()+s;for(;;){if((await e`
        SELECT pg_try_advisory_xact_lock(hashtext('harness_plans'), hashtext(${d})) AS ok
      `)[0]?.ok){_=!0;break}if(Date.now()>=g)break;await P(50)}if(!_)return{kind:"busy",busy:[{path:p,owner:"unknown",owner_label:null,intent:"another plans write is in progress",expires_ts:null}]};const c=(await e`
      SELECT content, version, content_hash, template_data, input_schema
        FROM harness_shared.harness_plans
       WHERE workspace_id = ${t} AND harness_slug = ${n}
         AND plan_slug = ${r}
    `)[0]??null,w=c?Number(c.version):0,N=c?{version:w,contentHash:c.content_hash,templateData:c.template_data??null,inputSchema:c.input_schema??null}:null,{newBody:u,value:O,templateData:m,inputSchema:f}=await l(c?.content??null,N),$=m!==void 0,L=f!==void 0;let h=w,D=null;if(u!==null){h=w+1,D=u;const o=j(u),k=M(u),R=JSON.stringify(o.items),x=JSON.stringify(o.decisions),v=JSON.stringify(o.promotePolicy);let E=null;!c&&o.template&&(await e`
          SELECT seq FROM harness_shared.plan_revisions
           WHERE workspace_id = ${t} AND harness_slug = ${n}
             AND plan_slug = ${r}
           LIMIT 1
        `).length>0&&!$&&(E=`EI-14579: template-bearing plan '${r}' (template=${o.template}) was resurrected via a generic content write with no template_data supplied — its previous structured template_data is LOST (harness_plans keeps no history of it) and this row must be re-populated via the template's own repair/seed path (e.g. rubrics:propose) before it is trusted.`),await e`
        INSERT INTO harness_shared.harness_plans (
          workspace_id, harness_slug, plan_slug, content, content_hash, version,
          title, status, created, updated, owner, initiative, template, supersedes, superseded_by,
          is_legacy, items, decisions, now_state, now_next, promote_policy, origin
        ) VALUES (
          ${t}, ${n}, ${r}, ${u}, ${k}, ${h},
          ${o.title}, ${o.status}, ${o.created}, ${o.updated}, ${o.owner}, ${o.initiative}, ${o.template},
          ${o.supersedes}, ${o.supersededBy}, ${o.isLegacy},
          ${R}::text::jsonb, ${x}::text::jsonb, ${o.nowState}, ${o.nowNext}, ${v}::text::jsonb, 'local'
        )
        ON CONFLICT (workspace_id, harness_slug, plan_slug) DO UPDATE SET
          content       = EXCLUDED.content,
          content_hash  = EXCLUDED.content_hash,
          version       = ${h},
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
      `,await V(e,{workspaceId:t,harnessSlug:n,planSlug:r},o),E&&(console.warn(`[with-plan-lock] ${E}`),await e`
          INSERT INTO harness_shared.plan_revisions (
            workspace_id, harness_slug, plan_slug, seq, content_hash, content_snapshot, rationale,
            author_kind, author_id, session_id, session_kind, created_at
          )
          SELECT
            ${t}, ${n}, ${r}, COALESCE(MAX(seq), 0) + 1,
            ${k}, ${u}, ${E},
            'system', 'with-plan-lock:template-data-loss-guard', null, null, ${Date.now()}
          FROM harness_shared.plan_revisions
          WHERE workspace_id = ${t} AND harness_slug = ${n}
            AND plan_slug = ${r}
        `)}return($||L)&&(c||u!==null)&&(u===null&&(h=w+1,D=c.content),$&&await e`
          UPDATE harness_shared.harness_plans
             SET template_data = ${m.data===null?null:JSON.stringify(m.data)}::text::jsonb,
                 version       = ${h},
                 updated_at    = now(),
                 origin        = 'local'
           WHERE workspace_id = ${t} AND harness_slug = ${n}
             AND plan_slug = ${r}
        `,L&&await e`
          UPDATE harness_shared.harness_plans
             SET input_schema = ${f.schema===null?null:JSON.stringify(f.schema)}::text::jsonb,
                 version      = ${h},
                 updated_at   = now(),
                 origin       = 'local'
           WHERE workspace_id = ${t} AND harness_slug = ${n}
             AND plan_slug = ${r}
        `),{kind:"applied",value:O,filePath:p,version:h,scope:{workspaceId:t,harnessSlug:n},writtenBody:D,priorBody:c?.content??null}}).then(async e=>{if(e.kind==="applied"){const{writtenBody:_,priorBody:g,...c}=e;return _!==null&&i.afterWrite&&await i.afterWrite(_,{workspaceId:t,harnessSlug:n}),_!==null&&await K(t,n,r,g,_),c}return e}).catch(e=>{if(e?.code===A)return{kind:"busy",busy:[{path:p,owner:"unknown",owner_label:null,intent:"another plans write is in progress",expires_ts:null}]};throw e})}function le(a,i=new Date){const l=i.toISOString().slice(0,10);if(!a.startsWith("---"))return a;const t=a.indexOf(`
---`,3);if(t===-1)return a;const n=a.slice(0,t),r=a.slice(t),p=/^(updated:\s*).*$/m;return p.test(n)?n.replace(p,`$1${l}`)+r:n+`
updated: ${l}`+r}var A,P,ce=T((()=>{F(),X(),W(),G(),J(),I(),A="55P03",P=a=>new Promise(i=>setTimeout(i,a))}));export{ce as n,oe as r,le as t};
