---
id: ch4-03-memory
chapter: 4
order: 3
title: Agent memory — what the system knows about your world
docSlugs: harness/memory
---

## Brief

Papercusp keeps a shared, searchable **memory**: durable knowledge about
your projects, preferences, and past decisions, recalled semantically ("what
do we know about the payments service?") rather than by exact keyword. Every
agent reads from and writes to the same store, so what one agent learns, all
of them know.

## Details

Memory is the fuzzy layer of the knowledge stack — the right home for
background that should shape future work: "the owner prefers small PRs",
"the staging database is reset nightly", "we chose library X over Y because
Z". At the start of a task an agent recalls what's relevant to its intent
and treats hits as binding context.

It's shared on purpose: a memory written during a chat session is recalled
by an autonomous Cup next week. That is what makes the system feel like one
organization rather than a series of goldfish conversations.

If an agent remembers something wrongly — or you change your mind — just say
so: memories can be corrected or forgotten, and the correction propagates to
everyone the same way.
