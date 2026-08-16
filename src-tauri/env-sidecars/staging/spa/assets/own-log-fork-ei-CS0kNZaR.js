import{n}from"./chunk-ChpBd9eV.js";import{i as a,r as i}from"./episodic-ei-eXhkvEh1.js";function l(e){return`[own-log-fork-guard] own_log_forked: harness=${e.harnessSlug} log=${e.keyHex.slice(0,12)}… (equivocation loop, WI-183-adjacent)`}function c(e){return`Own-log fork guard (P-003 / WI-3535): ${e.detail}

workspace=${e.workspaceId} harness=${e.harnessSlug}
log_core_key=${e.keyHex}

Meaning: this harness's OWN writable single-writer log (packages/operator-core/lib/sync/hyperbee/peer-log.ts openOwnLog) hit Hypercore's equivocation loop — "[hypercore] conflict detected" — because two conflicting signatures exist for the same log length. The most likely cause is the WI-1891 "two live keys at once" class (the own-log keypair did not persist across a restart / was duplicated onto a second live process, so two writers signed divergent history under the same key) or a corrupted/rolled-back local corestore. Hypercore has already closed EVERY open session to this core (SESSION_CLOSED on the next append/get) — local writes made against it are frozen, and re-booting WITHOUT fixing the on-disk state re-opens the SAME corrupted core, which re-forks on the next reconnect (the observed boot loop; old key e06b8704 cost hours before this was ever noticed).

Supported recovery: a PER-HARNESS STORE RESET — stop the harness, delete or move aside its Corestore directory (<workspaceRoot>/.papercusp/${e.harnessSlug}/hyperbee/), then re-boot. Corestore lazily creates a FRESH keypair (a new own-log key) on first access, so the harness re-publishes its LOCAL history (PG-mirrored data is unaffected) under a new identity that no peer has conflicting proof for. This is destructive to the local hypercore-only log — only do it once the harness's local writes are confirmed merged into PG (or acceptably lost).

IMPORTANT: \`rekeyHarness\` (boot-all.ts) does NOT fix this — it only re-binds the swarm TOPIC binding (e.g. for a hive-membership change) and never touches the own-log Corestore, so calling it against a forked own-log leaves the SAME corrupted core in place and the boot loop continues.

An auto-recovery sketch exists behind a flag-gated, default-OFF kill-switch (destructive — see own-log-fork-recovery.ts / FLAGS.OWN_LOG_FORK_AUTO_RECOVERY) — the owner must ratify it before it runs unattended.

This EI auto-dedupes per (harness, own-log key) while one stays open.`}function p(e,s){return t.file(e,s)}var o,r,t,d=n((()=>{a(),o="own-log-fork",r="system:own-log-fork-guard",t=i({topic:o,stableTitle:l,buildBody:c,resolveNote:e=>`resolved: own-log store reset — ${e.detail}`,severity:"critical",createdBy:"system:own-log-fork-guard",foundDuring:"own-log-fork-guard-detector",recoveryOwner:r})}));d();export{p as fileOwnLogForkEi};
