<!--
Claude Code overlay for the compaction instructions. Spliced into
papercusp-compaction.base.md at PAPERCUSP-COMPACTION:CLIENT-OVERLAY. The rendered
result is projected under `# Compact Instructions` in root/user CLAUDE.md (via
@import) and used as the focus text for self-triggered `/compact`.
Canonical — do not hand-edit the projected output. Plan: agent-managed-compaction-2026-07-01.
-->

## One-shot `/compact` focus (Claude Code)
Claude Code applies these instructions as *guidance* to its own summarizer (there
is no prompt override). When you deliberately compact at a stopping point, name
the current unit of work in the focus, e.g.:

`/compact keep the identity block, active plan <slug> and its open items, unverified claims, and owner-walls; drop resolved tool output.`

Auto-compactions you did not trigger fall back to these `# Compact Instructions`
alone — which is why they live in root/user CLAUDE.md (nested CLAUDE.md is not
re-injected after compaction).
