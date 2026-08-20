import{o as X}from"./chunk-ChpBd9eV.js";import{t as Q}from"./react-DqHYuLt-.js";import{t as Z}from"./jsx-runtime-BmDUFisN.js";import{r as P}from"./SyncContext-UViyCkeI.js";import{t as k}from"./src-UcuFu_CH.js";import{t as x}from"./Tooltip-BRMSMTLQ.js";import{t as J}from"./createLucideIcon-H39hj3ia.js";import{t as ee}from"./check-Cdd_-6Wk.js";import{t as te}from"./chevron-right-9tmkchzc.js";import{t as ne}from"./sparkles-B3Y1Aaqk.js";import{t as ae}from"./square-CuTtP1hJ.js";import{t as oe}from"./lib-J3tjkI3N.js";import{t as se}from"./lib-CjIqeKdG.js";import{r as re}from"./MarkdownEditor-C1RXSwdf.js";import{v as ie}from"./theme-DvDd692h.js";var le=[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}],["path",{d:"M12 11h4",key:"1jrz19"}],["path",{d:"M12 16h4",key:"n85exb"}],["path",{d:"M8 11h.01",key:"1dfujw"}],["path",{d:"M8 16h.01",key:"18s6g9"}]],bt=J("clipboard-list",le),v=X(Q()),s=Z(),ce=/\b(WI|EI|F)-(\d+)\b/g,de=/\bP-(\d{3,})\b/g,ue=/```[\s\S]*?(?:```|$)/g,he=/(`+)[\s\S]*?\1/g,me=/!?\[[^\]]*\]\([^)]*\)/g;function T(e,n,t){for(let a=n;a<t;a++)e[a]=" "}function pe(e){const n=e.split("");for(const a of e.matchAll(ue))T(n,a.index,a.index+a[0].length);let t=n.join("");for(const a of t.matchAll(he))T(n,a.index,a.index+a[0].length);t=n.join("");for(const a of t.matchAll(me))T(n,a.index,a.index+a[0].length);return n.join("")}function ge(e){if(!e)return[];const n=pe(e),t=[];for(const a of n.matchAll(ce)){const o=a.index;t.push({kind:"work-item",id:`${a[1].toUpperCase()}-${a[2]}`,start:o,end:o+a[0].length})}for(const a of n.matchAll(de)){const o=a.index;t.push({kind:"plan-item",id:`P-${a[1]}`,start:o,end:o+a[0].length})}return t.sort((a,o)=>a.start-o.start),t}function fe(e){const n=ge(e.value);if(n.length===0)return[e];const t=[];let a=0;for(const o of n)o.start>a&&t.push({type:"text",value:e.value.slice(a,o.start)}),t.push({type:"workRefPill",data:{hName:"workrefpill",hProperties:{refId:o.id,refKind:o.kind}},children:[]}),a=o.end;return a<e.value.length&&t.push({type:"text",value:e.value.slice(a)}),t}function U(e,n){const t=[];for(const a of e){if(a.type==="text"&&!n){t.push(...fe(a));continue}const o=a.children;if(Array.isArray(o)){const r=n||a.type==="link"||a.type==="linkReference";t.push({...a,children:U(o,r)});continue}t.push(a)}return t}function be(){return e=>{e.children=U(e.children,!1)}}var A=()=>{re()},H={xs:{font:10,dot:6,padY:0,padX:6},sm:{font:11,dot:7,padY:1,padX:8}};function O(e,n,t){const a=H[n];return{display:"inline-flex",alignItems:"center",gap:5,padding:`${a.padY}px ${a.padX}px`,borderRadius:999,fontSize:a.font,fontWeight:600,lineHeight:1.6,fontFamily:"inherit",color:e.text,background:e.bg,border:"none",whiteSpace:"nowrap",textDecoration:"none",cursor:t?"pointer":"default"}}function C({id:e,dotColor:n,dotSize:t}){return(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)("span",{"aria-hidden":!0,style:{width:t,height:t,borderRadius:"50%",background:n,flexShrink:0}}),(0,s.jsx)("span",{children:e})]})}function ye({id:e,state:n="unknown",title:t,href:a,onActivate:o,size:r="sm",className:i}){const l=ie[n],c=H[r].dot,d=t?`${e} — ${t}`:e;if(a){const h=m=>o?.(m);return(0,s.jsx)(x,{label:t,children:(0,s.jsx)("a",{href:a,onClick:h,onPointerEnter:A,onFocus:A,"aria-label":d,className:i,style:O(l,r,!0),children:(0,s.jsx)(C,{id:e,dotColor:l.solid,dotSize:c})})})}return o?(0,s.jsx)(x,{label:t,children:(0,s.jsx)("button",{type:"button",onClick:o,onPointerEnter:A,onFocus:A,"aria-label":d,className:i,style:O(l,r,!0),children:(0,s.jsx)(C,{id:e,dotColor:l.solid,dotSize:c})})}):(0,s.jsx)(x,{label:t,children:(0,s.jsx)("span",{"aria-label":d,className:i,style:O(l,r,!1),children:(0,s.jsx)(C,{id:e,dotColor:l.solid,dotSize:c})})})}function _(e){return e||"unknown"}function we({kind:e,id:n,harnessSlug:t,planSlug:a,...o}){const r=P({queryName:"workItems.detail",args:{harnessSlug:t,id:n},enabled:e==="work-item"&&!!t}),i=P({queryName:"plans.items",args:{slug:a??""},enabled:e==="plan-item"&&!!a}),{state:l,title:c}=(0,v.useMemo)(()=>{if(e==="work-item"){const h=r.data[0];return{state:_(h?.state),title:h?.title??h?.summary??null}}if(!a)return{state:"unknown",title:null};const d=i.data.find(h=>h.item?.id===n);return{state:_(d?.item?.effectiveStatus),title:d?.item?.text??null}},[e,n,a,r.data,i.data]);return(0,s.jsx)(ye,{id:n,kind:e,state:l,title:c,...o})}var R=[{id:"auto",axis:"autonomy",launchable:!0,title:"AUTO — act, don’t ask",oneLiner:"act on your own judgment, replace questions with disclosures, arm a loop for open-ended work",contract:`## AUTO mode — binding contract
Act, don't ask. The confirm-before-acting posture is suspended: choose the route,
pass approval gates on your own judgment, and replace every question with a
DISCLOSURE in your report ("want me to X or Y?" menus are banned — pick one, say
which and why). For open-ended directives, arm an engine loop (loop:arm) so work
recurs across turns instead of stopping at "what next?".
What still stops you: nothing owner-shaped except the genuinely owner-walled
actions (credentials, capital arming, category-1/irreversible ops) and the one
hard data rail — never destroy a PEER's uncommitted work (no tree-wide
destructive git ops on the shared checkout). Unresolvable product-direction
forks become disclosed assumptions, not pauses. Whatever you did under AUTO is
disclosed and recorded — autonomy never means invisibility.`},{id:"cold-auto",axis:"autonomy",title:"COLD AUTO — auto across fresh-context wakes",oneLiner:"AUTO carried across scheduled cold wakes: fresh context each fire, continuity via the carry-note",contract:`## COLD AUTO mode — binding contract
Everything AUTO grants, carried across scheduled wakes with NO human in the room
and NO transcript continuity: each cold fire resets to your carry-note. Your
continuity IS the checkpoint layer, so flushing it is mandatory, not hygiene:
loop:checkpoint { did, left, insight, next } every wake before settling; held
work-items get work_items:checkpoint at every boundary. A cold wake that cannot
reconstruct from the carry-note is a defect — write the note you would need.
Same owner-walls and the peer-work data rail as AUTO. (Same axis as AUTO: you
are in one or the other, never both.)`},{id:"ideate",axis:"overlay",title:"IDEATE — invent net-new, don’t just patch",oneLiner:"run deliberate ideation passes and file net-new feature proposals; with AUTO on, build the strongest",contract:`## IDEATE mode — binding contract
Ambition is part of the job: run deliberate ideation passes — mine your recent
observations, curation:state-of-pot, rubric freshness/trends, and past graded
proposals — and file net-new feature proposals via improvements:capture
{ kind: "feature" }. Blue-sky is licensed; no quality gate or quota. With AUTO
also on, BUILD the strongest ideas (flag-ON, disclosed), don't just file them.
Close each su pass as a LOOP, not a blank page: GROUND on blender:ideation-feedback
{ scope: 'mine', intent: '<your pass focus>' } — prior grades + realized outcomes +
per-lens win-rates + the federated frontier read + observationsImpact (which of YOUR
observations became patterns → ideas → shipped; intent re-ranks the priming by relevance) → run
the pass under one lens → FILE lens-tagged AND GROUNDED: pass
ideation.addressesPatternRefs (the observationsImpact.patterns[].ref values the idea
builds on — an idea filed without them can NEVER count as grounded/shipped in anyone's
observationsImpact, EI-10607), adding a bet/cheapExperiment when the idea is a
real bet → ROUTE the broad ones onward via blender:route-idea → CLOSE with
blender:ideate-pass-record (a measurable su-ideate tick). Grading an su idea wakes its
originator to revise (see GRADE).
(Overlay: stacks with anything — including DRAIN; ideating on why the drain
itself isn't working is a legitimate combination.)`},{id:"drain",axis:"overlay",implies:["auto"],launchable:!0,title:"DRAIN — drive the queue to terminal",oneLiner:"take a work-item backlog and drive every item to a terminal state; completion integrity over speed",contract:`## DRAIN mode — binding contract
The objective is the queue: drive every item of the agreed backlog to a
terminal state (done / resolved / deprecated / needs_human), usually by leading
a fleet. KICKOFF QUESTION (mandatory): before draining, read the live queue
(work_items:completion_stats + a pile/age breakdown) and ask WHICH pile to
drain, with concrete numbers from the data ("9 stale 'Loop iteration' items, 2
canary items — a kind, a harness, oldest-first, or everything?"). Then: triage
+ rank first · capacity preflight · canary launch before the fleet · feed by
claim-spec (never hand-assignment) · monitor each wake · wind down with a
residue report of what genuinely needs the owner. Completion integrity
outranks burn-down speed — nothing goes terminal without evidence. DRAIN
implies AUTO and you ALREADY hold it: entering this mode wrote the auto row for
you (an autonomy axis you had already set — cold-auto, say — is left exactly as
you set it). A drain runs autonomously; that is a statement about your current
posture, not a follow-up call to remember. (Overlay: stacks with anything,
including IDEATE.)

DEFECT-FILING EXCEPTION: DRAIN overrides the general file-every-suspected-bug
rule. Do not mint improvements:capture rows, issues, work-items, or observations
for incidental suspected defects; keep useful evidence on the current drain
item instead. Only a defect that DIRECTLY BLOCKS the scoped drain may create a
new queue row: file exactly one blocker linked to the active drain item/plan,
clear it, and resume the drain.`},{id:"grade",axis:"overlay",title:"GRADE — monitor via rubrics + scorecards",oneLiner:"stand up rubric-graded monitoring of the given target: reuse a rubric or ratify one, emit scorecards on a loop",contract:`## GRADE mode — binding contract
Stand up rubric-graded MONITORING of whatever the owner named, on the
rubric/scorecard system — never ad-hoc prose reports.
1. REUSE FIRST: rubrics:search for an applicable rubric; propose a new one
   (rubrics:propose → ratification) ONLY on a real gap. Rubric proliferation is
   the failure mode — a near-fit existing rubric beats a bespoke new one.
2. LOOP: arm/extend a loop; each wake gathers evidence, emits a scorecard
   (improvements:capture with payloadExtra.observation { rubricRef, ratings,
   kind: 'reinforce' } — every criterion rated, evidence per rating; the
   completeness gate rejects partials), then reads rubrics:trend for direction.
3. CHEAP EVIDENCE: prefer deterministic evidence (dev:pg_query, counters,
   freshness checks) over per-wake LLM judgment — the cheapest grading is
   compute, not inference. Rate honestly: unknown beats invented.
4. TERMS: take cadence + exit criteria from the owner at entry; surface
   worsening trends instead of waiting to be asked.
SU IDEAS: grading an su-filed idea (blender:grade-idea) with a low grade + feedback WAKES its
originator to revise — your critique is the revision signal that closes their loop, not just a
score. (No self-grading: the tool refuses when you authored the row.)
(Overlay: stacks with any autonomy/work-source mode.)`},{id:"goal",axis:"overlay",implies:["auto","ideate"],requiresSubject:!0,title:"GOAL — own an outcome, not a queue",oneLiner:"own a goal end-to-end: create the pots/plans/fleets that reach it, outsource every build, reallocate on evidence, kill on written criteria",contract:`## GOAL mode — binding contract
The objective is an OUTCOME, not a queue. You are handed a goal ("ship a paid
app", "reach N users") and you own the whole ladder down to work-items: creating
the pots, plans and fleets that reach it, and REALLOCATING between them as
evidence arrives. A goal runs for weeks, so the posture is portfolio management,
not a single build.
YOUR HANDS — you CREATE, PLACE, ARBITRATE and KILL work. You never IMPLEMENT it.
Not a feature, not a fix, not a test, and NOT INFRASTRUCTURE — there is no
exception, including the tempting one: a red release gate or a wedged service
stalling your own fleets gets a launched agent like everything else. The moment
you are editing code you have stopped managing the portfolio, and nobody else is
doing it. Every unit of execution below is a LAUNCHED AGENT.
KICKOFF QUESTION (mandatory): before creating anything, read the existing
portfolio (goals:list + pot:list + plans:list + search:semantic on the goal's
terms), report what ALREADY targets this goal, and settle the two things a goal
cannot run without — its KILL CRITERION and its SPEND CEILING — proposing a
concrete value for each rather than offering a blank menu. Before committing
the portfolio, run get_feedback on the goal OUTLINE (outcome + kill criterion +
intended approach) — the global consult minimum of 1 means it always reaches at
least the best-available live peer, so "nobody relevant" is never a reason to
skip it; goals:create runs the same routing as a checkpoint and may refuse once
with consult_available (override: consulted + consult_reason).
IF SOMETHING ALREADY TARGETS IT, settle the RELATIONSHIP before creating
anything — looking is not enough, and the default answer is not "a new goal":
(a) a PLAN inside that goal's existing pot — the usual right answer; "release it
to the App Store" is a step in shipping the app, not a goal of its own; (b) a
SUB-GOAL, goals:create { parentId } — a genuinely separate outcome that only
matters because the parent does; (c) a SIBLING goal sharing pots, when the
outcomes are independent and merely overlap in tooling. Never a second goal
silently owning the same pot. Say which of the three you chose, and why.
Then FILE THE GOAL:
goals:create { title, body, killCriterion, budgetCents }. Do this BEFORE the
pots and plans that pursue it, so the ceiling exists before the spending does.
The goal record is NOT a pot — one goal spawns many pots, so no single pot
can carry its kill criterion, its spend, or its sub-goal lineage.
PREREQUISITES ARE EDGES, NOT PHASES (goal-dag-shared-substrate-2026-08-18). A
goal may declare blocked-by prerequisites — goals:create/update { blockedBy:
[goal ids / bare WI-/EI- ids] }. Readiness is an ACTIVATION GATE, never
dispatch (D-003): goals never enter a claim queue; actionable /
premiseInvalidated surface on goals:get/list and the watchdog OFFERS a
became-ready goal — a human or the parent goal's agent decides to start it. An
edge is a genuine prerequisite between SEPARATE outcomes ("legal entity
exists" -> "EU launch") — NEVER phases of one outcome: build->market->monetize
is ONE goal's plans/tripwires, not three chained goals, and chaining phases
destroys the reallocation posture that is this mode's point (D-005). FUTURE
goals: stub-then-arm (D-004) — file the blocked goal NOW as a cheap thesis stub
(goals:create { blockedBy }; criterion/ceiling may wait per the 2026-08-09
overrule) and run the full kickoff contract at ACTIVATION when it unblocks,
against the world as it then is. goals:start on a still-blocked goal
warn-refuses ONCE; override deliberately with startBlocked + startBlockedReason.
A KILLED blocker never silently unblocks — it flags the dependent
premiseInvalidated for review: retarget, remove the edge deliberately, or kill
downstream (D-002).
SHAPE (v1): a goal's pots live INSIDE this workspace, not in separate
workspaces — no workspace-provisioning path exists yet. So they share this
workspace's Blender and compete with its own self-improvement for placement and
budget, which is what makes the arbitration below load-bearing rather than
merely prudent.
HOW WORK GETS DONE — every route ends in an agent that is not you:
1. SIZE IT FIRST. A big feature gets a PLAN (plans:new + plans:add-item, then
   plans:start). Something small that does not belong in a plan goes STRAIGHT
   onto the queue as a work-item (work_items:create) — do not inflate a
   one-item plan to look organised, and do not bury a multi-subsystem build in
   a lone work-item.
2. TO EXECUTE A PLAN, LAUNCH AN AGENT AND HAVE IT LEAD — not you. ONE call:
   fleet:launch-on-plan { plan, count, leader: 'spawn', headless: true }
   spawns a fresh agent to lead the fleet and leaves you out of it entirely —
   you do not become its leader and you do not enter AUTO mode from it. You
   stay the portfolio manager; leading a plan fleet yourself is the same
   mistake as implementing. Size and shape it from the Plan-fleet settings
   (max size, leader + member model/effort). The result hands you that
   leader's ownerId, addressable immediately — COUPLE yourself with it
   (coord:couple) so its state is visible to you without polling.
3. KEEP ONE STANDING DRAIN FLEET PER GOAL — always maintained, not spun up on
   demand: a launched agent leading a DRAIN-mode fleet over this goal's work
   queue, sized and shaped by the Drain-fleet settings, coupled to you. It is
   the reason small work-items you file directly still get done. RECORD it the
   moment it is established — goals:update { drainFleet: '<fleet slug>' } — and
   again on re-establishment; the goal-liveness watchdog treats an active goal
   without a recorded drain fleet as a gap. Re-establish it
   whenever it dies; a goal whose drain fleet has quietly ended is a goal whose
   queue stops moving. Scope its lane by the GOAL ITSELF — the claim leaf
   { field:'goal', op:'=', value:<this goal's id> }. Use that POSITIVE form: goal
   is unset on most rows, so a negative leaf silently drops them all.
4. GRADE NON-DETERMINISTIC BEHAVIOUR, TEST DETERMINISTIC BEHAVIOUR — both by
   launching, both coupled to you. Anything judged rather than asserted (agent
   quality, output usefulness) gets a launched GRADE-mode agent on rubrics +
   scorecards. Anything deterministic that needs verification beyond what its
   builder already did gets a launched TEST-mode agent, whose deliverable is
   committed tests and an independent verdict — never the builder re-marking
   its own homework.
PARALLELIZE HARD — under-parallelizing is the named failure mode here, not
over-spending. Run every independent pot, plan and fleet you can at once rather
than driving one end-to-end and then starting the next; there is no ramp-one-at-
a-time rule and no capacity preflight to perform. YOU decide the width, because
only you see the whole portfolio — and because only you see it, the width has to
travel DOWNWARD: state the intended parallelism in the brief you hand each agent
you launch, rather than leaving a child to guess how wide to go.
TWO CEILINGS, AND THEY COMPOSE. Each fleet has its own maximum size, and the
goal has a MAX AGENTS covering EVERY session associated with it. A plan-fleet
member counts against both — its fleet's max and the goal's total. These
ceilings are what make maximal parallelism safe, so respect them as limits
rather than targets to fill. BOTH ARE ALWAYS IN FORCE: a goal whose owner has
pinned nothing runs under system defaults, not under no ceiling, so never read an
empty settings panel as permission to launch without limit. INSIDE A GOAL, EVERY
FLEET IS SIZED BY THE PER-FLEET CEILING — including the standing drain fleet
above, whose size comes from this goal's setting and NOT from the default fleet
size DRAIN mode names generically. Ask for more than the ceiling and the launch
is refused whole, so size the request first.
SETTINGS ARE DATA, NOT PROSE. Max agents, per-fleet maxima, and the
model/effort/account/carry for each role (plan-fleet leader + member, drain-fleet
leader + member, grading, test, misc) live on the GOAL RECORD and are editable by
the owner in the goal's detail popup. Read them at launch time and honour what
you find; never hardcode a number from this contract, and never treat a value you
remember from an earlier wake as current — the owner may have changed it while
you were asleep.
PROVE A LAUNCHED AGENT ACTUALLY EXECUTES before trusting it with real work: seed
one trivial work-item and confirm it reaches a terminal state. "Spawned" is not
"working" — an owner id in an \`s-<epochMs>-<hex>\` shape proves only that
something was created, so check the session is LIVE and taking turns
(coord:presence sessionState + real tool activity). Skip this and N children look
busy while executing nothing.
ONE MAIN OWNER PER POT — a pot may SERVE several goals, but exactly ONE may
place work into it (goals:attach-pot { role: 'owner' }); the others attach as
'contributing' and route work through the owner. Enforced in the schema, not by
etiquette (goal_pots_one_owner_per_pot). Expect a shared pot's spend to appear IN
FULL on every goal it serves — those figures do not sum, and reading them as a
double charge is the usual mistake.
A WRITTEN KILL CRITERION PER POT AT CREATION TIME — record it on the link
(goals:attach-pot { killCriterion }), not only in prose, so the goal's page can
show it; and prefer TRIPWIRES (goals:create/update { tripwires }) for anything
countable, because a criterion written as a sentence is a promise nobody
re-checks while "$310 of $500" is a readout. SPEND ACCOUNTING HAS A HARD
BOUNDARY — use goals:pots { goalId } for measured child-fleet spend when
comparing it with the goal record's declared ceiling. No reliable per-session
attribution source is exposed for the GOAL agent's interactive session, so do
not invent spentCents. goals:update { spentCents } accepts a value only when it
exactly matches the measured goals:pots rollup; missing, partial, or mismatched
measurements are refused and remain visibly unmeasured. The snapshot is marked
with its source, so a legacy hand-entered value cannot masquerade as measured.
Report the source's measured scope and flag the attribution gap in the owner
report.
goals:update { status: 'killed' } the moment the criterion trips. An agent that
only ever creates is a ratchet; closing is the half that stops it.
OWNER-WALLED ACTIONS, NAMED — app-store submission, payment/Stripe setup, domain
registration, real spend, published marketing. Queue them as owner asks and keep
working around them; never stall silently, never act irreversibly.
SHIPPED, NOT GREEN — a feature behind an unflipped flag is dead code; for a
revenue goal the deliverable is a released artifact with a payment path, not a
passing suite. Flags ship ON.
DEDUP BEFORE CREATING — pot:list / plans:list / search:semantic first.
TEMPLATES MANDATE — every new app materializes from a \`scope: "app"\` template
root, never a hand-rolled tree.
RUBRIC REUSE, NOT PROLIFERATION (inherit GRADE's clause) — a fresh rubric per pot
makes trends uncomparable across the portfolio, destroying the reallocation
signal that is the entire point of running one.
POT VS SUB-HARNESS IS YOUR JUDGMENT — a pot buys its own
repo/blueprint/schema/plans and a blast-radius boundary; under a
workspace-widened brain it does NOT buy a separate decider.
KEEP THE BLENDER HONEST — it generates plans and work-items for this goal, and
you are the one who finds out whether they are any good. Review what it routes,
send your verdict back to it, and treat a Blender producing plausible-looking
work nobody can use as a defect to report rather than a queue to drain. Its
output should serve THIS goal; when it wants an outcome that is genuinely
outside your goal rather than a plan within it, that is goals:propose (the owner
confirms a new goal) — never silently adopt it, and never silently discard it.
DURABILITY: a goal outlives any one session, so it must not live in a transcript.
Arm a loop as your wake source and treat the carry surfaces as the goal's real
memory — loop:checkpoint every wake, work_items:checkpoint at every boundary,
and the goal's standing state on its goals:* record — so a COLD wake
re-establishes the goal by reading goals:get, not by reconstructing it from a
transcript that is gone. A goal that dies with its terminal is the failure this
clause prevents.
REPORT on a standing cadence via coord:escalate / notifyAttention (desktop
notifications are OFF): what moved, what it cost, what is owner-walled, and what
you killed. Without it the owner learns goal state only by asking.
GOAL implies AUTO and IDEATE, and you ALREADY hold both: entering this mode
wrote those rows for you (an autonomy axis you had already set — cold-auto, say
— is left exactly as you set it). A goal agent that stops to ask cannot run for
weeks, and one that only builds what it was handed is not managing a portfolio;
both contracts are binding on you NOW and mode:set returned them — read them.
This is a statement about your current posture, not a pair of follow-up calls to
remember. (Overlay: stacks with anything, including DRAIN and GRADE.)`},{id:"test",axis:"overlay",title:"TEST — a verdict on the work, not progress on it",oneLiner:"test someone else’s work independently, report defects instead of silently fixing them, and leave committed tests behind",contract:`## TEST mode — binding contract
The objective is a VERDICT on work, not progress on it. What you owe is evidence
about whether the thing does what it claims — plus the tests that keep answering
that question after you leave.
1. INDEPENDENCE — test against the CONTRACT (the doc, the type, the stated
   promise), not against the implementation. A test written by reading the code
   and asserting what it currently does restates the bug as the expectation and
   then passes forever. Derive the expected value yourself; where the code is
   the only statement of intent, say so in the verdict rather than ratifying it.
2. RED BEFORE GREEN — a test that has never failed is a test you have not
   tested. Prove each one CAN fail before you believe a pass — but never by
   mutating the shared tree: git-sync sweeps the WHOLE working tree on a short
   cadence, so an in-place "mutate, run, restore" probe can be COMMITTED
   mid-probe even when nothing goes wrong and no handler fails, and on a swept
   tree a clean git status means the sweep ran, not that your file is intact.
   Falsify in memory (feed the wrong input, stub the seam) or in a scratch copy.
3. ZERO WORK IS NOT A PASS — the most common green here is a run that measured
   nothing: a selector that matched no files, a loop over an empty set, a
   pattern that never appeared, a mock that silently dropped the very column
   under test. Assert the POPULATION — how many cases ran, over what — inside
   the test, so an empty measurement FAILS instead of congratulating you. Before
   believing any probe, ask what population it actually measured.
4. REPORT, DON'T FIX — finding a defect ends your task on that defect: file it
   with a repro. Silently repairing it destroys the evidence, merges two
   verdicts into one, and leaves nobody able to say what was broken or for how
   long. Repair only when the work's owner asked you to, and then report the
   before AND the after.
5. VERDICT WITH EVIDENCE — "passing" is not a verdict. State what ran, over what
   population, at which revision, and — the field that is skipped most often and
   worth the most — what you could NOT determine. A bounded measurement reported
   as a confident number is indistinguishable from a real result.
6. LEAVE THE TESTS BEHIND — the deliverable is committed tests in the project's
   own framework, not a transcript of manual checks. A verification that exists
   only in your session cannot be re-run by anyone, and decays into a claim the
   moment your context ends.
(Overlay: stacks with anything. It declares NO implications on purpose: testing
is not an autonomy posture, and a testing pass with an owner watching is a
normal one. Scope — what to test, how deep, when to stop — arrives in mode:set's
own instructions rather than a stored subject, because nothing downstream joins
on a test's subject the way the goal paths join on a goal's.)`}];function F(e){const n=e.trim().toLowerCase();return R.find(t=>t.id===n)??null}var yt=R.filter(e=>e.launchable===!0).map(e=>e.id);function wt(){return R.filter(e=>e.launchable===!0)}function ke(e){return(F(e)?.id??e).toUpperCase().replace(/-/g," ")}function ve(e,n){const t=F(e),a=t?`${t.title}
${t.oneLiner}`:`Standing mode: ${e}`;return n?.ownerDirected===void 0?a:`${a}

${n.ownerDirected?"Set by the owner — peers cannot override it.":"The agent set this itself (or a peer did) — an owner instruction overrides it."}`}function Ee(e){if(!e)return null;for(const n of e){if(typeof n=="string"||n?.mode!=="goal")continue;const t=n.subject;if(typeof t=="string"&&t.trim()!=="")return t}return null}function Ne(e){return Ee(e)!==null}var kt=" all",vt=" solo",Et=" all-plans",Nt="none";function Se(e){return typeof e=="string"?{mode:e}:e}var St={improvement:"Improvement triage","standing-approval":"Standing approval","dark-flag-ratification":"Dark flag","operator-report":"Operator report","plan-item":"Plan item","work-item-needs-human":"Work item","owner-wall":"Owner wall"};function Ae(e){return e.filter(n=>!n.ownerAgentId).slice().sort((n,t)=>(n.occurredAt?new Date(n.occurredAt).getTime():Number.POSITIVE_INFINITY)-(t.occurredAt?new Date(t.occurredAt).getTime():Number.POSITIVE_INFINITY))}var Ie=["needs-you","working","blocked","stalled","parked"],xe={"needs-you":"Needs you",working:"Working",blocked:"Blocked",stalled:"Stalled",parked:"Parked · done"},Te={"needs-you":"Nothing is waiting on you",working:"No sessions are running",blocked:"Nothing is waiting on a gate",stalled:"Everything alive is moving",parked:"Nothing parked"};function Oe(e){const n=new Set,t=new Map;for(const a of e??[]){const o=a.active?.ownerId??a.session?.coordOwnerId??null;if(!o)continue;n.add(o);const r=a.hits?.[0],i=r?.highlight??r?.excerpt??"";!r||!i.trim()||t.set(o,{turnIdx:typeof r.turnIdx=="number"?r.turnIdx:-1,highlight:r.highlight??null,excerpt:r.excerpt??"",speaker:r.speaker??null,ts:r.ts??null,sessionId:a.sessionId??"",sourceKind:a.sourceKind??"",more:Math.max(0,(a.hits?.length??0)-1)})}return{owners:n,hits:t}}async function At(e,n){const t={hudSearchTimeout:!0},a=new AbortController,o=()=>a.abort();n.signal&&(n.signal.aborted?a.abort():n.signal.addEventListener("abort",o,{once:!0}));const r=setTimeout(()=>a.abort(t),n.timeoutMs),i=n.fetchImpl??fetch;try{const l=await i(`/api/adv/sessions/search-transcripts?q=${encodeURIComponent(e)}&limit=${n.limit??100}`,{signal:a.signal}),c=await l.json();if(!l.ok||c.ok===!1)return{ok:!1,timedOut:!1,message:c.error??`search failed (${l.status})`};const d=c.hiddenMachineHits;return{ok:!0,hiddenMachineHits:{count:typeof d?.count=="number"&&d.count>0?d.count:0,truncatedByLimit:d?.truncatedByLimit===!0},...Oe(c.sessions)}}catch(l){if(a.signal.reason===t)return{ok:!1,timedOut:!0,message:`transcript search timed out after ${Math.round(n.timeoutMs/1e3)}s — the operator may be busy`};throw l}finally{clearTimeout(r),n.signal?.removeEventListener("abort",o)}}var Ce={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};function Re(e){return e.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,(n,t)=>{const a=t.toLowerCase();if(a.startsWith("#x")){const o=Number.parseInt(t.slice(2),16);return Number.isFinite(o)?String.fromCodePoint(o):n}if(a.startsWith("#")){const o=Number.parseInt(t.slice(1),10);return Number.isFinite(o)?String.fromCodePoint(o):n}return Ce[a]??n})}function Le(e){const n=[],t=/<mark>([\s\S]*?)<\/mark>/gi,a=(i,l)=>{const c=Re(i).replace(/\s+/g," ");(c.trim().length>0||n.length>0&&c===" ")&&n.push({text:c,mark:l})};let o=0,r;for(;(r=t.exec(e))!==null;)r.index>o&&a(e.slice(o,r.index),!1),a(r[1],!0),o=r.index+r[0].length;return o<e.length&&a(e.slice(o),!1),n}function It(e){if(!e)return null;if(e.highlight){const t=Le(e.highlight).map(a=>a.text).join("").split(/\s+…\s+/).map(a=>a.trim()).sort((a,o)=>o.length-a.length)[0];if(t&&t.length>=M)return t}const n=e.excerpt.replace(/^\[[^\]]*\]\s*/,"").replace(/…$/,"").replace(/\s+/g," ").trim().slice(0,120).trim();return n.length>=M?n:null}var M=8,je={stallActivitySec:900,stallIntentSec:1800,contextWarnPct:60,contextCritPct:85};function $(e){const n=/^([a-z]+)-([0-9a-f]{6,8})/i.exec(e);return n?`${n[1]}-${n[2]}`:e.length>16?`${e.slice(0,16)}…`:e}function E(e,n){if(!e)return null;const t=new Date(e).getTime();return Number.isFinite(t)?Math.max(0,Math.round((n-t)/1e3)):null}function N(e){if(e==null)return"—";if(e<60)return`${e}s`;const n=Math.floor(e/60);if(n<60)return`${n}m`;const t=Math.floor(n/60);return t<24?`${t}h`:`${Math.floor(t/24)}d`}function G(e,n){return e==null||n==null||n<=0?null:Math.max(0,Math.min(100,Math.round(e/n*100)))}function De(e){return!!(e&&e.eventKey.startsWith("coord:inbox-wake:"))}function Pe(e){return e.agentPaneKind==="su"}function _e(e){const n=e?.trim().toLowerCase();return n==null||n===""||n==="claude"||n==="papercup"||n==="codex"||n==="omp"}function xt(e,n){const t=n.trim().toLowerCase();if(!t)return!0;const a=[e.label,e.ownerId,$(e.ownerId),e.intent,e.role,e.agent,e.fleetSlug,e.fleetRole,e.currentPlanSlug,e.harnessSlug,e.sessionId,e.ompThreadId,...e.claims.flatMap(o=>[o.id,o.planSlug])];for(const o of a)if(typeof o=="string"&&o.toLowerCase().includes(t))return!0;return!1}function Me(e){const n=new Map;for(const t of e){if(!t.ownerAgentId)continue;const a=n.get(t.ownerAgentId);a?a.push(t):n.set(t.ownerAgentId,[t])}return n}function B(e){return e.sessionState!=null?e.sessionState==="live"||e.loopArmed:e.liveness==="live"||e.liveness==="idle"||e.loopArmed}var Ue="Heartbeat is fresh but the OS process is gone — this session is a zombie";function He(e){return B(e)&&e.pidAlive===!1&&!e.stale}function Fe(e,n,t){const{nowMs:a,thresholds:o}=t;if(n&&n.length>0){const c=n.reduce((d,h)=>{const m=h.occurredAt?new Date(h.occurredAt).getTime():Number.POSITIVE_INFINITY;return m<d.t?{t:m,a:h}:d},{t:Number.POSITIVE_INFINITY,a:n[0]});return{column:"needs-you",reason:c.a.title||"Asked you a question",sinceSec:E(c.a.occurredAt,a)}}if(e.pendingWakes>0)return{column:"needs-you",reason:`${e.pendingWakes} wake${e.pendingWakes===1?"":"s"} staged behind manual mode — nothing reaches this agent until you release them`,sinceSec:null};if(e.lastActiveAt==null&&!e.stale&&e.liveness!=="stale"){const c=E(e.startedAt??null,a);return e.launchFailed===!0?{column:"needs-you",reason:"Launch failed before the session came online. Relaunch it.",sinceSec:c}:e.launchBlocked===!0?{column:"needs-you",reason:e.launchBlockedHint?.trim()||"Launch blocked before its first turn. Choose another account or backend, or retry after the provider limit resets.",sinceSec:c}:e.display==="terminal"&&c!=null&&c>=60?{column:"needs-you",reason:`Launched ${N(c)} ago but never came online — the terminal may have failed to start. Relaunch it.`,sinceSec:c}:{column:"needs-you",reason:e.liveness==="pending"?"Fresh session — launched, not started yet. Tell it what to work on.":"Fresh session — no turn taken yet. Tell it what to work on.",sinceSec:null}}if(e.openAwait&&e.sessionState!=="ended"&&!De(e.openAwait)){const c=E(e.openAwait.sinceIso,a);return{column:"blocked",reason:e.openAwait.note?.trim()?`${e.openAwait.note.trim()} (${e.openAwait.eventKey})`:`Waiting on ${e.openAwait.eventKey}`,sinceSec:c}}const r=E(e.lastActiveAt,a),i=E(e.intentDeclaredAt,a),l=B(e);return He(e)?{column:"stalled",reason:Ue,sinceSec:r}:l&&r!=null&&r>=o.stallActivitySec&&i!=null&&i>=o.stallIntentSec?{column:"stalled",reason:`No tool call in ${N(r)} and the intent has not changed in ${N(i)}`,sinceSec:r}:(e.sessionState!=null?e.sessionState==="live"||e.sessionState==="recorded":e.liveness==="live")||e.thinking||e.loopArmed&&e.liveness!=="stale"?{column:"working",reason:e.intent?.trim()||"Running",sinceSec:r}:{column:"parked",reason:e.sessionState==="ended"||e.liveness==="stale"?"No heartbeat — session has ended":e.liveness==="pending"?"Recorded — has not started yet":"Idle between turns",sinceSec:r}}function $e(e,n){const t=[];for(const r of e.modes){const i=Se(r);t.push({id:`mode-${i.mode}`,kind:"mode",label:ke(i.mode),tone:"accent",ownerDirected:i.ownerDirected===!0,title:ve(i.mode,{ownerDirected:i.ownerDirected})})}const a=e.claims.length;if(a>0){const r=e.claims.filter(i=>(i.status??"").toLowerCase()==="done").length;t.push({id:"claims",label:`${r}/${a}`,tone:r===a?"good":"neutral",title:`${r} of ${a} claimed item${a===1?"":"s"} done`})}const o=G(e.contextTokens,e.compactionLimit);if(o!=null&&o>=n.thresholds.contextWarnPct&&t.push({id:"ctx",label:`ctx ${o}%`,tone:o>=n.thresholds.contextCritPct?"bad":"warn",title:`Context ${o}% full — answers degrade as this approaches the compaction limit`}),e.wakeMode==="manual"){const r=e.pendingWakes??0;t.push({id:"wake",label:r>0?`wake: manual · ${r} staged`:"wake: manual",tone:"warn",title:r>0?`${r} message${r===1?"":"s"} staged and NOT delivered — this agent has not seen ${r===1?"it":"them"}. Release the wake to deliver.`:"Messages are staged, not delivered, until released"})}return e.loopArmed&&t.push({id:"loop",label:"loop",tone:"good",title:"An engine loop is armed — it re-wakes on a cadence"}),e.declaredUnclaimed&&t.push({id:"unclaimed",label:"unclaimed lane",tone:"warn",title:`Declared plan ${e.currentPlanSlug??""} but claimed no item on it`.trim()}),e.currentFiles.length>0&&t.push({id:"files",label:`${e.currentFiles.length} file${e.currentFiles.length===1?"":"s"}`,tone:"neutral",title:e.currentFiles.join(`
`)}),t}function Ge(e){return e.sinceSec==null?Number.MAX_SAFE_INTEGER:-e.sinceSec}function Be(e,n,t){const a=Fe(e,n,t),o=e.claims.length,r=e.claims.filter(i=>(i.status??"").toLowerCase()==="done").length;return{ownerId:e.ownerId,handle:$(e.ownerId),label:e.label,intent:e.intent?.trim()?e.intent.trim():null,column:a.column,reason:a.reason,sinceSec:a.sinceSec,badges:$e(e,t),fleetSlug:e.fleetSlug,fleetColor:e.fleetColor,isLeader:e.fleetRole==="leader",agent:e.agent,chatSupported:_e(e.agent),planSlug:e.currentPlanSlug,blockedOn:e.openAwait,contextPct:G(e.contextTokens,e.compactionLimit),claimedCount:o,doneCount:r,advSessionId:e.advSessionId,windowId:e.windowId,searchHit:t.searchHit??null,sortKey:Ge(a)}}function We(e){const n=new Map;for(const t of e){const a=t.fleetSlug??" solo";let o=n.get(a);o||(o={fleetSlug:t.fleetSlug,fleetColor:t.fleetColor,label:t.fleetSlug??"solo",total:0,leaderOwnerId:null,byColumn:{"needs-you":0,working:0,blocked:0,stalled:0,parked:0},warning:null},n.set(a,o)),o.total+=1,o.byColumn[t.column]+=1,t.isLeader&&!o.leaderOwnerId&&(o.leaderOwnerId=t.ownerId),!o.fleetColor&&t.fleetColor&&(o.fleetColor=t.fleetColor)}for(const t of n.values()){const a=[];t.byColumn["needs-you"]&&a.push(`${t.byColumn["needs-you"]} needs you`),t.byColumn.blocked&&a.push(`${t.byColumn.blocked} blocked`),t.byColumn.stalled&&a.push(`${t.byColumn.stalled} stalled`),t.fleetSlug&&!t.leaderOwnerId&&a.push("no leader"),t.warning=a.length?a.join(", "):null}return[...n.values()].sort((t,a)=>{if(t.fleetSlug==null!=(a.fleetSlug==null))return t.fleetSlug==null?1:-1;const o=t.byColumn["needs-you"]+t.byColumn.blocked+t.byColumn.stalled,r=a.byColumn["needs-you"]+a.byColumn.blocked+a.byColumn.stalled;return o!==r?r-o:t.label.localeCompare(a.label)})}function qe(e){const n=new Map;for(const t of e){const a=t.planSlug??"none";let o=n.get(a);o||(o={planSlug:t.planSlug,label:t.planSlug??"no plan",total:0,byColumn:{"needs-you":0,working:0,blocked:0,stalled:0,parked:0},warning:null},n.set(a,o)),o.total+=1,o.byColumn[t.column]+=1}for(const t of n.values()){const a=[];t.byColumn["needs-you"]&&a.push(`${t.byColumn["needs-you"]} needs you`),t.byColumn.blocked&&a.push(`${t.byColumn.blocked} blocked`),t.byColumn.stalled&&a.push(`${t.byColumn.stalled} stalled`),t.warning=a.length?a.join(", "):null}return[...n.values()].sort((t,a)=>{if(t.planSlug==null!=(a.planSlug==null))return t.planSlug==null?1:-1;const o=t.byColumn["needs-you"]+t.byColumn.blocked+t.byColumn.stalled,r=a.byColumn["needs-you"]+a.byColumn.blocked+a.byColumn.stalled;return o!==r?r-o:t.label.localeCompare(a.label)})}function Tt(e,n,t){const a=t.thresholds??je,o=t.nowMs,r=Me(n),i=t.exemptOwners,l=p=>!!i?.has(p);let c=t.suOnly===!1?e:e.filter(p=>Pe(p)||l(p.ownerId));if(c=c.filter(p=>!Ne(p.modes)||l(p.ownerId)),t.fleets&&t.fleets.length>0){const p=new Set(t.fleets);c=c.filter(f=>p.has(f.fleetSlug)||l(f.ownerId))}const d=c.map(p=>Be(p,r.get(p.ownerId),{nowMs:o,thresholds:a,searchHit:t.searchHits?.get(p.ownerId)??null})),h=qe(d);let m=d;if(t.plans&&t.plans.length>0){const p=new Set(t.plans);m=d.filter(f=>p.has(f.planSlug)||l(f.ownerId))}const g={"needs-you":0,working:0,blocked:0,stalled:0,parked:0};for(const p of m)g[p.column]+=1;return{columns:Ie.map(p=>({id:p,label:xe[p],empty:Te[p],sessions:m.filter(f=>f.column===p).sort((f,y)=>f.sortKey-y.sortKey||f.handle.localeCompare(y.handle))})),fleets:We(m),plans:h,counts:g,total:m.length,unattributed:Ae(n)}}var w={off:!1,compares:0,skips:0,reconciles:0,reuses:0,cardRenders:0,cardMounts:0};typeof window<"u"&&(window.__hudRenderStabilitySwitch=w);function Ot(e,n){if(w.compares++,w.off)return!1;if(e===n)return w.skips++,!0;const{sinceSec:t,sortKey:a,...o}=e,{sinceSec:r,sortKey:i,...l}=n,c=N(t)===N(r)&&k(o,l);return c&&w.skips++,c}function Ct(e,n){if(w.reconciles++,w.off||!e)return n;const t=new Map;for(const d of e.columns)for(const h of d.sessions)t.set(h.ownerId,h);let a=!1;const o=n.columns.map((d,h)=>{const m=e.columns[h];let g=!m||m.id!==d.id||m.label!==d.label||m.empty!==d.empty||m.sessions.length!==d.sessions.length;const p=d.sessions.map((f,y)=>{const b=t.get(f.ownerId);return b&&k(b,f)?((!m||m.sessions[y]!==b)&&(g=!0),b):(g=!0,f)});return!g&&m?m:(a=!0,{...d,sessions:p})}),r=k(e.fleets,n.fleets)?e.fleets:n.fleets,i=k(e.plans,n.plans)?e.plans:n.plans,l=k(e.counts,n.counts)?e.counts:n.counts,c=k(e.unattributed,n.unattributed)?e.unattributed:n.unattributed;return!a&&e.columns.length===n.columns.length&&r===e.fleets&&i===e.plans&&l===e.counts&&c===e.unattributed&&e.total===n.total?(w.reuses++,e):{columns:o,fleets:r,plans:i,counts:l,total:n.total,unattributed:c}}function Ke(e){return e.replace(/\n/g,`  
`)}var Ye=[se,be],Ve={p:({children:e})=>(0,s.jsx)("span",{className:"report-block-item-text",children:e}),a:({children:e,href:n})=>(0,s.jsx)("a",{href:n,target:"_blank",rel:"noreferrer",children:e})};function W(e){const n=(e??"").trim().toLowerCase();switch(n){case"done":case"passed":case"shipped":case"resolved":return{glyph:"●",tone:"good",label:n};case"wip":case"active":case"in_progress":case"in-progress":case"doing":return{glyph:"◐",tone:"accent",label:n};case"blocked":case"failing":case"failed":case"error":return{glyph:"■",tone:"bad",label:n};case"needs-human":case"needs_human":case"review":return{glyph:"◆",tone:"accent",label:n};case"dropped":case"deprecated":case"closed":return{glyph:"×",tone:"muted",label:n};case"":return{glyph:"·",tone:"muted",label:""};default:return{glyph:"○",tone:"muted",label:n}}}function ze({item:e,onDrillIn:n,canDrillIn:t,harnessSlug:a,planSlug:o,onWorkRefActivate:r}){const{glyph:i,tone:l,label:c}=W(e.status);return(0,s.jsxs)("li",{className:"report-block-item","data-tone":l,children:[(0,s.jsx)("span",{className:"report-block-glyph","data-tone":l,"aria-hidden":"true",title:c||void 0,children:i}),e.id&&(0,s.jsx)("span",{className:"report-block-item-id",children:e.id}),(0,s.jsx)(Xe,{text:e.text,harnessSlug:a,planSlug:o,onWorkRefActivate:r}),e.ref&&n&&(t?.(e.ref)??!0)&&(0,s.jsx)("button",{type:"button",className:"report-block-item-drill",onClick:()=>n(e.ref),"data-ref":e.ref,"aria-label":`Open ${e.ref}`,children:"Open ↗"})]})}function Xe({text:e,harnessSlug:n,planSlug:t,onWorkRefActivate:a}){return(0,s.jsx)(oe,{remarkPlugins:Ye,components:(0,v.useMemo)(()=>({...Ve,workrefpill:({node:o})=>{const r=typeof o?.properties?.refId=="string"?o.properties.refId:"",i=o?.properties?.refKind==="plan-item"?"plan-item":"work-item";return r?(0,s.jsx)(we,{id:r,kind:i,harnessSlug:n??"",planSlug:t,size:"xs",onActivate:a?()=>a({id:r,kind:i,planSlug:t}):void 0}):null}}),[n,t,a]),children:Ke(e)})}function Qe({plan:e,onDrillIn:n,canDrillIn:t,harnessSlug:a,planSlug:o,onWorkRefActivate:r}){const{glyph:i,tone:l,label:c}=W(e.status);return(0,s.jsxs)("div",{className:"report-block-plan","data-tone":l,children:[(0,s.jsxs)("div",{className:"report-block-plan-head",children:[(0,s.jsx)("span",{className:"report-block-glyph","data-tone":l,"aria-hidden":"true",title:c||void 0,children:i}),(0,s.jsx)("span",{className:"report-block-plan-title",children:e.title}),e.status&&(0,s.jsx)("span",{className:"report-block-plan-status","data-tone":l,children:e.status})]}),e.summary&&(0,s.jsx)("p",{className:"report-block-plan-summary",children:e.summary}),e.items&&e.items.length>0&&(0,s.jsx)("ul",{className:"report-block-items",children:e.items.map((d,h)=>(0,s.jsx)(ze,{item:d,onDrillIn:n,canDrillIn:t,harnessSlug:a,planSlug:o,onWorkRefActivate:r},d.id??`${e.title}-${h}`))})]})}function Ze({report:e,onDrillIn:n,canDrillIn:t,harnessSlug:a,planSlug:o,onWorkRefActivate:r}){return!e.plans||e.plans.length===0?null:(0,s.jsxs)("div",{className:"report-block-card","data-component":"report-block",role:"group","aria-label":e.title??"Report",children:[e.title&&(0,s.jsx)("div",{className:"report-block-title",children:e.title}),(0,s.jsx)("div",{className:"report-block-plans",children:e.plans.map((i,l)=>(0,s.jsx)(Qe,{plan:i,onDrillIn:n,canDrillIn:t,harnessSlug:a,planSlug:o,onWorkRefActivate:r},i.slug??`${i.title}-${l}`))})]})}function Rt({args:e,answered:n,onResponse:t,onAnswer:a,allowDecline:o=!0,disableWhenAnswered:r=!0,hideOptions:i=!1,expired:l=!1}){const c=`ask-${e.question.slice(0,16).replace(/\s+/g,"-")}`,d=!!n,h=l&&!d,m=d&&r||h,g=e.multi===!0,p=i?[]:g?e.options:e.options.filter(u=>u.terminal!==!1),f=i?[]:g?[]:e.options.filter(u=>u.terminal===!1),y=u=>{m||(t&&t(u),a&&u.action==="submit"&&a({picks:u.picks}))},[b,q]=(0,v.useState)(new Set),K=new Set(n?.picks.map(u=>u.option_id)??[]),Y=()=>h?(0,s.jsx)("p",{className:"ask-choice-expired",role:"status",children:"Expired — this question is no longer open."}):d?n.declined?(0,s.jsx)("p",{className:"ask-choice-picked",children:"Skipped"}):(0,s.jsxs)("p",{className:"ask-choice-picked",children:["Picked ",(0,s.jsx)("span",{children:n.picks.map(u=>u.label).join(" · ")})]}):null,L=u=>{m||u.length===0||y({action:"submit",picks:u})};return(0,s.jsxs)("div",{role:"group","aria-labelledby":c,className:"ask-choice-card","data-tool":"chat:ask_choice","data-multi":g?"true":"false","data-answered":d?"true":"false","data-expired":h?"true":"false",children:[(0,s.jsxs)("div",{className:"ask-choice-head",children:[(0,s.jsx)("p",{id:c,className:"ask-choice-question",children:e.question}),Y()]}),e.report&&(0,s.jsx)("div",{className:"ask-choice-report",children:(0,s.jsx)(Ze,{report:e.report})}),p.length>0&&(0,s.jsx)("div",{className:"ask-choice-options",children:p.map(u=>{const I=K.has(u.id),j=g&&!d&&b.has(u.id),D=I||j,V=g?{"aria-checked":j||I||!1,role:"checkbox"}:{"aria-pressed":I||void 0};return(0,s.jsxs)("button",{type:"button",disabled:m,"aria-label":u.label,...V,onClick:()=>{m||(g?q(z=>{const S=new Set(z);return S.has(u.id)?S.delete(u.id):S.add(u.id),S}):L([{option_id:u.id,label:u.label}]))},className:"ask-choice-option","data-style":u.style??"default","data-picked":D?"true":"false","data-disabled":m?"true":"false",children:[(0,s.jsx)("span",{"aria-hidden":"true",className:"ask-choice-option-icon","data-style":u.style??"default",children:D?(0,s.jsx)(ee,{className:"ask-choice-icon"}):g?(0,s.jsx)(ae,{className:"ask-choice-icon"}):(0,s.jsx)(ne,{className:"ask-choice-icon"})}),(0,s.jsxs)("span",{className:"ask-choice-option-text",children:[(0,s.jsx)("span",{className:"ask-choice-option-label",children:u.label}),u.hint&&(0,s.jsx)("span",{"aria-hidden":"true",className:"ask-choice-option-hint",children:u.hint})]}),!m&&!g&&(0,s.jsx)(te,{className:"ask-choice-option-chevron",strokeWidth:2,"aria-hidden":"true"})]},u.id)})}),f.length>0&&(0,s.jsx)("div",{className:"ask-choice-nav",children:f.map(u=>(0,s.jsxs)("button",{type:"button",disabled:m,"aria-label":u.label,className:"ask-choice-nav-btn","data-style":u.style??"default",onClick:()=>y({action:"navigate",option_id:u.id,label:u.label}),children:[u.label,u.hint&&(0,s.jsx)("span",{className:"ask-choice-nav-hint",children:u.hint})]},u.id))}),!i&&g&&!d&&!h&&(0,s.jsxs)("div",{className:"ask-choice-submit-row",children:[(0,s.jsx)("span",{className:"ask-choice-submit-hint",children:b.size===0?"Pick one or more, then Submit":`${b.size} selected`}),(0,s.jsxs)("div",{className:"ask-choice-actions",children:[o&&(0,s.jsx)("button",{type:"button",onClick:()=>y({action:"decline"}),className:"ask-choice-skip","aria-label":"Skip",children:"Skip"}),(0,s.jsx)("button",{type:"button",disabled:b.size===0,onClick:()=>{L(e.options.filter(u=>b.has(u.id)).map(u=>({option_id:u.id,label:u.label})))},className:"ask-choice-submit",children:"Submit"})]})]}),!i&&!g&&!d&&!h&&o&&(0,s.jsx)("div",{className:"ask-choice-skip-row",children:(0,s.jsx)("button",{type:"button",onClick:()=>y({action:"decline"}),className:"ask-choice-skip-link","aria-label":"Skip this question",children:"Skip"})})]})}function Lt({prompt:e,presentation:n,fallbackText:t,allowDecline:a=!0,onResponse:o}){const r=`input-${e.slice(0,16).replace(/\s+/g,"-")}`;return n.kind==="text"?(0,s.jsx)(Je,{prompt:e,questionId:r,placeholder:n.placeholder,multiline:n.multiline??!1,fallbackText:t,allowDecline:a,onResponse:o}):n.kind==="date"?(0,s.jsx)(et,{prompt:e,questionId:r,min:n.min,max:n.max,allowDecline:a,onResponse:o}):(0,s.jsx)(tt,{prompt:e,questionId:r,min:n.min,max:n.max,step:n.step??1,allowDecline:a,onResponse:o})}function Je({prompt:e,questionId:n,placeholder:t,multiline:a,fallbackText:o,allowDecline:r,onResponse:i}){const[l,c]=(0,v.useState)(""),d=()=>{l.length!==0&&i({action:"submit",value:l})};return(0,s.jsxs)("div",{role:"group","aria-labelledby":n,className:"input-card","data-kind":"text",children:[(0,s.jsx)("p",{id:n,className:"input-card-question",children:e}),a?(0,s.jsx)("textarea",{className:"input-card-textarea",value:l,onChange:h=>c(h.target.value),placeholder:t??o??"",rows:3,"aria-label":"response"}):(0,s.jsx)("input",{type:"text",className:"input-card-input",value:l,onChange:h=>c(h.target.value),onKeyDown:h=>{h.key==="Enter"&&!h.shiftKey&&(h.preventDefault(),d())},placeholder:t??o??"","aria-label":"response"}),(0,s.jsxs)("div",{className:"input-card-actions",children:[r&&(0,s.jsx)("button",{type:"button",onClick:()=>i({action:"decline"}),className:"input-card-skip","aria-label":"Skip",children:"Skip"}),(0,s.jsx)("button",{type:"button",disabled:l.length===0,onClick:d,className:"input-card-submit",children:"Submit"})]})]})}function et({prompt:e,questionId:n,min:t,max:a,allowDecline:o,onResponse:r}){const[i,l]=(0,v.useState)("");return(0,s.jsxs)("div",{role:"group","aria-labelledby":n,className:"input-card","data-kind":"date",children:[(0,s.jsx)("p",{id:n,className:"input-card-question",children:e}),(0,s.jsx)("input",{type:"date",className:"input-card-date",value:i,min:t,max:a,onChange:c=>l(c.target.value),"aria-label":"date"}),(0,s.jsxs)("div",{className:"input-card-actions",children:[o&&(0,s.jsx)("button",{type:"button",onClick:()=>r({action:"decline"}),className:"input-card-skip","aria-label":"Skip",children:"Skip"}),(0,s.jsx)("button",{type:"button",disabled:i.length===0,onClick:()=>i.length>0&&r({action:"submit",value:i}),className:"input-card-submit",children:"Submit"})]})]})}function tt({prompt:e,questionId:n,min:t,max:a,step:o,allowDecline:r,onResponse:i}){const[l,c]=(0,v.useState)(Math.round((t+a)/2/o)*o);return(0,s.jsxs)("div",{role:"group","aria-labelledby":n,className:"input-card","data-kind":"slider",children:[(0,s.jsx)("p",{id:n,className:"input-card-question",children:e}),(0,s.jsxs)("div",{className:"input-card-slider-row",children:[(0,s.jsx)("input",{type:"range",className:"input-card-slider",min:t,max:a,step:o,value:l,onChange:d=>c(Number(d.target.value)),"aria-label":"value","aria-valuemin":t,"aria-valuemax":a,"aria-valuenow":l}),(0,s.jsx)("output",{className:"input-card-slider-value","aria-live":"polite",children:l})]}),(0,s.jsxs)("div",{className:"input-card-actions",children:[r&&(0,s.jsx)("button",{type:"button",onClick:()=>i({action:"decline"}),className:"input-card-skip","aria-label":"Skip",children:"Skip"}),(0,s.jsx)("button",{type:"button",onClick:()=>i({action:"submit",value:l}),className:"input-card-submit",children:"Submit"})]})]})}export{ke as A,Le as C,Be as D,$ as E,bt as F,we as M,be as N,wt as O,ge as P,xt as S,It as T,N as _,Et as a,De as b,je as c,Ue as d,Tt as f,At as g,We as h,kt as i,ve as j,F as k,Nt as l,$e as m,Rt as n,St as o,G as p,Ze as r,Ie as s,Lt as t,vt as u,w as v,Ct as w,He as x,Ot as y};
