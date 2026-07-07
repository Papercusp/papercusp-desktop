---
id: ch6-05-p2p-git
chapter: 6
order: 5
title: Peer-to-peer git — replicating code without a central remote
docSlugs: system/hive-git-sync
---

## Brief

**Under construction — not yet a dependable feature.** The aim: the shared
working tree that git-sync commits (chapter 5) replicates directly between
the machines in a Pot over the p2p channel — every peer holds the code, no GitHub or
central server required for the Pot to function.

## Details

Honest labeling first: **p2p git replication is still being built.** Today
the canonical flow runs through a conventional git remote; the p2p path
exists in early form (the git-sync design describes it) but is not
what's keeping your code safe right now.

The design extends git-sync's existing rhythm. You've seen that agents never
commit — a background routine sweeps the tree on a schedule. In the p2p
version, each sweep also announces new commits to peers over the encrypted
network, and peers fetch objects directly from each other. Git's content-
addressed model is a natural fit: commits are immutable, verifiable blobs,
so replication is just "who has which objects," and any peer can serve any
other.

Why bother, when GitHub exists? Resilience and privacy: a Pot that fully
replicates its own history keeps working — including merges, deploys, and
the green gate — with no internet, and code never has to leave machines you
own. A conventional remote becomes an optional mirror rather than a
dependency.

Until it ships, nothing changes for you: git-sync commits, the remote holds
history, and the pipeline you learned in chapter 5 is the real one.
