import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-BiEJ-vhU.js";function r(e){if(e==null)return null;if(typeof e==`string`)try{let t=JSON.parse(e);return t&&typeof t==`object`&&!Array.isArray(t)?t:null}catch{return null}return typeof e==`object`&&!Array.isArray(e)?e:null}async function i(e,n={}){if(!e)return[];let{sql:i}=t(),a=Math.min(Math.max(1,n.limit??100),1e3);return(await i`
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
       ${n.layer?i`AND layer = ${n.layer}`:i``}
       ${n.category?i`AND category = ${n.category}`:i``}
       ${n.posture?i`AND posture = ${n.posture}`:i``}
       ${n.disposition?i`AND disposition = ${n.disposition}`:i``}
       ${n.sinceMs==null?i``:i`AND ts >= ${new Date(n.sinceMs).toISOString()}`}
     ORDER BY ts DESC
     LIMIT ${a}`).map(e=>({id:Number(e.id),ts:o(e.ts),layer:e.layer,harnessSlug:e.harness_slug,action:e.action,capability:e.capability,tier:e.tier,category:e.category,riskTier:e.risk_tier,reversibility:e.reversibility,authority:e.authority,posture:e.posture,outcome:e.outcome,outcomeCode:e.outcome_code,disposition:e.disposition,revisitAt:e.revisit_at==null?null:o(e.revisit_at),revertHandle:e.revert_handle,tripwireId:e.tripwire_id??null,why:e.why,links:r(e.links),actorRole:e.actor_role,actorSpawnId:e.actor_spawn_id,actorPrincipal:e.actor_principal,transport:e.transport,durationMs:e.duration_ms,metadata:r(e.metadata)}))}async function a(e,t={}){let n={total:0,byLayer:{},byPosture:{},byCategory:{},byDisposition:{},latestTs:null};if(!e)return n;let r=await i(e,{...t,limit:t.limit??1e3});if(r.length===0)return n;let a=(e,t)=>{let n=t??`unknown`;e[n]=(e[n]??0)+1},o={...n,byLayer:{},byPosture:{},byCategory:{},byDisposition:{}};for(let e of r)o.total+=1,a(o.byLayer,e.layer),a(o.byPosture,e.posture),a(o.byCategory,e.category),e.disposition&&a(o.byDisposition,e.disposition);return o.latestTs=r[0]?.ts??null,o}var o;e((()=>{n(),o=e=>e instanceof Date?e.toISOString():new Date(e).toISOString()}))();export{a as summarizeDecisionLedger};