# Exit 144 — pkill -f kills your own Bash tool shell
URL: /internal/docs/agent-insights/exit-144-pkill-self-match

A Bash tool call that contains `pkill -f "<pattern>"` dies with exit 144 when the pattern appears anywhere in the script text — the tool runs the script with its full text in argv, so pkill matches and kills its own shell. Misdiagnosed on 2026-06-11 as "the box wall-clock-SIGTERMs every vite/playwright launch", which stalled e2e verification for a whole session and forced a needless handoff.

## Symptom

A Bash tool call exits **144** with partial output — everything up to a
`pkill -f "<pattern>"` line ran, nothing after it did. Repeats 100% of the
time for that script, on any agent client (Claude Code, psu, OMP), regardless
of box load or free memory.

The seductive misread: "the environment is killing my long-running
launches." On 2026-06-11 an agent (su-1656a) burned 5+ retries and handed off
two e2e specs as "un-verifiable on this box — every `npx vite` / `npx
playwright` launch is wall-clock-SIGTERM'd (exit 144), 104G free so not OOM."
The launches were fine. Every rig script began (and ended) with
`pkill -f "vite --port 3155"`.

## Root cause

The Bash tool executes your script as `bash -c '<entire script text>'` — the
full script, **including the pkill pattern itself**, is in that process's
command line. `pkill -f` matches against full command lines, so it matches
*your own shell* and kills it. Exit 144, command truncated at the pkill line.

The tell that it's self-inflicted, not environmental: side effects *before*
the pkill landed; side effects *after* it (including `>` log truncation on a
later line) never happened. In the e2e saga the vite log still held the
previous night's content — the leading pkill killed the shell before the
redirect ever executed.

## Fix — kill by PID, never by pattern

```bash
# free a port: resolve the holder's PID, kill by number
P=$(ss -ltnp 2>/dev/null | sed -n 's/.*:3155 .*pid=\([0-9]*\).*/\1/p' | head -1)
[ -n "$P" ] && kill "$P"

# tear down something you launched: you have $!
setsid npx vite --port 3155 --strictPort >/tmp/rig.log 2>&1 &
VPID=$!
# ... use it ...
kill -- -$VPID 2>/dev/null || kill $VPID
```

Acceptable alternatives: `pgrep -x <binary>` (exact name match, no -f), or
`pgrep -f` → inspect the PID list → `kill <pids>` (pgrep doesn't kill, so
matching yourself is harmless). Never `pkill -f` / `pkill -9 -f` from a tool
call. The same rule protects peers: name-pattern kills on the shared box have
previously taken out the owner's live desktop and peer Xvfb instances.

## Wider lesson

A 100%-reproducible "environment kills my process" with partial script output
is a *self-kill* until proven otherwise. Check exactly which line stopped
producing effects before blaming the box — and grep your own script for
`pkill`/`kill` patterns that could match the script text itself. This class
has now hit at least four sessions (desktop-kill incident, su-6c28e,
su-69643, su-1656a's e2e saga).
