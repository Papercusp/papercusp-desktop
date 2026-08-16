import{n as d}from"./chunk-ChpBd9eV.js";function n(e){const t=e.trim().toLowerCase();return r.find(a=>a.id===t)??null}function u(e){return e.axis==="overlay"?`overlay:${e.id}`:e.axis}function p(e){const t=n(e);return t?t.axis==="autonomy"?!0:l(e).some(a=>n(a)?.axis==="autonomy"):!1}function l(e){const t=n(e);if(!t)return[];const a=new Set([t.id]),o=[],s=[...t.implies??[]];for(;s.length;){const i=n(s.shift());!i||a.has(i.id)||(a.add(i.id),o.push(i.id),s.push(...i.implies??[]))}return o}function m(e){const t=n(e);return t?t.requiresSubject===!0:!1}function g(){return r.filter(e=>e.launchable===!0)}function y(e){return(n(e)?.id??e).toUpperCase().replace(/-/g," ")}function w(e,t){const a=n(e),o=a?`${a.title}
${a.oneLiner}`:`Standing mode: ${e}`;return t?.ownerDirected===void 0?o:`${o}

${t.ownerDirected?"Set by the owner — peers cannot override it.":"The agent set this itself (or a peer did) — an owner instruction overrides it."}`}var r,h,f=d((()=>{r=[{id:"auto",axis:"autonomy",launchable:!0,title:"AUTO — act, don’t ask",oneLiner:"act on your own judgment, replace questions with disclosures, arm a loop for open-ended work",contract:`## AUTO mode — binding contract
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
the pass under one lens → FILE lens-tagged, adding a bet/cheapExperiment when the idea is a
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
concrete value for each rather than offering a blank menu.
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
   the reason small work-items you file directly still get done. Re-establish it
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
on a test's subject the way the goal paths join on a goal's.)`}],h=r.filter(e=>e.launchable===!0).map(e=>e.id)}));export{n as a,p as c,g as i,m as l,u as n,y as o,f as r,w as s,r as t,l as u};
