---
id: ch3-01-queen-vs-su
chapter: 3
order: 1
title: Automatic work — the Mug vs SU agents
docSlugs: agent-insights/two-dispatch-models-queen-bee-vs-coding-factory, agent-insights/driving-the-autonomous-hive-loop
---

## Brief

There are two ways work gets done here. **SU agents** (like me) are
interactive — you direct them. The other way is autonomous: the **Mug** —
Papercusp's high-judgment brain — wakes on its own schedule, reads the ranked
backlog, and *places* work onto worker agents (**Cups**) — no human in the
loop. You feed it by filing work; the Mug handles who does what.

## Details

The Mug is a triager and placer, not a doer: each wake it surveys the
queue, dedupes, ranks, and assigns items to Cups (generalist worker agents
spawned as needed). Cups work their assignment, report completion with
evidence, and the Mug re-checks. Approval gates still hold — anything
marked as needing a human waits for you.

SU sessions and the autonomous Mug share everything: the same queue, the same
plans, the same coordination layer. So you can file work in a chat with me,
watch a Cup pick it up ten minutes later, and read its completion in the GUI.
The practical split: use an SU session when you want to steer and iterate;
hand work to the Mug when you just want it done eventually.

The autonomous Mug is pauseable — a switch in the GUI (or one ask to an agent)
stops its wakes; nothing autonomous happens while it's off.
