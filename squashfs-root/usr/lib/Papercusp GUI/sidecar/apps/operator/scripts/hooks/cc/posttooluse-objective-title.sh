#!/usr/bin/env bash
# PostToolUse hook — the Codex STATUS-DISPLAY pipe: terminal TITLE + 💡 tip notice
# (session-objective-display-2026-06-22 P-003/P-004; WI-1963 full title parity;
# SINGLE-SOURCE rework tui-status-parity-single-source-2026-07-05). Codex has no
# bottom status pane (that's a Claude-Code-only TUI feature), but it DOES own a
# tty and consumes PostToolUse `additionalContext` — so this hook surfaces the
# fleet status through BOTH:
#
#   1. TITLE — an OSC-0 escape (ESC ] 0 ; <title> BEL) carrying the glance's
#      server-rendered `display.title` VERBATIM (status-display.ts — the ONE
#      render every TUI shows: fleets 👑/👤 + colour squares · ⟳loop · ▶/⏸✉staged ·
#      ☕bees · ⏳governor · peers · id · 🔭objective). New chips belong in
#      status-display.ts, NOT here; the embedded `term_title` assembly below is
#      only the fallback for a pre-display operator.
#   2. 💡 NOTICE — the glance's `display.notice` (the top contextual tip, e.g.
#      "Wake mode is manual — 4 staged wakes waiting"), injected as PostToolUse
#      additionalContext when it CHANGES (a per-session cursor file dedups), so a
#      codex session gets the same tips the Claude statusline shows. Disable with
#      PAPERCUSP_TIP_NOTICE=0.
#
# The title escape goes to the TTY directly (/dev/tty), NOT stdout — hook stdout
# is reserved for the additionalContext JSON (the harness consumes it; a title
# written there would corrupt the tool result).
#
# SYNC + FAIL-OPEN: one short coord:glance read per tool call (the notice must
# reach stdout before the hook exits — same latency contract as
# posttooluse-coord-inbox.sh, ~10-30ms localhost, 1.5s worst-case timeout); on
# any trouble (operator down/slow, no tty) it emits nothing and exits 0.
# PAPERCUSP_OBJECTIVE_SYNC is kept as an accepted env for back-compat (the hook
# is now always synchronous).
#
# Scope guard: runs ONLY in a psu session (PAPERCUSP_SID set + su-token present),
# exactly like the coord-inbox / activity hooks; a plain codex/omp elsewhere has
# no PAPERCUSP_SID and bails instantly.

set -euo pipefail

OPERATOR_URL="${PAPERCUSP_OPERATOR_URL:-http://localhost:3070}"
TOKEN_PATH="${HOME}/.papercusp/superuser-token"

# psu-session + install gate (mirror posttooluse-activity-report.sh). In test mode
# a glance-shaped payload in $PAPERCUSP_OBJECTIVE_FIXTURE drives the render with no
# operator/token.
if [ -z "${PAPERCUSP_OBJECTIVE_FIXTURE:-}" ]; then
  if [ -z "${PAPERCUSP_SID:-}" ] || [ ! -s "$TOKEN_PATH" ]; then
    exit 0
  fi
  TOKEN=$(cat "$TOKEN_PATH")
else
  TOKEN=""
fi

# Drain stdin (the PostToolUse event JSON) so the pipe closes cleanly; we key off
# the env + coord:glance, not the tool payload.
INPUT="$(cat 2>/dev/null || true)"

# Where the title escape goes. The client owns the tty; default to /dev/tty (the
# controlling terminal of the codex/omp process tree). Overridable for tests.
TITLE_TTY="${PAPERCUSP_OBJECTIVE_TTY:-/dev/tty}"

# Read coord:glance self.objective and (when present + non-blank) write the OSC-0
# title escape DIRECTLY to the tty from python — the title IO lives in python (the
# activity-hook pattern), NOT in a fragile `$(...)`-around-heredoc command
# substitution. Kept in a function so the SYNC + DETACHED paths share one body; the
# `|| true` at the call sites keeps any crash fail-open.
set_title() {
  python3 - "$OPERATOR_URL" "$TOKEN" "${PAPERCUSP_SID:-fixture}" "${PAPERCUSP_OBJECTIVE_FIXTURE:-}" "$TITLE_TTY" "${PAPERCUSP_MODEL:-}" "$(dirname "$0")" <<'PYEOF'
import json, os, re, sys, urllib.request, urllib.parse
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))  # localhost operator: never via egress http(s)_proxy (502s the local call -> false fail-open)

operator_url, token, me, fixture, title_tty = sys.argv[1:6]
model_spec = sys.argv[6] if len(sys.argv) > 6 else ''  # PAPERCUSP_MODEL launch spec — codex/omp have no live model object
# Shared tty resolution (WI-3665) — see pc_tty.py. Sits beside this script in both the
# repo and the installed runtime dir, so $0's dirname resolves it either way.
sys.path.insert(0, sys.argv[7] if len(sys.argv) > 7 else os.path.dirname(os.path.abspath(__file__)))
from pc_tty import write_osc_title  # noqa: E402  (path must be primed first)
HTTP_TIMEOUT = 1.5


def call_glance():
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                       'params': {'name': 'coord:glance',
                                  'arguments': {'audience': 'user', 'activity_limit': 0}}}).encode()
    # `format=json` is REQUIRED (result-format negotiation, P-009). Without it the operator
    # answers in TOON ("format: toon\nok: true\n…"), json.loads() below throws, call_glance
    # returns None, and the title silently degrades to the bare session id — no fleet, no 👑.
    # That is EI-7029, fixed in statusline-fleet.sh but never here: this hook rendered a
    # crownless title on codex/omp from the day TOON became the default (WI-3665). The
    # fixture-driven parity test never caught it because fixtures bypass the network.
    req = urllib.request.Request(
        operator_url.rstrip('/') + '/api/mcp?superuser=1&format=json&client=' + urllib.parse.quote(me, safe=''),
        data=body,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                 'Accept': 'application/json, text/event-stream'},
        method='POST')
    raw = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT).read().decode('utf-8', 'replace')
    result = None
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith('data:'):
            line = line[5:].strip()
        if not line:
            continue
        try:
            cand = json.loads(line)
            if isinstance(cand, dict) and 'result' in cand:
                result = cand['result']
                break
        except Exception:
            pass
    if not result or result.get('isError'):
        return None
    for item in (result.get('content') or []):
        if item.get('type') == 'text':
            try:
                return json.loads(item['text'])
            except Exception:
                pass
    return None


# ── Title assembly — kept BYTE-IDENTICAL to statusline-fleet.sh's term_title so a codex/omp
#    title and a Claude title render the SAME for the same glance + model (WI-1963 full title
#    parity). Guarded by objective-title-parity.test.ts (a drift there fails CI). The Claude
#    side sources the model from its LIVE stdin object; this side from the launch spec env —
#    but the RENDER (term_title) is one shared shape. ──
def self_short(owner):
    owner = str(owner or '').strip()
    if not owner or owner == 'fixture':
        return ''
    bits = owner.split('-')
    if len(bits) >= 2 and bits[1]:
        return f'{bits[0]}-{bits[1][:5]}'
    return owner[:8]


def fmt_interval(sec):
    try:
        s = int(sec)
    except Exception:
        return '?'
    if s < 60:
        return f'{s}s'
    m = s // 60
    if m < 60:
        return f'{m}m'
    h, rm = m // 60, m % 60
    return f'{h}h' if rm == 0 else f'{h}h{rm}m'


def fleets_part(g):
    if not isinstance(g, dict):
        return ''
    fleets = (g.get('self') or {}).get('fleets')
    if not isinstance(fleets, list) or not fleets:
        return ''
    chips = []
    for f in fleets[:4]:
        if not isinstance(f, dict):
            continue
        label = str(f.get('label') or f.get('slug') or '').strip()
        if not label:
            continue
        if len(label) > 16:
            label = label[:15] + '…'
        glyph = '👑' if f.get('role') == 'leader' else '👤'
        square = str(f.get('square') or '').strip()
        chips.append(f'{glyph} {label}{(" " + square) if square else ""}')
    if not chips:
        return ''
    seg = ' · '.join(chips)
    more = len(fleets) - len(chips)
    if more > 0:
        seg += f' +{more}'
    return seg


def _compact_model(*names):
    onem = False
    fam = ''
    for n in names:
        s = str(n or '').lower()
        if not s:
            continue
        if '1m' in s:
            onem = True
        if not fam:
            for f in ('opus', 'sonnet', 'haiku', 'fable'):
                if f in s:
                    fam = f
                    break
    if not fam:
        for n in names:
            s = str(n or '').strip()
            if s:
                fam = s.split()[0].split('-')[0].lower()
                break
    return (fam + ('[1m]' if onem else '')) if fam else ''


def model_title(label, effort):
    return '/'.join(x for x in (label, effort) if x)


def model_tag_from_spec(spec):
    """Compact model tag ('opus[1m]/xhigh') from the psu --model SPEC (e.g. 'opus[1m]:xhigh').
    Mirrors the Claude statusline's model_title(_compact_model(display_name/id), effort) so both
    CLIs render the SAME tag — the Claude side sources the model from its live stdin object, the
    codex/omp side from the launch spec env, but the model RENDER is identical."""
    s = str(spec or '').strip()
    if not s:
        return ''
    c = s.rfind(':')
    effort = ''
    base = s
    if c > 0 and s[c + 1:] in ('low', 'medium', 'high', 'xhigh', 'max'):
        effort = s[c + 1:]
        base = s[:c]
    return model_title(_compact_model(base), effort)


def term_title(g, model_tag=''):
    me_id = self_short(me)
    bits = []
    fl = fleets_part(g)
    if fl:
        bits.append(fl)
    lp = (g.get('self') or {}).get('loop') if isinstance(g, dict) else None
    if isinstance(lp, dict) and lp.get('active'):
        tag = f'⟳{fmt_interval(lp.get("intervalSec"))}'
        if lp.get('reachable') is False:
            tag += '!'
        bits.append(tag)
    if model_tag:
        bits.append(model_tag)
    if me_id:
        bits.append(me_id)
    obj = (g.get('self') or {}).get('objective') if isinstance(g, dict) else None
    if isinstance(obj, str) and obj.strip():
        o = obj.strip()
        bits.append(o[:40] + ('…' if len(o) > 40 else ''))
    return ' · '.join(bits)


def emit_notice(disp):
    """💡 tip-notice injection (tui-status-parity-single-source-2026-07-05 P-003, codex leg):
    when the glance's server-rendered display.notice CHANGES (id+text vs a per-session
    cursor file), print the PostToolUse additionalContext JSON so the harness injects it —
    the codex equivalent of the Claude statusline's 💡 line. First run SHOWS a standing
    notice once (a manual wake gate is worth one surfacing at session start), then the
    cursor dedups. Fail-open: any trouble ⇒ no output. PAPERCUSP_TIP_NOTICE=0 disables."""
    if os.environ.get('PAPERCUSP_TIP_NOTICE', '1') == '0':
        return
    notice = disp.get('notice') if isinstance(disp, dict) else None
    if not isinstance(notice, dict):
        return
    text = str(notice.get('text') or '').strip()
    if not text:
        return
    key = f'{notice.get("id") or "tip"}|{text}'
    cache_dir = os.environ.get('PAPERCUSP_LOCKS_CACHE_DIR') or os.path.join(
        os.path.expanduser('~'), '.papercusp', 'locks-cache')
    safe_owner = re.sub(r'[^A-Za-z0-9._-]', '_', me)[:80]
    cursor_path = os.path.join(cache_dir, f'tip-notice-{safe_owner}.json')
    try:
        with open(cursor_path) as f:
            if (json.load(f) or {}).get('key') == key:
                return  # unchanged — already surfaced
    except Exception:
        pass  # no cursor yet — first surfacing
    try:
        os.makedirs(cache_dir, mode=0o700, exist_ok=True)
        tmp = f'{cursor_path}.{os.getpid()}.tmp'
        with open(tmp, 'w') as f:
            json.dump({'key': key}, f)
        os.replace(tmp, cursor_path)
    except Exception:
        pass  # cursor write failed — worst case the notice repeats; still emit
    print(json.dumps({
        'hookSpecificOutput': {
            'hookEventName': 'PostToolUse',
            'additionalContext': (
                '<system-reminder type="papercusp-status-tip">'
                + text
                + ' (fleet status tip — act on it or surface it to the user; coord:glance for detail)'
                + '</system-reminder>'
            ),
        },
    }))


try:
    glance = None
    try:
        if fixture:
            with open(fixture) as f:
                glance = json.load(f)
        else:
            glance = call_glance()
    except Exception:
        glance = None

    # SINGLE-SOURCE title (tui-status-parity-single-source-2026-07-05): pipe the
    # server-rendered display.title VERBATIM when the operator ships it — the ONE
    # render every TUI shows. The embedded term_title assembly survives ONLY as
    # the fallback for a pre-display operator (WI-1963 parity era); new chips go
    # in status-display.ts, not here. Model display REMOVED 2026-07-03 (owner
    # directive, WI-2124): better none than a possibly-stale model.
    disp = glance.get('display') if isinstance(glance, dict) else None
    dtitle = disp.get('title') if isinstance(disp, dict) else None
    if isinstance(dtitle, str) and dtitle.strip():
        title = dtitle.strip()
    else:
        title = term_title(glance)
    # Shared write (WI-3665): PAPERCUSP_OBJECTIVE_TTY (this hook's test seam) →
    # PAPERCUSP_TTY (the owning terminal, survives a setsid'd spawn) → /dev/tty (the
    # controlling terminal, which Codex's child hooks still have). Control chars are
    # stripped inside. A piped/headless session matches nothing → fail open, no title.
    write_osc_title(title, extra_first=('PAPERCUSP_OBJECTIVE_TTY',))
    # 💡 tip notice — stdout is reserved for this additionalContext JSON.
    emit_notice(disp)
except Exception:
    sys.exit(0)
PYEOF
}

# ALWAYS synchronous with stdout passed through: stdout carries the tip-notice
# additionalContext JSON the harness consumes (a detached/redirected run would
# silently drop it — the pre-2026-07-05 behavior). stderr stays silenced; any
# failure exits 0 (fail-open, never blocks the tool stream).
set_title 2>/dev/null || true
exit 0
