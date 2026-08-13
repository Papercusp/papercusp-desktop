const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/src-DP1Swm9e.js","assets/src-l3Ts7dqj.js","assets/chunk-ChpBd9eV.js","assets/preload-helper-CcgcQsTF.js","assets/src-6Py4l2MU.js","assets/src-DZqanng7.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/state-delta-CKc5XQHb.js","assets/src-D8obk7J1.js","assets/src-BmBNODK0.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/drizzle-orm-BbO4Lkx2.js","assets/dist-CSbV2Mo_.js","assets/ajv-CqMdBrM-.js","assets/fast-deep-equal-BBt3aDEm.js","assets/v4-DGS_julY.js","assets/role-config-B_m8jODy.js","assets/goal-launch-settings-DAersf2U.js","assets/goal-session-Bkzcc6bs.js","assets/store-BvhM51on.js","assets/agent-orders-notify-ChDuQYtG.js","assets/registry-DfyKxObQ.js","assets/kill-criterion-Be5ZJDIs.js","assets/machine-authored-1UXcD_Fx.js","assets/machine-authored-Bi_Q3FI8.js","assets/premise-resolve-B-fjZq3_.js","assets/premise-resolve-Dg2MUVqR.js","assets/message-fields-C66UN72_.js","assets/premise-probes-CuWZp9fn.js","assets/premise-probes-BpFZAhL1.js","assets/unanswered-directed-BiLTfvPd.js","assets/unanswered-directed-BKm3Gz1A.js","assets/log-BwQLkm9I.js","assets/coordination-event-log-browser-s_EyGDm7.js","assets/server-CB1HiStO.js","assets/types-B6UfiA7g.js","assets/src-CL56NiZm.js","assets/flag-distinct-id-CCLxG4xU.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-als-CSW21ZcE.js","assets/workspace-id-constant-AQ2MH5pQ.js"])))=>i.map(i=>d[i]);
import{n as O}from"./chunk-ChpBd9eV.js";import{n as q,t as T}from"./preload-helper-CcgcQsTF.js";import{st as $,t as Z}from"./src-BmBNODK0.js";import{c as ee,r as te}from"./workspace-registry-Du2UbhlH.js";function se(e){const t=typeof e=="string"?e:typeof e=="object"&&e!==null&&typeof e.tool=="string"?e.tool:null;return t?/^\s*(coord:[a-zA-Z0-9_\-]+)/.exec(t)?.[1]??null:null}function ae(e){const t=new Map;for(const a of e)if(Array.isArray(a.seeAlso))for(const o of a.seeAlso){const i=se(o);if(!i)continue;let d=t.get(i);d||t.set(i,d=new Set),d.add(a.name)}const n=new Map;for(const[a,o]of t){const i=[...o].sort();n.set(a,{tier:"see-also",evidence:`Surfaced at result time by ${i.length} tool(s): ${i.slice(0,5).join(", ")}${i.length>5?`, +${i.length-5} more`:""}. DERIVED from the live registry, not asserted — delete the pointer and this tier disappears on the next pass.`})}return n}function oe(e,t=H){const n=new Map(e);for(const[a,o]of t)n.set(a,o);return n}function B(e){return[e.tierRank??(e.tier==="prompt-only"?8:9),-e.calls,e.id]}function ne(e){const t=e.declared??H,n=new Set,a=[];for(const o of e.behaviourIds){if(n.has(o))continue;n.add(o);const i=t.get(o),d=i?.tier??"undeclared",l=e.adoption.get(o),h=l?.calls??0,w=i!=null&&V.includes(i.tier);a.push({id:o,tier:d,tierRank:i?K[i.tier]:null,evidence:i?.evidence??null,calls:h,callers:l?.callers??0,tierDebt:i==null,retirementCandidate:h===0&&!w})}return a.sort((o,i)=>{const[d,l,h]=B(o),[w,R,f]=B(i);return d-w||l-R||h.localeCompare(f)}),{windowDays:e.windowDays,rows:a,totals:{behaviours:a.length,declared:a.filter(o=>!o.tierDebt).length,undeclared:a.filter(o=>o.tierDebt).length,promptOnly:a.filter(o=>o.tier==="prompt-only").length,enforced:a.filter(o=>o.tierRank!=null).length,retirementCandidates:a.filter(o=>o.retirementCandidate).length,zeroCall:a.filter(o=>o.calls===0).length}}}function re(e){const t=[];for(const n of e)n.startsWith("coord:")&&t.push(n);return t.sort()}async function ie(e){const t=await e.getSql()`
    SELECT tool_name,
           count(*)                       AS calls,
           count(DISTINCT coord_owner_id) AS callers
     FROM harness_shared.tool_invocations
     WHERE workspace_id = ${e.workspaceId}
       AND tool_name LIKE ${"coord:%"}
       AND harness_shared.is_agent_coord_owner_id(coord_owner_id, role)
       AND invoked_at >= now() - make_interval(days => ${e.windowDays})
     GROUP BY tool_name
  `,n=new Map;for(const a of t)n.set(a.tool_name,{calls:Number(a.calls),callers:Number(a.callers)});return n}async function de(){try{const{listAllProjectedTools:e}=await T(async()=>{const{listAllProjectedTools:a}=await import("./src-DP1Swm9e.js");return{listAllProjectedTools:a}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26])),t=[];for(const a of e()){const o=a.expose?.mcp?.name;o&&t.push({name:o,seeAlso:a.seeAlso})}const n=re(t.map(a=>a.name));return n.length<20?void 0:{behaviourIds:n,derivedTiers:ae(t)}}catch{return}}var ce,K,V,H,le,he,ue=O((()=>{q(),ce="undeclared",K=Object.freeze({"auto-stamp":1,"schema-refusal":2,"see-also":3,"prompt-only":null}),V=Object.freeze(["auto-stamp","schema-refusal","see-also"]),H=new Map([["coord:dispatch",{tier:"see-also",evidence:"coord:presence's resolver unconditionally builds a READY-TO-INVOKE coord:dispatch call into its payload (buildDispatchHandle, coordination/dispatch-handle.ts) whenever a lane and a wakeable target both resolve — a prefilled call, not a mention. This is DECLARED rather than derived because P-012/D-101 deliberately REMOVED the seeAlso string literal from presence.ts (it bought 1 call in 30 days; see the NB at presence.ts) and replaced it with the handle. The tier-3 derivation scans source for that literal, so it structurally cannot see the stronger mechanism that replaced it. Falsifiable, not self-asserted: delete the buildDispatchHandle call and dispatch-handle.ts's tests plus dispatch-adoption-falsifier.ts fail."}],["coord:send",{tier:"schema-refusal",evidence:"The message envelope is validated at the tool boundary: a hand-authored agent message without sections is refused. This is the 2026-07-27 step-function — 0% -> 73% overnight on a schema change with NO prompt change, held 72–81% for the following week."}],["coord:declare-intent",{tier:"auto-stamp",evidence:"coord:orient declares intent as part of the mandated wake bootstrap, so the agent never has to remember a separate call. The stamping happens on a path every wake already takes."}],["coord:inbox",{tier:"auto-stamp",evidence:"The BEHAVIOUR (read your directed mail) is folded into coord:orient at the same chokepoint: orient returns `inbox.summary` + bounded `recent`, and the tool contract tells callers NOT to re-read it separately after a successful orient. Kept even in orient's `monitor` mode, which drops nearly every other fold."}],["coord:plan-events",{tier:"auto-stamp",evidence:"Folded into coord:orient as the `planEvents` delta (orient.ts: the mandated bootstrap collapses memory:search + coord:inbox + coord:plan-events + coord:declare-intent into one round-trip), so an agent receives the delta without remembering the call."}]]),le="coord:",he=20}));function me(e,t=k){const n={sendCalls:e.sendCalls,windowDays:e.windowDays};if(e.sendCalls<t.minSendCalls)return{verdict:"undetermined",denominator:n,why:`only ${e.sendCalls} coord:send calls in ${e.windowDays}d (floor ${t.minSendCalls}) — the fleet was too quiet for this ratio to mean anything. Re-measure over a busier window; do NOT read this as evidence against coord:dispatch.`};if(e.asOf<t.reEvaluateAfter)return{verdict:"undetermined",denominator:n,why:`sampled ${e.asOf}, before the agreed ${t.reEvaluateAfter} — the seeding (P-011) and handles (P-012) need a full window in front of agents before their effect can be read.`};const a=e.dispatchCalls/e.sendCalls*1e3,o=a/S.ratePerThousand,i=a>=t.ratePerThousand,d=e.dispatchAgents>=t.distinctAgents;return i&&d?{verdict:"keep",ratePerThousand:a,liftVsBaseline:o,denominator:n,why:`${a.toFixed(2)}/1k sends across ${e.dispatchAgents} agents — ${o.toFixed(1)}x the ${S.ratePerThousand}/1k baseline, clearing the ${t.ratePerThousand}/1k + ${t.distinctAgents}-agent bar. The delivery theory held: the verb was unreachable, not unwanted.`}:{verdict:"retire",ratePerThousand:a,liftVsBaseline:o,denominator:n,why:`${[i?null:`rate ${a.toFixed(2)}/1k < ${t.ratePerThousand}/1k`,d?null:`${e.dispatchAgents} agent(s) < ${t.distinctAgents}`].filter(Boolean).join("; ")}. coord:dispatch was seeded onto the live surface AND handed to agents pre-addressed inside coord:presence and plan_items:release, and still was not reached for. The delivery theory is FALSIFIED.`,alsoRetires:["coord:dispatch","coord:handoff"],finding:"This fleet does not hand off lanes. Directed work-handoff was near-zero across EVERY door (dispatch 1, handoff 0, fleet:place_batch 1, coord:wake 18) while conversation was enormous (coord:send 3,724 / 186 agents). Having removed delivery as the explanation, what remains is a property of the coordination model — agents self-claim from the queue and talk about it — not a tooling gap. Record that and stop building handoff doors."}}var S,k,pe=O((()=>{S={measuredAt:"2026-08-09",windowDays:14,dispatchCalls:1,dispatchAgents:1,sendCalls:3724,sendAgents:186,ratePerThousand:.2685},k={ratePerThousand:3,distinctAgents:3,minSendCalls:500,reEvaluateAfter:"2026-09-08"}}));function fe(e){return e.toISOString().slice(0,10)}async function ge(e){const t=e.windowDays??14,n=e.now??new Date,a=(await e.getSql()`
    SELECT
      count(*) FILTER (WHERE tool_name = ${C})                       AS dispatch_calls,
      count(DISTINCT coord_owner_id) FILTER (WHERE tool_name = ${C}) AS dispatch_agents,
      count(*) FILTER (WHERE tool_name = ${M})                           AS send_calls,
      (SELECT min(invoked_at)
         FROM harness_shared.tool_invocations
        WHERE harness_shared.is_agent_coord_owner_id(coord_owner_id, role))      AS oldest_retained
      FROM harness_shared.tool_invocations
     WHERE tool_name IN (${C}, ${M})
       AND harness_shared.is_agent_coord_owner_id(coord_owner_id, role)
       AND invoked_at >= now() - make_interval(days => ${t})
  `)?.[0];if(!a||a.oldest_retained==null)return;const o=new Date(a.oldest_retained);if(Number.isNaN(o.getTime()))return;const i=Math.max(0,Math.floor((n.getTime()-o.getTime())/864e5)),d=Math.min(t,i);if(!(d<=0))return{sample:{dispatchCalls:Number(a.dispatch_calls),dispatchAgents:Number(a.dispatch_agents),sendCalls:Number(a.send_calls),windowDays:d,asOf:fe(n)},coverage:{requestedWindowDays:t,coveredWindowDays:i,shortfall:i<t,oldestRetainedAt:o.toISOString()}}}var C,M,we,ye=O((()=>{C="coord:dispatch",M="coord:send",we=14}));function U(e){return e.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48)||"unknown"}function L(e,t){return e.length>t?`${e.slice(0,t-1)}…`:e}function Ee(e){const t=Math.round(e/6e4);if(t<60)return`${t}m`;const n=Math.floor(t/60),a=t%60;return a?`${n}h${a}m`:`${n}h`}function _e(e,t={}){const n=t.minEscalationReMounts??3,a=t.minUnanswered??5,o=t.minWakeStorm??200,i=t.minClaimConflicts??3,d=t.minPremiseChecked??5,l=t.minClarifyAsks??5,h=t.minAuthoredAdoptionMessages??20,w=t.minTierDebt??1,R=t.limit??10,f=[],m=[...e.escalationStorms].filter(s=>s.severity==="blocker"&&s.count>=1||s.count>=n).sort((s,c)=>(c.severity==="blocker"?1:0)-(s.severity==="blocker"?1:0)||c.count-s.count);for(const s of m)f.push({category:"coord-health",ref:`coord:escalation-storm:${U(s.signature)}`,summary:`escalation re-mounted ${s.count}× in 24h (${s.severity}): ${L(s.signature,80)} — a repeating cascade, not a one-off`,detail:`${s.count} escalation event(s)/24h on the same signature${s.sample?`; e.g. "${L(s.sample,120)}"`:""}. A known-benign transient re-mounting a full escalation cascade (fresh work-item + probe + owner alert) means the "is this the same incident" dedup gate is too narrow (EI-9492): widen the dedup key or add a recently-resolved suppression so the same condition can't re-page every wake.`,weight:s.severity==="blocker"?1:.8});const _=[...e.unansweredTargets].filter(s=>s.count>=a).sort((s,c)=>c.count-s.count);if(_.length>0){const s=_.reduce((u,A)=>u+A.count,0),c=_.slice(0,5).map(u=>`${u.recipient} ${u.count} (${Ee(u.oldestAgeMs)})`).join(", ");f.push({category:"coord-health",ref:"coord:unanswered",summary:`${_.length} agent(s) hold ≥${a} unanswered directed message(s) (${s} total) — directed comms are stalling`,detail:`worst: ${c}. A directed message OUTRANKS the recipient's own work; a per-agent backlog that grows across wakes despite landed nudges is a coordination-comms stall (agents alive, producing turns, but not converting into reply-drain or claim progress) — the reply-obligation surfacing or the wake→reply path may be failing.`,weight:.7})}e.claimConflicts>=i&&f.push({category:"coord-health",ref:"coord:claim-conflict",summary:`${e.claimConflicts} claim conflict(s) in 24h — agents contending for the same work-item`,detail:"repeated claim conflicts mean the scheduler/claim-spec is surfacing the same item to multiple agents, or a stale claim is not releasing on session death; check claim TTLs, the hold-open sweep cadence, and scheduler dedup.",weight:.6});const g=e.premiseResolve;if(g&&g.checked>=d){const s=g.checked-g.holds,c=g.holds/g.checked,u=1-c,A=p=>`${Math.round(p*100)}%`,v=[...g.byKind].filter(p=>p.checked>0).sort((p,N)=>N.checked-N.holds-(p.checked-p.holds)||N.checked-p.checked).map(p=>`${p.kind} ${p.holds}/${p.checked}`).join(", "),D=g.samples.slice(0,4).map(p=>`${p.ref} → ${p.status}${p.note?` (${L(p.note,60)})`:""}`).join("; ");f.push({category:"coord-health",ref:"coord:premise-resolve-rate",summary:`premise refs resolve ${A(c)} (${g.holds}/${g.checked} checked; ${s} failing) — cited ground that does not hold`,detail:`by ref kind: ${v||"n/a"}. ${g.refsSeen} distinct agent-authored premise ref(s) in 24h; ${g.notCheckable} not-checkable (doc/opaque — declarable but never invalidatable, D-026, deliberately outside the rate) and ${g.unknown} unknown (the probe failed — our gap, not the sender's).`+(D?` Failing: ${D}.`:"")+" A premise is what a sender's reasoning RESTED ON, so a ref that does not resolve means a message was built on ground that was never there (broken) or has since moved (stale). Read this by REF GRAMMAR, never by sender: the fix for a failing kind is a clearer ref form in the tool description and the docs. NOT a gate — a low rate never blocks, warns, or refuses a send (D-091; D-088's standing condition that verification is never authorisation).",weight:Math.min(.75,.25+.5*u)})}const E=e.clarifyAdoption;if(E&&E.asks>=l){const s=E.answered/E.asks,c=Y,u=v=>`${Math.round(v*100)}%`,A=s>c?`ABOVE the ${u(c)} conversation-path baseline — moving clarification onto the live path is paying`:`at or BELOW the ${u(c)} conversation-path baseline — the live path is not (yet) buying a better answer rate`;f.push({category:"coord-health",ref:"coord:clarify-answer-rate",summary:`clarify asks answered ${u(s)} (${E.answered}/${E.asks}) — ${A}`,detail:`${E.asks} agent-authored message(s) carried a \`clarify\` section in 24h (${E.entries} entr(y|ies) total); ${E.answered} drew a reply. \`clarify\` pairs a question with the assumption the sender proceeds on ANYWAY, so an unanswered ask is not a stalled sender — it is a peer acting on an assumption nobody corrected. Baseline to beat (measured before the field existed): the conversation path answered ~${u(c)} of questions and orphaned 76%, and coord:ask drew 6 calls against coord:send's 3512. Read this as a reading on the MECHANISM, never on the askers: no per-agent breakdown exists or may be added, because attaching a consequence to being seen asking is what kills the field (D-091/D-090 R3). Never a gate, and never a fill rate — \`assuming\` is schema-mandatory, so its fill rate is 100% by construction and measures nothing (D-104).`,weight:Math.min(.7,.25+Math.max(0,c-s))})}const r=e.authoredAdoption;if(r&&r.handAuthored>=h){const s=(J,j)=>j>0?`${Math.round(J/j*100)}%`:"n/a",c=`${r.bypassedChokepoint} bypassed`,u=s(r.withAuthoredField,Math.max(r.withSections,1)),A=s(r.withAuthoredField,r.handAuthored),v=r.openQuestions>0?r.openQuestionsAnswered/r.openQuestions:null,D=r.plainMessages>0?r.plainMessagesAnswered/r.plainMessages:null,p=v===null?"no actionable messages":D===null?`${s(r.openQuestionsAnswered,r.openQuestions)} (no control arm this window — uninterpretable)`:`${s(r.openQuestionsAnswered,r.openQuestions)} vs ${s(r.plainMessagesAnswered,r.plainMessages)} plain (${v>=D?"+":""}${Math.round((v-D)*100)}pp)`,N=r.withAuthoredField,x=N>0&&r.structureReads*10<N;f.push({category:"coord-health",ref:"coord:authored-adoption",summary:`authored structure — L1 enforcement ${c} (never reached the schema; ${r.handAuthored} hand-authored did), L2 substantive ${A} of all hand-authored (${r.withAuthoredField}/${r.handAuthored}; ${u} = ${r.withAuthoredField}/${r.withSections} of those carrying structure), L3 open-questions answered ${p}`+(x?` — READ-STARVED: ${N} written vs ${r.structureReads} coord:read`:""),detail:`Three levels, deliberately NOT collapsed into one number. L1 ENFORCEMENT ${r.bypassedChokepoint} message(s) reached the log WITHOUT passing coord:send's schema — emitted by code calling the sendMessage seam directly under an agent's ownerId. That is the only actionable L1 number: true schema compliance is now 100% BY CONSTRUCTION (the string body is refused), and per D-016 a field that is 100% by construction measures nothing. ⚠ D-095: this slot used to report "${r.withSections}/${r.handAuthored} carry sections" as a COMPLIANCE rate. It never was one — stampMessageFields writes \`sections\` only when they carry something (authored || >1), so the compliant minimum body:[{text}] persists no sections key and counted as a FAILURE. Measured: 200 of 236 such messages had passed the schema. \`withSections\` is an L2 reading (authored ∪ multi-section), and is reported as one below. L2 SUBSTANCE ${r.withAuthoredField}/${r.handAuthored} hand-authored messages fill an authored field (${A}) — the unconditional rate, and the one to read. Conditionally, ${r.withAuthoredField}/${r.withSections} of those already carrying structure do, and ${r.multiSection} carry more than one section; that conditional rate stays high even when structure is rare, which is why both denominators are stated. L3 CONSEQUENCE ${r.openQuestionsAnswered}/${r.openQuestions} messages carrying an ACTIONABLE authored field (couldNotDetermine / youMayNotKnow) drew a reply, against a CONTROL arm of ${r.plainMessagesAnswered}/${r.plainMessages} hand-authored messages with no authored field at all — same senders, same window. The control is what makes the treatment rate mean anything (D-085): a bare reply rate is a success or a failure depending on what a plain message gets, and reporting it alone is how a correct numerator becomes a wrong conclusion. coord:read — the only surface showing authored structure IN FULL — was called ${r.structureReads} time(s) in 24h. The in-band [coord+N] marker carries the forYouBecause RELATION and mere COUNTS; the note, the youMayNotKnow items and premises past the first are only visible through coord:read. A LOW L3 against a HIGH L2 is the diagnostic this signal exists to make visible: it means the write half of "agents write their intent and other agents read it" shipped and the read half did not. (Stated against L2 since D-095 — L1 is now an enforcement count, and a count of bypasses says nothing about whether written structure is being read.) Denominators are stated inline on purpose — a ratio quoted without one is how "0.58% adopted" was published from a numerator that was exactly right (EI-19300252001829260). Aggregate-only, and no per-sender breakdown exists or may be added: attaching a consequence to being seen authoring these fields is what kills them (D-090/D-091 R3).`,weight:x?.65:Math.max(r.bypassedChokepoint>0?.4:0,Math.min(.5,.2+(1-r.withAuthoredField/Math.max(r.handAuthored,1))*.3))})}const b=e.enforcementCensus;if(b&&b.totals.undeclared>=w){const s=b.totals,c=b.rows.filter(u=>u.retirementCandidate).slice(0,6).map(u=>u.id);f.push({category:"coord-health",ref:"coord:enforcement-tier-census",summary:`enforcement tiers — ${s.undeclared}/${s.behaviours} coordination verbs carry NO declared tier, ${s.enforced}/${s.behaviours} carry a real one (D-001 tier 1–3); ${s.zeroCall}/${s.behaviours} took zero calls in ${b.windowDays}d, of which ${s.retirementCandidates} are both unused AND unenforced`,detail:`Generated from the live tool registry, never a hand-kept list: a coordination verb added tomorrow surfaces here as debt with nobody remembering to list it. TIER DEBT ${s.undeclared}/${s.behaviours} have no declaration at all — the D-016/D-047 gap. ENFORCED ${s.enforced}/${s.behaviours} carry one of D-001's tiers 1–3 (auto-stamp / schema-refusal / see-also). PROMPT-ONLY ${s.promptOnly} are declared but enforced only by prose, which D-016 says is not a tier — that is the finding, not a passing grade. ZERO-CALL ${s.zeroCall}/${s.behaviours} took no call in the ${b.windowDays}d window. RETIREMENT CANDIDATES ${s.retirementCandidates} are zero-call AND unenforced`+(c.length?` (e.g. ${c.join(", ")})`:"")+`. A zero-call verb that DOES carry a real tier is deliberately NOT flagged — that is a different finding (built but unreached), and conflating the two would propose retiring working machinery. ⚠ CANDIDATE, never a verdict: D-092 ruled that the zero-call verbs are NOT to be retired — make them discoverable first, re-measure at +7d, and retire only what stays at zero. This reading is the input to that re-measurement, which is why the window is ${b.windowDays}d and not 24h: over 24h a merely weekly verb reads as dead. Denominators are stated inline on purpose (D-003), and there is no single blended "enforcement %" — a mean over "how enforced is this" is precisely the summary that hides which rung a behaviour sits on. The fix for an undeclared row is to find the MECHANISM that enforces it and declare that; if none exists, the honest tier is prompt-only, and D-001's ruling then applies: a behaviour that cannot be given tier 1–3 is a candidate for retirement, not for more prompt text.`,weight:Math.min(.55,.2+s.undeclared/Math.max(s.behaviours,1)*.35)})}const y=e.dispatchAdoption;if(y){const s=`${y.sample.sendCalls} coord:send calls / ${y.sample.windowDays}d`,c=y.verdict.verdict==="undetermined"?null:`${y.verdict.ratePerThousand.toFixed(2)}/1k`,u=y.coverage.shortfall?` ⚠ telemetry retention could only substantiate ${y.coverage.coveredWindowDays}d of the ${y.coverage.requestedWindowDays}d asked for (oldest retained row ${y.coverage.oldestRetainedAt}), so the window published here is the one the data supports, not the one requested.`:"";f.push({category:"coord-health",ref:"coord:dispatch-adoption-verdict",summary:`coord:dispatch retirement falsifier — ${y.verdict.verdict.toUpperCase()}`+(c?` at ${c} sends across ${y.sample.dispatchAgents} agent(s)`:"")+` (denominator ${s}; bar ${k.ratePerThousand}/1k + ${k.distinctAgents} agents, not judgeable before ${k.reEvaluateAfter})`,detail:`${y.verdict.why} DENOMINATOR STATED INLINE per D-003: ${s}, sampled ${y.sample.asOf} across ALL tenants — the same population the baseline was measured over (${S.dispatchCalls} dispatch / ${S.sendCalls} sends over ${S.windowDays}d = ${S.ratePerThousand}/1k). A sample scoped differently from its baseline would report a lift between two different populations. `+u+" ⚠ UNDETERMINED IS NEVER UPGRADED TO RETIRE (the asymmetry is deliberate): an absent measurement must not read as absent demand. A `retire` verdict retires coord:dispatch AND coord:handoff together (D-102 folded handoff in, because deleting the handoff store before the measurement would have destroyed the evidence). This reading is emitted every cycle so the verdict is a standing, dated record rather than a one-shot nobody witnessed.",weight:y.verdict.verdict==="undetermined"?.15:.5})}const G=[...e.wakeStorms].filter(s=>s.count>=o).sort((s,c)=>c.count-s.count);for(const s of G)f.push({category:"coord-health",ref:`coord:wake-storm:${U(s.recipient)}`,summary:`${s.recipient} received ${s.count} coord message(s) in 24h — an inbox/wake flood`,detail:`${s.count} deliveries/24h to one recipient. A subscription firehose or a re-firing sender is flooding this inbox — if most are near-duplicates the coalescing/dedup is leaking; heavy wake traffic burns turns and buries real directed mail under noise.`,weight:Math.min(.6,.2+s.count/5e3)});const F=Math.max(1,R),P=s=>z.some(c=>s.ref.startsWith(c)),X=f.reduce((s,c)=>P(c)?s:s+1,0);let W=Math.max(0,F-X);const I=new Set;for(const s of f)P(s)?W>0&&(I.add(s),W-=1):I.add(s);return f.filter(s=>I.has(s)).slice(0,F)}async function Ae(e){try{const{sql:t}=$(),[{MACHINE_SENDER_PATTERN:n},{resolvePremiseStamps:a,PREMISE_STAMPS_MAX:o},{premiseProbes:i}]=await Promise.all([T(()=>import("./machine-authored-1UXcD_Fx.js"),__vite__mapDeps([27,28,2])),T(()=>import("./premise-resolve-B-fjZq3_.js"),__vite__mapDeps([29,30,2,31,6,7])),T(()=>import("./premise-probes-CuWZp9fn.js"),__vite__mapDeps([32,33,2,3]))]),d=(await t`
      SELECT DISTINCT p AS ref
        FROM harness_shared.coord_event_log e
        CROSS JOIN LATERAL jsonb_array_elements(e.body->'sections') s
        CROSS JOIN LATERAL jsonb_array_elements_text(s->'premises') p
       WHERE e.workspace_id = ${e}
         AND e.surface = 'messages'
         AND e.ts > now() - interval '24 hours'
         AND jsonb_typeof(e.body->'sections') = 'array'
         AND jsonb_typeof(s->'premises') = 'array'
         AND NOT (coalesce(e.body->>'from', '') ~ ${n})
       LIMIT ${Q}`).map(w=>w.ref).filter(Boolean);if(d.length===0)return;const l=i({}),h=[];for(let w=0;w<d.length;w+=o)h.push(...await a(d.slice(w,w+o),l));return be(h)}catch{return}}function be(e){const t=new Map;let n=0,a=0,o=0,i=0;const d=[];for(const l of e){if(l.status==="not-checkable"){o+=1;continue}if(l.status==="unknown"){i+=1;continue}let h=t.get(l.kind);h||(h={kind:l.kind,checked:0,holds:0,broken:0,stale:0,unresolvable:0},t.set(l.kind,h)),h.checked+=1,n+=1,l.status==="holds"?(h.holds+=1,a+=1):(l.status==="broken"?h.broken+=1:l.status==="stale"?h.stale+=1:h.unresolvable+=1,d.length<8&&d.push({ref:l.ref,status:l.status,note:l.note}))}return{refsSeen:e.length,checked:n,holds:a,byKind:[...t.values()],notCheckable:o,unknown:i,samples:d}}async function ve(e){try{const{sql:t}=$(),{MACHINE_SENDER_PATTERN:n}=await T(async()=>{const{MACHINE_SENDER_PATTERN:o}=await import("./machine-authored-1UXcD_Fx.js");return{MACHINE_SENDER_PATTERN:o}},__vite__mapDeps([27,28,2])),a=(await t`
      WITH asks AS (
        SELECT e.body->>'msg_id' AS msg_id,
               e.body->'to'      AS recipients,
               (
                 SELECT count(*)
                   FROM jsonb_array_elements(e.body->'sections') s2
                   CROSS JOIN LATERAL jsonb_array_elements(s2->'clarify') c
                  WHERE jsonb_typeof(s2->'clarify') = 'array'
               )::int AS entries
          FROM harness_shared.coord_event_log e
         WHERE e.workspace_id = ${e}
           AND e.surface = 'messages'
           AND e.ts > now() - interval '24 hours'
           AND jsonb_typeof(e.body->'sections') = 'array'
           AND e.body->>'msg_id' IS NOT NULL
           AND NOT (coalesce(e.body->>'from', '') ~ ${n})
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(e.body->'sections') s
              WHERE jsonb_typeof(s->'clarify') = 'array'
                AND jsonb_array_length(s->'clarify') > 0
           )
      ),
      -- MATERIALISE THE REPLIES ONCE. The obvious shape -- a correlated EXISTS
      -- over coord_event_log per ask -- is a full scan PER ASK (related_msg_id
      -- lives in jsonb and is unindexed), so it costs nothing while clarify has
      -- no traffic and TIMES OUT the moment it does. Not hypothetical: the
      -- correlated form was measured against a populated field of the same
      -- shape (premises) and hit the statement timeout, while this one returns
      -- in ~35ms over the same rows. A lane query that only works while its
      -- field is unused is a latent outage, and a zero-traffic read can never
      -- reveal it.
      replies AS (
        SELECT DISTINCT r.body->>'related_msg_id' AS to_msg_id,
                        r.body->>'from'           AS responder
          FROM harness_shared.coord_event_log r
         WHERE r.workspace_id = ${e}
           AND r.surface = 'messages'
           AND r.ts > now() - interval '24 hours'
           AND r.body ? 'related_msg_id'
      )
      SELECT count(*)::int AS asks,
             coalesce(sum(a.entries), 0)::int AS entries,
             count(*) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM replies rp
                  WHERE rp.to_msg_id = a.msg_id
                    AND a.recipients @> to_jsonb(ARRAY[rp.responder])
               )
             )::int AS answered
        FROM asks a`)[0];return!a||Number(a.asks)===0?void 0:{asks:Number(a.asks)||0,answered:Number(a.answered)||0,entries:Number(a.entries)||0}}catch{return}}async function Ne(e){try{const t=await de();if(!t)return;const n=await ie({workspaceId:e,windowDays:7,getSql:()=>$().sql});return ne({behaviourIds:t.behaviourIds,adoption:n,windowDays:7,declared:oe(t.derivedTiers)})}catch{return}}async function Se(e){try{const{sql:t}=$(),{MACHINE_SENDER_PATTERN:n,AGENT_SESSION_SENDER_PATTERN:a}=await T(async()=>{const{MACHINE_SENDER_PATTERN:d,AGENT_SESSION_SENDER_PATTERN:l}=await import("./machine-authored-1UXcD_Fx.js");return{MACHINE_SENDER_PATTERN:d,AGENT_SESSION_SENDER_PATTERN:l}},__vite__mapDeps([27,28,2])),o=(await t`
      WITH hand AS (
        SELECT e.body->>'msg_id' AS msg_id,
               e.body->'to'      AS recipients,
               (jsonb_typeof(e.body->'sections') = 'array')                    AS has_sections,
               coalesce(jsonb_array_length(
                 CASE WHEN jsonb_typeof(e.body->'sections') = 'array'
                      THEN e.body->'sections' ELSE '[]'::jsonb END), 0)        AS n_sections,
               EXISTS (
                 SELECT 1 FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(e.body->'sections') = 'array'
                        THEN e.body->'sections' ELSE '[]'::jsonb END) s
                  WHERE s ?| array['forYouBecause','premises','youMayNotKnow','couldNotDetermine']
               ) AS has_authored,
               EXISTS (
                 SELECT 1 FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(e.body->'sections') = 'array'
                        THEN e.body->'sections' ELSE '[]'::jsonb END) s
                  WHERE (jsonb_typeof(s->'couldNotDetermine') = 'array'
                         AND jsonb_array_length(s->'couldNotDetermine') > 0)
                     OR (jsonb_typeof(s->'youMayNotKnow') = 'array'
                         AND jsonb_array_length(s->'youMayNotKnow') > 0)
               ) AS has_actionable
          FROM harness_shared.coord_event_log e
         WHERE e.workspace_id = ${e}
           AND e.surface = 'messages'
           AND e.ts > now() - interval '24 hours'
           AND e.body->>'kind' = 'message'
           AND e.body->>'msg_id' IS NOT NULL
           AND NOT (coalesce(e.body->>'from', '') ~ ${n})
           -- BOTH filters, and the positive one is load-bearing. The negative
           -- pattern is conservative by design and admits ~1,738 emitters/24h
           -- (git-sync-*, green-checkpoint, intent-divergence-detector, …) that
           -- have ZERO sectioned messages because they never reach coord:send's
           -- schema. Measured: including them deflates L1 from 77.2% to 23.2%.
           AND coalesce(e.body->>'from', '') ~ ${a}
           AND coalesce(e.body->>'auto', 'false') <> 'true'
           -- D-095, THE THIRD FILTER, and it is positive for the same reason the
           -- sender pattern above is. coord:send REQUIRES expects (no default,
           -- refused at the arg schema), and sendMessage derives it
           -- only for machine/auto senders — both already excluded. So on THIS
           -- population a present expects proves the message came through the
           -- agent-callable tool, and a missing one proves it did not.
           -- (No backticks in this comment on purpose: it lives inside a JS
           -- template literal, where one would terminate the SQL string.)
           --
           -- Without it, 36 lifecycle notices emitted by library code under a
           -- BORROWED agent ownerId (fleet-scope admission blocks,
           -- take-leadership demotions, a fed-event probe, a control cue) count
           -- as hand-authored prose. No name-based pattern can reach them —
           -- the sender IS a real agent — which is why the write-side stamp
           -- (isSystemEmissionUnderAgentIdentity) cannot fix history and this
           -- must be filtered at read time as well as stamped at write time.
           AND e.body ? 'expects'
      ),
      -- The complement, and the honest L1: agent-identity messages that never
      -- reached the schema. Counted separately rather than as a failing slice of
      -- the hand CTE, because it is a different population — a send PATH that bypasses
      -- enforcement, not an agent authoring poorly.
      bypassed AS (
        SELECT count(*)::int AS n
          FROM harness_shared.coord_event_log e
         WHERE e.workspace_id = ${e}
           AND e.surface = 'messages'
           AND e.ts > now() - interval '24 hours'
           AND e.body->>'kind' = 'message'
           AND e.body->>'msg_id' IS NOT NULL
           AND NOT (coalesce(e.body->>'from', '') ~ ${n})
           AND coalesce(e.body->>'from', '') ~ ${a}
           AND coalesce(e.body->>'auto', 'false') <> 'true'
           AND NOT (e.body ? 'expects')
      ),
      replies AS (
        SELECT DISTINCT r.body->>'related_msg_id' AS to_msg_id,
                        r.body->>'from'           AS responder
          FROM harness_shared.coord_event_log r
         WHERE r.workspace_id = ${e}
           AND r.surface = 'messages'
           AND r.ts > now() - interval '24 hours'
           AND r.body ? 'related_msg_id'
      )
      -- The reply lookup is evaluated ONCE PER MESSAGE here rather than once per
      -- arm below; both arms then read the same boolean. Two FILTERed EXISTS
      -- clauses over the same rows would double the correlated work for an
      -- identical answer.
      answered AS (
        SELECT h.*,
               EXISTS (
                 SELECT 1 FROM replies rp
                  WHERE rp.to_msg_id = h.msg_id
                    AND h.recipients @> to_jsonb(ARRAY[rp.responder])
               ) AS was_answered
          FROM hand h
      )
      SELECT count(*)::int                                              AS hand_authored,
             (SELECT n FROM bypassed)                                   AS bypassed_chokepoint,
             count(*) FILTER (WHERE h.has_sections)::int                AS with_sections,
             count(*) FILTER (WHERE h.n_sections > 1)::int              AS multi_section,
             count(*) FILTER (WHERE h.has_authored)::int                AS with_authored_field,
             -- TREATMENT arm: carries something a reader is asked to act on.
             count(*) FILTER (WHERE h.has_actionable)::int              AS open_questions,
             count(*) FILTER (WHERE h.has_actionable AND h.was_answered)::int
                                                                        AS open_questions_answered,
             -- CONTROL arm: hand-authored, same senders, same window, no
             -- authored field at all.
             count(*) FILTER (WHERE NOT h.has_authored)::int            AS plain_messages,
             count(*) FILTER (WHERE NOT h.has_authored AND h.was_answered)::int
                                                                        AS plain_messages_answered
        FROM answered h`)[0];if(!o||Number(o.hand_authored)===0)return;let i=0;try{const d=await t`
        SELECT count(*)::int AS n
          FROM harness_shared.tool_invocations
         WHERE workspace_id = ${e}
           AND invoked_at > now() - interval '24 hours'
           AND tool_name = 'coord:read'`;i=Number(d[0]?.n)||0}catch{i=0}return{handAuthored:Number(o.hand_authored)||0,bypassedChokepoint:Number(o.bypassed_chokepoint)||0,withSections:Number(o.with_sections)||0,multiSection:Number(o.multi_section)||0,withAuthoredField:Number(o.with_authored_field)||0,openQuestions:Number(o.open_questions)||0,openQuestionsAnswered:Number(o.open_questions_answered)||0,plainMessages:Number(o.plain_messages)||0,plainMessagesAnswered:Number(o.plain_messages_answered)||0,structureReads:i}}catch{return}}async function Ie(e={}){try{const t=e.workspaceId??te(),{sql:n}=$(),a=await n`
      SELECT
        coalesce(
          body->>'subjectSignature',
          body->>'livenessSignature',
          left(body->>'summary', 80)
        ) AS sig,
        count(*)::int AS n,
        max(
          CASE body->>'severity'
            WHEN 'blocker' THEN 2
            WHEN 'advisory' THEN 1
            ELSE 0
          END
        )::int AS sev_rank,
        (array_agg(body->>'summary' ORDER BY ts DESC))[1] AS sample
        FROM harness_shared.coord_event_log
       WHERE workspace_id = ${t}
         AND surface = 'escalations'
         AND body->>'kind' = 'escalation'
         AND ts > now() - interval '24 hours'
       GROUP BY 1`,o=await n`
      SELECT r AS recipient, count(*)::int AS n
        FROM harness_shared.coord_event_log
        CROSS JOIN LATERAL jsonb_array_elements_text(body->'to') AS r
       WHERE workspace_id = ${t}
         AND surface = 'messages'
         AND ts > now() - interval '24 hours'
         AND jsonb_typeof(body->'to') = 'array'
         AND r NOT IN ('human', '*')
         AND r NOT LIKE '@%'
       GROUP BY 1
      HAVING count(*) >= 100`,i=await n`
      SELECT count(*)::int AS n
        FROM harness_shared.coord_event_log
       WHERE workspace_id = ${t}
         AND surface = 'messages'
         AND ts > now() - interval '24 hours'
         AND (
           body->>'summary' ILIKE '%claim%conflict%'
           OR body::text ILIKE '%claim_conflict%'
         )`;let d=[];try{const m=(await n`
        SELECT DISTINCT r
          FROM harness_shared.coord_event_log
          CROSS JOIN LATERAL jsonb_array_elements_text(body->'to') AS r
         WHERE workspace_id = ${t}
           AND surface = 'messages'
           AND ts > now() - interval '3 days'
           AND r ~ '^(su-|s-|cup-)'
         LIMIT 300`).map(_=>_.r).filter(Boolean);if(m.length>0){const{fetchUnansweredDirected:_}=await T(async()=>{const{fetchUnansweredDirected:g}=await import("./unanswered-directed-BiLTfvPd.js");return{fetchUnansweredDirected:g}},__vite__mapDeps([34,35,2,36,37,38,39,4,40,10,11,12,13,14,15,6,7,41,42,43,44,28]));d=[...(await _(m)).entries()].map(([g,E])=>({recipient:g,count:E.count,oldestAgeMs:E.oldestAgeMs}))}}catch{}let l;try{l=await Ae(t)}catch{}let h;try{h=await ve(t)}catch{}let w;try{w=await Se(t)}catch{}let R;try{R=await Ne(t)}catch{}let f;try{const m=await ge({getSql:()=>$().sql});m&&(f={sample:m.sample,coverage:m.coverage,verdict:me(m.sample)})}catch{}return _e({premiseResolve:l,clarifyAdoption:h,authoredAdoption:w,enforcementCensus:R,dispatchAdoption:f,escalationStorms:a.map(m=>({signature:m.sig||"unknown",count:Number(m.n)||0,severity:m.sev_rank>=2?"blocker":m.sev_rank>=1?"advisory":"unknown",sample:m.sample??""})),wakeStorms:o.map(m=>({recipient:m.recipient,count:Number(m.n)||0})),unansweredTargets:d,claimConflicts:Number(i[0]?.n)||0})}catch{return[]}}var Y,z,Q,Te,Re=O((()=>{Z(),ee(),ue(),pe(),ye(),q(),Y=.24,z=["coord:escalation-storm:","coord:wake-storm:"],Q=200,Te=7}));Re();export{Ie as buildCoordHealthLane};
