#!/usr/bin/env bash
# PreToolUse hook — gate raw `Bash` commands against the named-resource lock
# registry (plan named-resource-locks-drain, P-026/D-013). When a command
# would collide with an in-flight EXCLUSIVE hold on a registered resource
# (e.g. a peer is mid `dev:restart`), block it; otherwise proceed.
#
# ALSO: the native-scheduler lockout (native-scheduler-lockout-2026-06-09
# P-010) — when this session is an AGENT session (PAPERCUSP_AGENT_SESSION=1:
# role panes, the brain/Queen; the owner's own sessions never set it), deny
# persistent OS schedulers (crontab/at/batch/systemd-run) at command position.
# Local regex, no HTTP. Catches the compound forms (`cd x && crontab …`) the
# launch-time Bash(crontab:*) prefix deny-patterns can't. Wakes belong in the
# harness routines table (hive:declare-wake) — the only scheduler that
# Pause/hive:status/the liveness backstop can see.
#
# Cheap by design: a local keyword pre-filter lets the overwhelming majority
# of commands (ls/git/grep/…) return immediately with NO HTTP call. Only a
# command that looks destructive (systemctl/overmind/psql/npm run dev) is
# checked against the operator via locks:check_command.
#
# Fail-open everywhere: not installed, operator unreachable, or any parse
# error → ALLOW (cooperative enforcement only works while the system is up).
# Only an explicit decision === 'block' denies.
#
# NOTE: the pre-filter tokens mirror the seeded resources' match_patterns; a
# new resource with a novel pattern needs a token added here (or drop the
# pre-filter to always-check). Decision logic is server-side (registry-driven).

set -euo pipefail

OPERATOR_URL="${PAPERCUSP_OPERATOR_URL:-http://localhost:3070}"
TOKEN_PATH="${HOME}/.papercusp/superuser-token"
AGENT_ID_PATH="${HOME}/.papercusp/su-agent-id"

if [ ! -s "$TOKEN_PATH" ] || [ ! -s "$AGENT_ID_PATH" ]; then
  exit 0
fi

TOKEN=$(cat "$TOKEN_PATH")
AGENT_ID=$(cat "$AGENT_ID_PATH")
INPUT=$(cat)

python3 - "$INPUT" "$OPERATOR_URL" "$TOKEN" "$AGENT_ID" <<'PYEOF' || { echo '[resource-gate] hook error — allowing (fail-open)' >&2; exit 0; }
import json, os, re, sys, tempfile, urllib.request, urllib.parse
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))  # localhost operator: never via egress http(s)_proxy (502s the local call -> false fail-open)

raw, operator_url, token, agent_id = sys.argv[1:5]

# Soft advisory attached to an ALLOW verdict (coord-delivery-residual-gaps
# P-003). None = plain silent allow; a string rides out as additionalContext
# on an explicit permissionDecision:'allow' payload. Denies always win — the
# advisory only decorates commands every gate already passed.
ADVISORY = None

def allow():
    if ADVISORY:
        json.dump({'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'permissionDecision': 'allow',
            'permissionDecisionReason': 'long-foreground-exec advisory (non-blocking)',
            'additionalContext': ADVISORY,
        }}, sys.stdout)
    sys.exit(0)

def deny(reason):
    json.dump({'hookSpecificOutput': {
        'hookEventName': 'PreToolUse',
        'permissionDecision': 'deny',
        'permissionDecisionReason': reason,
    }}, sys.stdout)
    sys.exit(0)

try:
    payload = json.loads(raw)
except Exception:
    allow()

tool_name = payload.get('tool_name', '') or ''
tool_input = payload.get('tool_input', {})
# 'Bash' is claude's name; exec_command/local_shell/shell are codex's shell
# tool names (the codex hooks.json attaches this script too — README table).
if tool_name.lower() not in ('bash', 'exec_command', 'local_shell', 'shell'):
    allow()

command = tool_input.get('command') if isinstance(tool_input, dict) else None
if not isinstance(command, str) or not command.strip():
    allow()

# ── Long-foreground-exec advisory (coord-delivery-residual-gaps P-003) ──────
# A foreground Bash run blocks the session's turn for its whole duration: coord
# messages, wakes, and yields cannot reach the agent until it returns — the
# mid-exec deafness window (see the coord-mid-turn-delivery insight). When the
# caller EXPLICITLY requests a foreground timeout past the 2-min default, that
# is a declared intent to hold the turn for minutes — nudge it toward the
# native background primitive instead. STRICTLY per-backend: only Claude's
# `Bash` tool has `run_in_background` (same-session detach — the harness
# re-invokes the SAME session on exit; no delegation, no context loss), so only
# tool_name 'bash' gets the nudge. Codex shells (exec_command/local_shell/
# shell) have no native background primitive in our integration — no nudge
# (their deafness window is covered by the wake + escalation-ladder legs); OMP
# nudges its own `job` primitive from its own hook, not this script. SOFT by
# design: sets the ADVISORY string only — the command always proceeds, and any
# later deny gate still wins.
try:
    if tool_name.lower() == 'bash':
        _t = tool_input.get('timeout')
        _bg = tool_input.get('run_in_background')
        if not _bg and isinstance(_t, (int, float)) and _t > 120_000:
            ADVISORY = (
                f'long-foreground-exec advisory: this Bash call requests a FOREGROUND '
                f'timeout of {int(_t / 1000)}s. A foreground run holds your turn for its whole '
                f'duration — coord messages, wakes, and yield requests cannot reach you '
                f'until it returns (the mid-exec deafness window). For anything expected '
                f'to run >2min, prefer `run_in_background: true`: it stays in THIS session '
                f'(no delegation, no context loss) — the command detaches, you keep taking '
                f'turns, and you are re-invoked when it exits. Advisory only; this command '
                f'is proceeding as issued.'
            )
except Exception:
    pass  # advisory must never wedge a command

# Native-scheduler lockout (native-scheduler-lockout-2026-06-09 P-010): agent
# sessions must not create persistent OS schedules — a crontab entry outlives
# the hive as a zombie wake source that Pause/hive:status/the liveness
# backstop can't see. Command-position match (start / after ;&|/newline /
# sudo) so prose args ("look at this") never false-positive. Local decision,
# no HTTP; the owner's own sessions never carry the marker (D-003).
#
# EI-9937: the ;&|/newline separators in the command-position anchor are SHELL
# operators — but a `;`/`&`/`|` INSIDE a quoted argument is literal data, not a
# separator. So a read-only `grep -E "at|batch" code-run-batch-nudge.ts` (a regex
# alternation naming these very tokens) or a `"...; batch..."` string was denied
# as if it created an OS schedule. Strip quoted spans BEFORE matching: quoted
# content can only ever REMOVE a would-be separator, so every genuine (unquoted)
# `crontab -e`/`batch < f`/`&& crontab`/`sudo crontab` deny is preserved.
def _strip_shell_quotes(s):
    # Replace single- and double-quoted spans with a single space so operators
    # (;&|) inside a quoted arg are not read as command separators, and adjacent
    # tokens are neither glued (a false negative) nor made adjacent to a
    # separator (a false positive). An unterminated quote drops the rest (only
    # ever more permissive). A backslash-escaped quote inside "..." doesn't close.
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c == "'":
            j = s.find("'", i + 1)
            if j == -1:
                break
            out.append(' ')
            i = j + 1
        elif c == '"':
            j = i + 1
            while j < n:
                if s[j] == '\\':
                    j += 2
                    continue
                if s[j] == '"':
                    break
                j += 1
            if j >= n:
                break
            out.append(' ')
            i = j + 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)

# EI-10940: the refusal must answer the INTENT, not the token. `systemd-run` is
# BOTH the scheduler (`--on-calendar=…`) and the only stock way to ask for cgroup
# resource control (`-p CPUQuota=…`, `--scope`). An agent reaching for the SECOND
# one is not scheduling anything — pointing it at `pot:declare-wake` (a WAKE
# scheduler) is a non-sequitur that costs a real debugging detour before it works
# out that the tool it was told to use cannot do the thing it wanted. The deny
# itself is correct either way (agent sessions cannot create transient units), so
# branch only the REASON: name the actual alternatives (`taskset` / pc-heavy.sh).
# Mirrors isResourceLimitInvocation()/osSchedulerDenyReason() in the OMP hook
# (scripts/hooks/omp/coord-hook.ts) — a guard fixed in one path must be fixed in
# both, since Claude/Codex hit THIS one and OMP hits that one.
_SYSTEMD_RESOURCE_PROP_RE = (
    r'(?:-p|--property)[=\s]*'
    r'(?:CPUQuota|CPUWeight|AllowedCPUs|AllowedMemoryNodes|MemoryMax|MemoryHigh'
    r'|MemoryLimit|IOWeight|TasksMax)\b'
    r'|--scope\b'
)
_SYSTEMD_SCHEDULE_FLAG_RE = (
    r'--on-(?:calendar|active|boot|startup|unit-active|unit-inactive)\b'
    r'|--timer-property\b'
)


def _is_resource_limit_invocation(cmd):
    # True only for a `systemd-run` asking for RESOURCE CONTROL, not a schedule.
    # A schedule flag WINS (`systemd-run --on-calendar=… -p CPUQuota=…` really is
    # creating a timer) so the scheduling advice stays correct for the hybrid.
    c = _strip_shell_quotes(cmd)
    if not re.search(r'\bsystemd-run\b', c):
        return False
    if re.search(_SYSTEMD_SCHEDULE_FLAG_RE, c, re.I):
        return False  # scheduling wins
    return bool(re.search(_SYSTEMD_RESOURCE_PROP_RE, c, re.I))


def _os_scheduler_deny_reason(cmd):
    if _is_resource_limit_invocation(cmd):
        return (
            'native-scheduler lockout: agent sessions cannot create transient systemd '
            'units, so cgroup resource control via `systemd-run` is unavailable here. '
            'You are trying to LIMIT RESOURCES, not schedule a wake — use `taskset -c '
            '<cores> <cmd>` to pin CPUs (no scheduler, no root, no daemon), or run heavy '
            'commands through `scripts/pc-heavy.sh` (nice + a concurrency semaphore) on '
            'the shared box. (`pot:declare-wake` is for SCHEDULING and is not what you want.)'
        )
    return (
        'native-scheduler lockout: agent sessions must not create OS schedules '
        '(crontab / at / batch / systemd-run). Declare your wake via '
        'pot:declare-wake instead — the routines table is the only scheduler '
        "the hive's pause/status/liveness machinery can see."
    )


if os.environ.get('PAPERCUSP_AGENT_SESSION') == '1' and re.search(
        r'(?:^|[;&|\n]\s*|\bsudo\s+)(?:crontab|batch|systemd-run)\b'
        r'|(?:^|[;&|\n]\s*|\bsudo\s+)at\s+(?:now|midnight|noon|teatime|\+?\d)',
        _strip_shell_quotes(command)):
    deny(_os_scheduler_deny_reason(command))

# ── tauri-agent-tools target guard (EI-10939) ────────────────────────────────
# SAFETY. `tauri-agent-tools` picks its target by scanning /tmp for
# `tauri-dev-bridge-<pid>.token` files and taking THE FIRST LIVE ONE IT HAPPENS
# TO READ (dist/bridge/tokenDiscovery.js: `if (!found) found = …`, over an
# unordered readdir; dist/commands/shared.js `resolveBridge()` falls into that
# path whenever `--pid` and `--port`+`--token` are all absent). There is no
# preference, no tie-break, and — this is the bug — NO WARNING when several
# bridges are alive. So a bare `tauri-agent-tools click …` drives WHICHEVER app
# readdir yielded first, which is very often NOT the throwaway instance the
# agent just spawned but the OWNER'S LIVE DESKTOP WINDOW. This nearly happened
# (an agent one keystroke from typing into the owner's real app).
#
# The package is a third-party global npm install (github.com/cesarandreslopez/
# tauri-agent-tools) — outside our repo, so we cannot fix `resolveBridge`. We CAN
# refuse to let an unaimed command through, which is the same protection.
#
# TWO TIERS, because ambiguity is not the only hazard:
#   • MUTATING (eval/click/type/…): an explicit target is required ALWAYS, even
#     when exactly one bridge is live. Verified 2026-07-13: the ONLY live bridge
#     on this box was the owner's own `papercusp-desktop` — so an ambiguity-only
#     rule would have sailed straight through and driven his window. If you are
#     about to DRIVE a webview, you must say which one. No exceptions.
#   • READ-ONLY bridge commands (dom/screenshot/page-state/…): required only when
#     the choice is genuinely AMBIGUOUS (2+ live bridges). Reading the wrong app
#     is how "I verified my fix" becomes a false green.
#   • Discovery + bridge-free commands (probe/list-windows/info/forensics/…) are
#     NEVER gated — `probe` is the ANSWER to this deny, so blocking it would be
#     perverse.
#
# NOT gated on PAPERCUSP_AGENT_SESSION: EI-7872 established that the marker is
# silently unset in fleet-launched sessions — exactly the ones doing unattended
# UI verification. The resource being protected is the owner's live app, not a
# tree, and the deny is satisfiable with one flag, so it applies to every session
# this hook runs in. Mirrors tauriTargetDenyReason() in the OMP hook.
TAT_MUTATING = frozenset((
    'eval', 'click', 'type', 'scroll', 'focus', 'navigate', 'select', 'invoke',
))
TAT_BRIDGE_READ = frozenset((
    'screenshot', 'dom', 'wait', 'ipc-monitor', 'page-state', 'storage',
    'console-monitor', 'mutations', 'snapshot', 'rust-logs', 'store-inspect',
    'check', 'capture', 'process-tree', 'capabilities', 'webview', 'health',
    'diagnose',
))
_TAT_BIN_RE = re.compile(r'(?:^|[\s;&|(])(?:[\w./-]*/)?tauri-agent-tools(?=\s|$)')


def _tat_subcommand(cmd):
    # The subcommand is the first non-flag token after the binary. Returns None
    # for a bare/`--help`/`--version` invocation (nothing to aim).
    m = _TAT_BIN_RE.search(cmd)
    if not m:
        return None
    rest = cmd[m.end():].split()
    for tok in rest:
        if tok.startswith('-'):
            continue
        return tok
    return None


def _tat_has_explicit_target(cmd):
    # `--pid N` is the aim. `--port N --token X` bypasses discovery entirely and
    # is equally explicit. Either satisfies the guard. (Quote-stripped: a quoted
    # VALUE disappears but the flag token itself survives, so this stays sound.)
    if re.search(r'--pid[=\s]', cmd):
        return True
    return bool(re.search(r'--port[=\s]', cmd) and re.search(r'--token[=\s]', cmd))


def _tat_live_bridges():
    # Same discovery the tool itself does — /tmp/tauri-dev-bridge-<pid>.token,
    # keeping only the ones whose pid is still alive — plus the process cmdline,
    # so the refusal can NAME the candidates instead of just asserting ambiguity.
    import glob
    out = []
    for path in sorted(glob.glob(os.path.join(tempfile.gettempdir(), 'tauri-dev-bridge-*.token'))):
        try:
            with open(path) as fh:
                data = json.load(fh)
            pid = int(data['pid'])
            os.kill(pid, 0)  # raises unless alive
        except Exception:
            continue  # dead / malformed — the tool skips these too
        try:
            with open('/proc/%d/cmdline' % pid, 'rb') as fh:
                exe = fh.read().replace(b'\x00', b' ').decode('utf-8', 'replace').strip()
        except Exception:
            exe = '(unknown process)'
        out.append({'pid': pid, 'port': data.get('port'), 'exe': exe[:100]})
    return out


def _tat_candidate_lines(bridges):
    return '\n'.join(
        '  --pid %-8d port %-6s %s' % (b['pid'], b['port'], b['exe']) for b in bridges
    ) or '  (none discoverable right now)'


def _tauri_target_deny_reason(sub, bridges, mutating):
    head = (
        'tauri-agent-tools target guard: this command DRIVES a webview but does not say WHICH one.'
        if mutating else
        'tauri-agent-tools target guard: %d bridges are live, so `%s` cannot tell which app you mean.'
        % (len(bridges), sub)
    )
    why = (
        'With no --pid, tauri-agent-tools attaches to the FIRST bridge token it finds in /tmp — '
        'an arbitrary readdir order, with no warning. That is frequently the OWNER\'S LIVE DESKTOP '
        'APP rather than the instance you spawned.'
    )
    return (
        '%s\n%s\n\nLive bridges right now:\n%s\n\nRe-run naming your target:\n'
        '  tauri-agent-tools %s --pid <PID> …\n\n'
        'Not sure which is yours? `tauri-agent-tools probe` (never blocked) lists the targets, '
        'and the PID of an app YOU spawned is the one you launched — if you did not spawn one, '
        'you are about to act on someone else\'s window.' % (
            head, why, _tat_candidate_lines(bridges), sub,
        )
    )


_tat_sub = _tat_subcommand(_strip_shell_quotes(command))
if _tat_sub in TAT_MUTATING or _tat_sub in TAT_BRIDGE_READ:
    _stripped_cmd = _strip_shell_quotes(command)
    if not _tat_has_explicit_target(_stripped_cmd):
        _mutating = _tat_sub in TAT_MUTATING
        _bridges = _tat_live_bridges()
        # Mutating: always require an aim. Read-only: only when ambiguous.
        # Zero bridges → nothing to hit; let the tool print its own error.
        if _bridges and (_mutating or len(_bridges) > 1):
            deny(_tauri_target_deny_reason(_tat_sub, _bridges, _mutating))

# Destructive tree-wide git guard (hive-loop-supervision-2026-06-21): a
# pathspec-less `git reset --hard` / `git checkout|restore .` (or `:/`) /
# `git clean -f*` / `git stash` on the SHARED staging checkout discards EVERY
# concurrent agent's UNCOMMITTED work — edits sit unstaged until the next
# git-sync tick, so the loss is UNRECOVERABLE (git never made a blob; kopia
# backs up workspace-state, ~14KB, NOT the code). Confirmed wiping a tested
# in-flight fix on 2026-06-21 (an agent "cleaning the tree" between commits) —
# the root of the recurring "my edits got reverted/overwritten" reports.
#
# GATE ON THE TREE, NOT THE MARKER (EI-7872, 2026-07-06): this block was gated
# on `PAPERCUSP_AGENT_SESSION == '1'`, but that env marker is silently ABSENT
# in fleet-launched sessions (fleet:launch-on-plan → the drain fleet) — VERIFIED
# unset in the Claude PROCESS env (env A, what THIS hook inherits — read from
# /proc/<pid>/environ, not just the Bash sub-shell), so the sole rail against
# fleet-wide uncommitted-work loss was INERT (fail-OPEN) for exactly the sessions
# it must protect. The resource being protected is the canonical SHARED staging
# checkout, so gate on THAT directly: fire when the command runs IN that tree
# (payload `cwd`, read the same way the sibling lock hook does), independent of
# any env marker. The owner's OWN separate checkouts (papercup-release, other
# worktrees) have a different cwd and stay exempt — the real D-003 intent, keyed
# by TREE not marker (and nobody, owner included, should reset --hard the shared
# concurrent tree). The marker is still honored as an OR-trigger, so any launch
# path that DOES set it stays covered even outside the tree. Local decision, no
# HTTP. Per-segment + start-anchored (re.match after splitting on ;&|newline and
# stripping wrappers) so `cd x && git reset --hard` is caught but `echo "…"` is not.
def _cmd_in_canonical_tree():
    # True when the command's working dir is the canonical shared staging tree
    # (or under it). cwd from the hook payload, falling back to the hook
    # process cwd for shells that don't pass one (codex). realpath-compared so
    # a symlinked checkout still matches; the `+ os.sep` guard stops a sibling
    # like `papercusp-staging` from matching `papercusp`. Fail-open on our own
    # error (a hook must never wedge every bash command).
    try:
        _cwd = os.path.realpath(payload.get('cwd') or os.getcwd())
        _ws_root = os.path.realpath(
            os.environ.get('PAPERCUSP_WORKSPACE_ROOT')
            or os.path.expanduser('~/papercupai-workspace'))
        _canon = os.path.realpath(
            os.environ.get('PAPERCUSP_CANONICAL_TREE')
            or os.path.join(_ws_root, 'papercusp'))
        def _in(p):
            return p == _canon or p.startswith(_canon + os.sep)
        if _in(_cwd):
            return True
        # Also honor a leading `cd <path> && …`: a marker-less fleet session
        # (EI-7872) running e.g. `cd <canonical> && git reset --hard` (or a heavy
        # build) carries the OUTER cwd in the payload, so the cwd check alone
        # misses it. Resolve ONLY a simple, unambiguous leading cd target (no
        # spaces, quotes, or shell operators/expansion) against the outer cwd;
        # anything fancier falls back to the cwd-only result, and accurate
        # realpath resolution means `cd /other/repo && …` stays outside canonical
        # — so this only ever gates MORE (never a false positive on another tree).
        _cd = re.match(r"\s*cd\s+(['\"]?)([^&|;<>\s'\"]+)\1\s*(?:&&|;|\||$)", command)
        if _cd and _in(os.path.realpath(os.path.join(_cwd, _cd.group(2)))):
            return True
        return False
    except Exception:
        return False

if os.environ.get('PAPERCUSP_AGENT_SESSION') == '1' or _cmd_in_canonical_tree():
    _GIT = r'git\b(?:\s+-C\s+\S+|\s+-c\s+\S+|\s+--git-dir\S*|\s+--work-tree\S*)*\s+'
    _git_deny = (
        'shared-tree guard: `{op}` would discard EVERY concurrent agent\'s '
        'UNCOMMITTED work on the shared staging checkout — edits sit unstaged '
        'until the next git-sync tick, so the loss is UNRECOVERABLE (no git blob; '
        'kopia backs up workspace-state, not code). This wiped a tested in-flight '
        'fix on 2026-06-21. To discard only YOUR change to ONE file, re-edit it by '
        'hand or run `git checkout -- <that.one.file>` with an EXPLICIT path — '
        'never a pathspec-less reset/checkout/clean/stash. If you wanted a clean '
        "tree, you don't need one: stop editing and let git-sync commit."
    )
    # Peel leading command WRAPPERS so a wrapped destructive op can't bypass the
    # guard — PROVEN 2026-07-06: the guard denied `git reset --hard` but ALLOWED
    # `rtk git reset --hard` (rtk = the token-killer output filter, which rewrites
    # `git …`→`rtk git …`). `time`/`env`/`nice`/`command`/`nohup`/`sudo` were the
    # same latent class. Bounded loop peels nested wrappers (`time rtk git …`).
    _WRAP_STRIP = re.compile(
        r'^\s*(?:'
        r'sudo(?:\s+(?:-[ugpUrCht]\s+\S+|-[A-Za-z]+|--[\w-]+(?:=\S*)?))*'
        r'|env(?:\s+[A-Za-z_]\w*=\S*)*'
        r'|nice(?:\s+-n\s*-?\d+)?'
        r'|ionice(?:\s+-\w+(?:\s+\d+)?)*'
        r'|xargs(?:\s+-\w+)*'
        r'|rtk|time|command|nohup|exec|setsid|nocorrect|stdbuf|doas|nocache'
        r')\s+'
    )

    def _unwrap(_x):
        for _ in range(8):
            _y = _WRAP_STRIP.sub('', _x, count=1)
            if _y == _x:
                return _x
            _x = _y
        return _x

    for _seg in re.split(r'[;&|\n]', command):
        _s = _unwrap(_seg.strip())
        if re.match(_GIT + r'reset\b.*--hard\b', _s):
            deny(_git_deny.format(op='git reset --hard'))
        if re.match(_GIT + r'clean\b.*-\w*f', _s):
            deny(_git_deny.format(op='git clean -f'))
        if re.match(_GIT + r'(?:checkout|restore)\b.*\s(?:\.|:/)(?:\s|$)', _s):
            deny(_git_deny.format(op='git checkout/restore .'))
        if re.match(_GIT + r'stash\b(?!\s+(?:pop|apply|list|show|drop|branch|clear))', _s) and ' -- ' not in _s:
            deny(_git_deny.format(op='git stash'))

# ── Heavy-command admission control (WI-3821) ──────────────────────────────
# Fleet size now organically oversubscribes the 128-core box: each agent's
# vitest/tsc/test:affected is ALREADY per-suite worker-capped (affected-tests.mjs
# caps at 32) and runs its workspaces sequentially, so ONE run is fine — but N
# agents run their own simultaneously with zero cross-process coordination, and
# ~6 concurrent capped runs = ~185 workers = the load-245→3077 meltdowns seen
# twice this week. This hook is the only place that transparently sees EVERY raw
# agent heavy command, but it can only allow/deny (it exits before the command
# runs, so it cannot hold a slot) — so it DENIES a *new* heavy run when host
# load is already past the pathological threshold, pointing the caller at
# scripts/pc-heavy.sh (a flock counting-semaphore that WAITS for a free slot
# instead of failing) or a retry once load drops. The green-checkpoint gate and
# capability:inspect run server-side / as MCP tools and never reach this bash
# hook, so they are exempt by construction; only raw, uncoordinated agent shell
# runs get staggered.
#
# Safe-by-default & FAIL-OPEN: this hook lands fleet-wide via git-sync with no
# review, so a fail-closed bug would wedge every agent's bash. The threshold is
# 1.5x cores (catches the 1.9x=245 onset; never trips healthy 1.0-1.3x load);
# kill-switch PC_HEAVY_ADMISSION=off; skipped when PC_HEAVY_BYPASS=1 (pc-heavy
# sets it) or the caller is not an agent/shared-tree session (owner exempt);
# every error path allows. PC_HEAVY_LOAD1_OVERRIDE lets tests inject a load.
def _heavy_admission():
    if os.environ.get('PC_HEAVY_ADMISSION', 'on').strip().lower() in ('off', '0', 'false', 'no'):
        return
    if os.environ.get('PC_HEAVY_BYPASS') == '1':
        return
    # In-band bypasses (EI-9634): this hook decides BEFORE the wrapped command
    # runs, so neither the blessed wrapper's PC_HEAVY_BYPASS export nor a child
    # shell's inline `PC_HEAVY_BYPASS=1 …` assignment is in THIS process's env
    # yet — so both remedies the deny message itself recommends were themselves
    # denied under the exact high load they exist for. Read them from the
    # command TEXT instead (both are command-position, re.match-anchored):
    #   (a) a leading `scripts/pc-heavy.sh …` invocation — it runs its OWN flock
    #       counting-semaphore admission and exports PC_HEAVY_BYPASS=1 to its
    #       child, so gating it double-denies the wrapper for the check it
    #       already satisfies.
    #
    # EI-10001: this used to `re.match` the RAW `_lead` only — so the deny
    # message's own suggested remedy ("run it under `scripts/pc-heavy.sh --
    # <your command>`") silently didn't work the moment pc-heavy.sh wasn't the
    # literal first token: the everyday `cd <dir> && scripts/pc-heavy.sh --
    # <cmd>` (very common right after a prior command left you elsewhere) or a
    # `(… ) &` subshell wrapper around the invocation both got denied AGAIN
    # with the exact same message — reads as "the remedy doesn't work." Peel a
    # BOUNDED set of genuinely benign leading wrappers first (each one runs no
    # command of its own, so this can never let a REAL heavy command hiding
    # earlier in the string slip past ungated — `npm run build && scripts/
    # pc-heavy.sh -- true` still stops peeling at `npm`, which isn't one of
    # these, so it still hits the heavy_re check below as before).
    _lead = command.lstrip()
    _pc_lead = _lead
    for _ in range(8):
        _next = re.sub(
            r'^(?:'
            r'cd\s+([\'"]?)[^&|;<>\s\'"]+\1\s*(?:&&|;)\s*'  # cd <dir> && / ;
            # `set -o pipefail && …` / `set -euo pipefail; …`. A `set` builtin only
            # flips shell options — it runs NO command — so peeling it can't hide a
            # heavy command, and NOT peeling it made this gate deny the very remedy its
            # own error message prescribes: `cd d && set -o pipefail && scripts/
            # pc-heavy.sh -- vitest` stopped peeling at `set`, missed the pc-heavy lead,
            # and got denied as a raw `vitest`. Same "the remedy doesn't work" trap
            # EI-9634 fixed for `cd`/subshell — and it punished exactly the right habit,
            # since pipefail is what stops `… | tail` from masking a real exit code.
            r'|set\s+(?:-o\s+[\w-]+|\+o\s+[\w-]+|[-+][A-Za-z]+)(?:\s+(?:-o\s+[\w-]+|\+o\s+[\w-]+|[-+][A-Za-z]+))*\s*(?:&&|;)\s*'
            r'|\(\s*'  # one subshell open: ( scripts/pc-heavy.sh … ) &
            r'|sudo(?:\s+(?:-[ugpUrCht]\s+\S+|-[A-Za-z]+|--[\w-]+(?:=\S*)?))*\s+'
            r'|env(?:\s+[A-Za-z_]\w*=\S*)*\s+'
            r'|nice(?:\s+-n\s*-?\d+)?\s+'
            r'|ionice(?:\s+-\w+(?:\s+\d+)?)*\s+'
            r'|rtk\s+|time\s+'
            r'|timeout(?:\s+(?:-[a-zA-Z]\S*|--[\w-]+(?:=\S*)?))*\s+-?\d+\S*\s+'
            r')',
            '', _pc_lead, count=1)
        if _next == _pc_lead:
            break
        _pc_lead = _next
    if re.match(r'(?:bash\s+|sh\s+)?(?:\S*/)?pc-heavy\.sh(?:\s|$)', _pc_lead):
        return
    #   (b) a leading `PC_HEAVY_BYPASS=1` env-assignment prefix (bare, behind
    #       other assignments, or behind `env`) — mirrors the message's own
    #       `PC_HEAVY_BYPASS=1 <cmd>` remedy and the `env`-prefixed heavy form
    #       the anchor already recognizes. Same `cd <dir> &&` allowance as (a).
    _bypass_lead = re.sub(
        r'^cd\s+([\'"]?)[^&|;<>\s\'"]+\1\s*(?:&&|;)\s*', '', _lead, count=1)
    if re.match(r'(?:env\s+)?(?:[A-Za-z_]\w*=\S*\s+)*PC_HEAVY_BYPASS=1(?:\s|$)', _bypass_lead):
        return
    #   (c) a leading `PC_HEAVY_ADMISSION=off` env-assignment prefix (EI-10913):
    #       the deny message advertises `PC_HEAVY_ADMISSION=off` as the
    #       kill-switch, but the env read at the TOP of this function only sees
    #       it when it is ALREADY in this process's env — which an agent cannot
    #       set from a Bash call (the assignment applies to the CHILD, not to
    #       this hook). So the guard's own documented escape hatch was itself
    #       denied under the exact high load it exists for — the "guard blocks
    #       its own remedy" bug. Read it in-band from the command text too,
    #       accepting the same off-values the env read does (off/0/false/no,
    #       value case-insensitive; the env-var NAME stays literal since a shell
    #       assignment is case-sensitive). Same `cd <dir> &&` and leading-
    #       assignment/`env` allowance as the PC_HEAVY_BYPASS check above.
    if re.match(r'(?:env\s+)?(?:[A-Za-z_]\w*=\S*\s+)*PC_HEAVY_ADMISSION=(?i:off|0|false|no)(?:\s|$)',
                _bypass_lead):
        return
    # Only throttle agent / shared-tree sessions — never the owner's own box
    # work. Mirror the git-guard's marker-OR-tree gate so marker-less fleet
    # sessions (EI-7872) are still covered.
    if not (os.environ.get('PAPERCUSP_AGENT_SESSION') == '1' or _cmd_in_canonical_tree()):
        return
    # Heavy = the batch test/build commands that spawn worker pools. Anchored at
    # command position (start / after ;&|newline / a known wrapper / a path/) so
    # a prose arg, a config filename, or a docs path never false-positives; the
    # executable must be followed by whitespace or end so `vitest.config`,
    # `vitest-guide`, `testing` etc. don't match. Bare `tsx` is intentionally
    # NOT heavy (it runs light one-shot scripts far more often than builds).
    anchor = (r'(?:^|[;&|\n]\s*|\bsudo\s+|\bnice\s+(?:-n\s*-?\d+\s+)?'
              r'|\bionice\s+(?:-\S+\s*)*|\benv\s+(?:\S+=\S*\s+)+|\brtk\s+|\btime\s+|\S*/)')
    heavy_re = re.compile(
        anchor + r'(?:'
        r'(?:npx\s+|pnpm\s+|bunx\s+)?vitest(?=\s|$)'
        r'|(?:npx\s+)?tsc(?=\s|$)'
        r'|npm\s+(?:run\s+)?test(?::[\w-]+)?(?=\s|$)'
        r'|npm\s+run\s+build(?=\s|$)'
        r'|turbo\s+run\s+(?:test|build|typecheck)\b'
        r')',
        re.IGNORECASE,
    )
    # Use the same peeled command used for the pc-heavy bypass check so benign
    # wrappers such as `timeout 90` cannot hide a raw heavy command from the
    # admission gate while still allowing the blessed wrapper above through.
    if not heavy_re.search(_pc_lead):
        return
    # Local load signal — captures ALL contributors (vitest+tsc+onnx+…), more
    # robust than counting only wrapped runs. Env overrides for tests.
    try:
        _ov = os.environ.get('PC_HEAVY_LOAD1_OVERRIDE')
        load1 = float(_ov) if _ov not in (None, '') else os.getloadavg()[0]
        cores = os.cpu_count() or 1
        _mx = os.environ.get('PC_HEAVY_MAX_LOAD1')
        max_load1 = float(_mx) if _mx not in (None, '') else round(1.5 * cores)
    except Exception:
        return  # can't read load/cores → fail-open
    if load1 > max_load1:
        deny(
            f'heavy-command admission (WI-3821): host load1={load1:.0f} is over the '
            f'{max_load1:.0f} threshold (~1.5x cores) — starting another vitest/tsc/'
            f'test build now would pile onto an already-saturated box (this class '
            f'melted the host to load 3000+ twice this week). Either wait ~30-60s and '
            f're-run once load drops, or run it under `scripts/pc-heavy.sh -- <your '
            f'command>`, which waits for a free build slot (flock counting semaphore) '
            f'and runs niced instead of failing. Kill-switch (prepend inline): '
            f'`PC_HEAVY_ADMISSION=off <your command>`.'
        )

try:
    _heavy_admission()
except Exception:
    pass  # admission control must never wedge a command

# Cheap local pre-filter — skip the HTTP round-trip for the 99% of commands
# that can't touch a registered resource. Tokens mirror the seeded patterns.
if not re.search(r'systemctl|overmind|psql|astro|build-desktop-sidecar|release-local|npm\s+run\s+(dev|build)', command):
    allow()

# Per-session owner (so the caller's OWN exclusive doesn't gate their own
# commands) — same precedence the file-lock hook uses.
env_sid = os.environ.get('PAPERCUSP_SID')
session_id = payload.get('session_id')
owner = (
    env_sid if isinstance(env_sid, str) and env_sid
    else session_id if isinstance(session_id, str) and session_id
    else agent_id
)

body = json.dumps({
    'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
    'params': {'name': 'locks:check_command', 'arguments': {'command': command}},
}).encode()

req = urllib.request.Request(
    operator_url.rstrip('/') + '/api/mcp?superuser=1&client='
    + urllib.parse.quote(owner, safe=''),
    data=body,
    headers={
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    },
    method='POST',
)
try:
    resp = urllib.request.urlopen(req, timeout=4)
    raw_resp = resp.read().decode('utf-8', errors='replace')
except Exception as e:
    print(f'[resource-gate] operator unreachable ({e}); allowing (fail-open)', file=sys.stderr)
    allow()

result = None
for line in raw_resp.splitlines():
    line = line.strip()
    if not line or line.startswith('event:'):
        continue
    if line.startswith('data:'):
        line = line[5:].strip()
    try:
        cand = json.loads(line)
        if isinstance(cand, dict) and 'result' in cand:
            result = cand['result']
            break
    except Exception:
        pass
if not result:
    allow()

inner = None
for item in (result.get('content') or []):
    if item.get('type') == 'text':
        try:
            inner = json.loads(item['text'])
            break
        except Exception:
            continue
if not inner or inner.get('decision') != 'block':
    allow()

matched = inner.get('matched') or []
names = ', '.join(m.get('resource', '?') for m in matched) or 'a registered resource'
deny(
    f"resource-gate: this command touches {names}, which has an exclusive hold "
    f"in flight (a peer is restarting/migrating it). Wait for the 'back up' "
    f"broadcast, or coordinate via locks:list / locks:acquire_resource. "
    f"Use the blessed wrapper (dev:restart / db:migrate) instead of a raw command."
)
PYEOF
