import{n as l}from"./chunk-ChpBd9eV.js";import{st as y,t as p}from"./src-8fWtxfEz.js";function d(e){if(e==null)return null;if(typeof e=="string")try{const i=JSON.parse(e);return i&&typeof i=="object"&&!Array.isArray(i)?i:null}catch{return null}return typeof e=="object"&&!Array.isArray(e)?e:null}async function _(e,i={}){if(!e)return[];const{sql:o}=y(),s=Math.min(Math.max(1,i.limit??100),1e3);return(await o`
    SELECT id, ts, layer, harness_slug, action, capability, tier, category,
           risk_tier, reversibility, authority, posture, outcome, outcome_code,
           disposition, revisit_at, revert_handle, why, links,
           actor_role, actor_spawn_id, actor_principal, transport, duration_ms, metadata,
           -- B-16 undo seam: the still-armed tripwire correlated to this decision, if
           -- any. Correlated subselect (not a JOIN) keeps every existing column
           -- reference unqualified + guarantees one row; the partial index
           -- autonomy_tripwires_decision_id_idx (workspace_id, decision_id) serves it.
           -- Gated to status='armed' so the feed's Undo shows only when it can act.
           (SELECT t.id
              FROM harness_shared.autonomy_tripwires t
             WHERE t.decision_id = decision_ledger.id::text
               AND t.workspace_id = decision_ledger.workspace_id
               AND t.status = 'armed'
             LIMIT 1) AS tripwire_id
      FROM harness_shared.decision_ledger
     WHERE workspace_id = ${e}
       ${i.layer?o`AND layer = ${i.layer}`:o``}
       ${i.category?o`AND category = ${i.category}`:o``}
       ${i.posture?o`AND posture = ${i.posture}`:o``}
       ${i.disposition?o`AND disposition = ${i.disposition}`:o``}
       ${i.sinceMs!=null?o`AND ts >= ${new Date(i.sinceMs).toISOString()}`:o``}
     ORDER BY ts DESC
     LIMIT ${s}`).map(t=>({id:Number(t.id),ts:n(t.ts),layer:t.layer,harnessSlug:t.harness_slug,action:t.action,capability:t.capability,tier:t.tier,category:t.category,riskTier:t.risk_tier,reversibility:t.reversibility,authority:t.authority,posture:t.posture,outcome:t.outcome,outcomeCode:t.outcome_code,disposition:t.disposition,revisitAt:t.revisit_at!=null?n(t.revisit_at):null,revertHandle:t.revert_handle,tripwireId:t.tripwire_id??null,why:t.why,links:d(t.links),actorRole:t.actor_role,actorSpawnId:t.actor_spawn_id,actorPrincipal:t.actor_principal,transport:t.transport,durationMs:t.duration_ms,metadata:d(t.metadata)}))}async function b(e,i={}){const o={total:0,byLayer:{},byPosture:{},byCategory:{},byDisposition:{},latestTs:null};if(!e)return o;const s=await _(e,{...i,limit:i.limit??1e3});if(s.length===0)return o;const t=(a,u)=>{const c=u??"unknown";a[c]=(a[c]??0)+1},r={...o,byLayer:{},byPosture:{},byCategory:{},byDisposition:{}};for(const a of s)r.total+=1,t(r.byLayer,a.layer),t(r.byPosture,a.posture),t(r.byCategory,a.category),a.disposition&&t(r.byDisposition,a.disposition);return r.latestTs=s[0]?.ts??null,r}var n,w=l((()=>{p(),n=e=>e instanceof Date?e.toISOString():new Date(e).toISOString()}));export{_ as n,b as r,w as t};
