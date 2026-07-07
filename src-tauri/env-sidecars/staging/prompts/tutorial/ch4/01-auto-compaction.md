---
id: ch4-01-auto-compaction
chapter: 4
order: 1
title: Auto-compaction — how agents outlive their context window
docSlugs: agents/compaction
---

## Brief

An agent's working memory (its "context window") is finite — a long session
eventually fills it. **Compaction** is how a session survives that: the
conversation is summarized down to the essentials and the agent continues
with the summary plus pointers back to durable state. It happens
automatically; you'll barely notice beyond a brief pause.

## Details

The key design choice: the summary is an *index*, not the state itself.
Before compacting, a disciplined agent parks everything important in durable
stores — progress on its work items, conclusions, memory — and the summary
just points there. So even an imperfect summary loses nothing that matters:
the next turn re-reads the real state from the database.

This is also why long-running work here is resilient in general. Sessions
crash, windows close, contexts compact — and the work continues, because
the source of truth was never the conversation. The conversation is a view;
the database is the state.
