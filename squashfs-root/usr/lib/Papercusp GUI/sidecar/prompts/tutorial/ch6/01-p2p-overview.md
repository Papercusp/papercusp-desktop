---
id: ch6-01-p2p-overview
chapter: 6
order: 1
title: The peer-to-peer vision — many machines, one Pot
docSlugs: spec/multi-topology, spec/distribution
---

## Brief

**Everything in this chapter is under construction — it describes where
Papercusp is going, not what it reliably does today.** The vision: several
machines — your laptop, a desktop, a tower in the closet, a teammate's box —
form one **peer-to-peer Pot**. Work, agents, accounts, and even GPU time
flow to wherever they're best served, with no central server anywhere.

## Details

To be explicit up front: **this is the aspirational chapter.** The p2p
substrate exists and parts of it work in test rigs (machines already sync
coordination state over an encrypted peer network), but the features described
in the next four sections are being actively built and should not be relied
on yet. They're in the tutorial because they explain the design decisions
you've already seen — why state lives in durable, syncable stores, why
coordination is message-based, why nothing assumes a single machine.

The shape of the goal: you install Papercusp on a second machine, pair it
with your first, and they become one system. Plans, work items, and memory
replicate both ways; an agent on either machine can see and coordinate with
agents on the other. No cloud relay, no account with a vendor — machines
find each other and talk directly, encrypted end to end.

The sections that follow cover the individual capabilities being built on
that substrate: GPU allocation, account allocation, cross-machine agent
delegation, and peer-to-peer git. Each one repeats this disclaimer, because
it's the honest state: designed, partially built, not yet dependable.
