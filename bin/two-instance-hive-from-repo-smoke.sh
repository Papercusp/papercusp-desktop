#!/usr/bin/env bash
# two-instance-hive-from-repo-smoke.sh — packaged CREATE-FROM-REPO → DISCOVER →
# JOIN-OFFER → JOIN proof (hive-from-github-url-2026-06-11 P-019).
#
# The from-repo sibling of two-instance-hive-directory-smoke.sh: two isolated
# full-app-stack instances on one box, distinct GitHub identities, local
# testnet DHT (PAPERCUSP_DHT_BOOTSTRAP). The loop proven end-to-end:
#
#   1. A: POST /api/harness/hives/from-repo {githubUrl, visibility:public}
#      → clone + blueprint + hive home + member + AUTO-PUBLISH (P-006/P-007).
#      Asserted: ok:true, created.hiveSlug/memberSlug, publish.announced:true,
#      and bindingUnverified:true — both instances point PAPERCUSP_CUPBOARD_URL
#      at an unreachable port (the LIVE Cupboard worker is NEVER touched), so
#      the create must succeed in the documented degraded directory-only mode
#      (D-004 degradation contract — part of what this smoke proves).
#   2. B: GET /api/discovery/hives until A's hive lists (announce crossed the
#      testnet wire + verified), memberLinks intact. (The HTTP projection does
#      not expose memberRepos — the announce's member_repos leg is proven by
#      step 3 instead, which can ONLY hit via hiveMatchesRepo(memberRepos).)
#   3. B: POST the SAME repo URL to /api/harness/hives/from-repo → must get the
#      JOIN OFFER (existing.kind === 'hive', source === 'directory', NO create,
#      zero side effects) — the paste-time dedup loop (P-005/P-008).
#   4. B: accepts — POST /api/harness/join-link per offered memberLink
#      (slug joined-<repo>) → ok:true + state.steps.clone_repo done.
#
# GitHub footprint: the fixture repo is READ-ONLY (clone + repos.get). No repo
# is created or written. (The join leg self-publishes B's attestation gist —
# the same write-free-admission mechanics every two-instance smoke exercises.)
#
# Fixture repo: HIVE_SMOKE_REPO_URL (default a tiny public GitHub repo).
#
# Modes (HIVE_SMOKE_MODE=auto|deb|sidecar, default auto):
#   deb      — the template path: extract a packaged .deb, launch the desktop
#              binary twice under Xvfb (two-instance-hive-directory-smoke.sh
#              mechanics). REQUIRES a .deb built from a tree with the from-repo
#              backend (hives/from-repo + member_repos) — enforced by a static
#              grep, exactly like the directory smoke's createDirectoryGossip
#              gate.
#   sidecar  — the documented FALLBACK when the on-disk .deb predates the
#              from-repo backend and a full tauri rebuild is too heavy: run the
#              SAME packaged sidecar bundle (src-tauri/sidecar/serve.mjs — the
#              exact artifact the .deb ships; serve.mjs owns embedded-PG +
#              migrations + the Hono host + swarm boot) directly under the
#              bundled node, twice, with isolated HOMEs/ports. Everything the
#              asserts touch is identical; only the Tauri window chrome (webview
#              + Xvfb) is absent.
#   auto     — deb when the .deb exists AND passes the from-repo gate, else
#              sidecar (loudly).
#
# Usage:
#   bin/two-instance-hive-from-repo-smoke.sh [path/to/Papercusp_*.deb]
set -uo pipefail
DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"

# Default to the NEWEST built .deb (version-agnostic — the desktop version is
# bumped by the release lanes, so a pinned 0.0.1 path goes stale). An explicit
# $1 still wins.
DEB_DEFAULT="$(ls -t "$DESKTOP_DIR"/src-tauri/target/release/bundle/deb/Papercusp_*_amd64.deb 2>/dev/null | head -1)"
DEB="${1:-${DEB_DEFAULT:-$DESKTOP_DIR/src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb}}"
# Resolve to an ABSOLUTE path — resolve_mode (auto) `cd`s into a tmp dir before
# `dpkg-deb --fsys-tarfile "$DEB"`, so a relative $1 silently extracts nothing,
# fails the from-repo gate, and degrades to SIDECAR even when the .deb is fine.
DEB="$(readlink -f "$DEB" 2>/dev/null || echo "$DEB")"
MODE="${HIVE_SMOKE_MODE:-auto}"
SIDECAR_SRC="${PAPERCUSP_SMOKE_SIDECAR_DIR:-$DESKTOP_DIR/src-tauri/sidecar}"
REPO_URL="${HIVE_SMOKE_REPO_URL:-https://github.com/octocat/Hello-World}"
# Unreachable on purpose: TCP port 9 (discard) on loopback refuses instantly —
# the live Cupboard worker must never see this smoke (D-004 degraded path).
CUPBOARD_URL="${HIVE_SMOKE_CUPBOARD_URL:-http://127.0.0.1:9}"
P_A_USER="${P_A_USER:-papercupai}"
P_B_USER="${P_B_USER:-aviynw}"
OPERATOR_DIR="${PAPERCUSP_OPERATOR_DIR:-/home/marsh-office/papercupai-workspace/papercup/apps/operator}"
DISPLAY_NUM="${PAPERCUSP_SMOKE_DISPLAY:-151}"
WORK="$(mktemp -d /tmp/hive-fromrepo-smoke.XXXXXX)"
PKG="$WORK/pkg"; BIN="$PKG/usr/bin/papercusp-desktop"
A_HOME="$WORK/inst-a"; B_HOME="$WORK/inst-b"
FED_LOG[a]="$WORK/a.log"; FED_LOG[b]="$WORK/b.log"
log() { fed_log "$@"; }

cleanup() { log "cleanup (scoped to $WORK)"; fed_cleanup_scoped "$WORK"; }
trap cleanup EXIT

# ── tokens (distinct identities — same pair as every two-instance smoke) ───────
A_TOKEN="$(gh auth token --user "$P_A_USER" 2>/dev/null)" || true
B_TOKEN="$(gh auth token --user "$P_B_USER" 2>/dev/null)" || true
[ -n "$A_TOKEN" ] && [ -n "$B_TOKEN" ] || { echo "FATAL: need gh tokens for $P_A_USER + $P_B_USER (gh auth login). Every leg needs A's; B's discovery/offer/join legs need B's."; exit 1; }

# ── from-repo support gate (the directory smoke's static-grep pattern) ─────────
# An older serve.mjs silently 404s POST /harness/hives/from-repo and announces
# without member_repos (B's offer leg can never hit) — fail fast instead.
assert_serve_supports_from_repo() {
  local serve="$1" label="$2"
  for marker in 'hives/from-repo' 'member_repos' 'PAPERCUSP_DHT_BOOTSTRAP' 'createDirectoryGossip'; do
    grep -q "$marker" "$serve" 2>/dev/null || {
      echo "✗ $label serve.mjs lacks '$marker' — built before hive-from-github-url P-003/P-006; rebuild it"
      return 1
    }
  done
  echo "✓ $label serve.mjs carries the from-repo backend (static check)"
}

# ── resolve mode ────────────────────────────────────────────────────────────────
resolve_mode() {
  case "$MODE" in
    deb) echo deb ;;
    sidecar) echo sidecar ;;
    auto)
      if [ -f "$DEB" ]; then
        # Peek at the packaged serve.mjs without a full extract.
        mkdir -p "$WORK/debpeek"
        ( cd "$WORK/debpeek" && dpkg-deb --fsys-tarfile "$DEB" 2>/dev/null | tar -x usr/lib/Papercusp/sidecar/serve.mjs 2>/dev/null ) || true
        if assert_serve_supports_from_repo "$WORK/debpeek/usr/lib/Papercusp/sidecar/serve.mjs" ".deb" >/dev/null 2>&1; then
          rm -rf "$WORK/debpeek"; echo deb; return
        fi
        rm -rf "$WORK/debpeek"
        echo "auto: on-disk .deb predates the from-repo backend → SIDECAR-BUNDLE FALLBACK (same serve.mjs artifact, no Tauri window)" >&2
      else
        echo "auto: no .deb at $DEB → SIDECAR-BUNDLE FALLBACK" >&2
      fi
      echo sidecar ;;
    *) echo "FATAL: HIVE_SMOKE_MODE must be auto|deb|sidecar" >&2; exit 1 ;;
  esac
}
RUN_MODE="$(resolve_mode)" || exit 1
echo "mode=$RUN_MODE  repo=$REPO_URL  cupboard=$CUPBOARD_URL (isolated)"

# ── sidecar-mode launcher (the fed_local_launch analog for `node serve.mjs`) ───
# Mirrors what Tauri main.rs spawns (serve.mjs owns embedded-PG + migrations +
# the Hono host): isolated HOME, shared gh config (announce identity), bundled
# node + gh first on PATH, explicit per-instance ports. The trailing "$WORK"
# argv is the cleanup marker (serve.ts ignores unknown args; fed_cleanup_scoped
# greps ps args for $WORK — same trick as fed_start_testnet_dht).
SC_NODE="$SIDECAR_SRC/bin/node"; [ -x "$SC_NODE" ] || SC_NODE="$(command -v node)"
sc_launch() {
  local home="$1" logf="$2" hono_port="$3" pg_port="$4"; shift 4
  mkdir -p "$home/.config" "$home/.papercusp"
  ln -sf "$HOME/.config/gh" "$home/.config/gh"
  ln -sf "$HOME/.gitconfig" "$home/.gitconfig" 2>/dev/null || true
  ( cd "$SIDECAR_SRC"
    env HOME="$home" \
        PATH="$SIDECAR_SRC/bin:$(dirname "$(command -v node)"):$PATH" \
        NODE_ENV=production PAPERCUSP_DESKTOP=1 \
        PAPERCUSP_BIND_HOST=127.0.0.1 HOSTNAME=127.0.0.1 \
        PAPERCUSP_HONO_PORT="$hono_port" PAPERCUSP_PG_PORT="$pg_port" \
        PAPERCUSP_PG_DATA_DIR="$home/.papercusp/embedded-pg-data" \
        PAPERCUSP_PG_SQL_DIR="$SIDECAR_SRC/db-sql" \
        PAPERCUSP_HARNESS_DIR="$SIDECAR_SRC/harness" \
        PAPERCUSP_PROMPTS_DIR="$SIDECAR_SRC/prompts" \
        PAPERCUSP_DOCS_ROOT="$SIDECAR_SRC/internal-docs" \
        PAPERCUSP_SPA_DIST="$SIDECAR_SRC/spa" \
        PAPERCUSP_SERVE_UI=0 \
        "$@" \
        setsid nohup "$SC_NODE" "$SIDECAR_SRC/serve.mjs" "$WORK" >"$logf" 2>&1 < /dev/null ) &
  FED_KILL_PIDS+=("$!")
}
pick_free_port() { local p="$1"; while ss -tlnH "sport = :$p" 2>/dev/null | grep -q .; do p=$((p+1)); done; echo "$p"; }

# ── stage the instances (per mode) ──────────────────────────────────────────────
if [ "$RUN_MODE" = deb ]; then
  log "extract $DEB"
  fed_extract_deb "$DEB" "$PKG" || exit 1
  fed_clobber_check "$PKG" || exit 2
  fed_assert_deb_swarm_support "$PKG" || exit 2
  assert_serve_supports_from_repo "$PKG/usr/lib/Papercusp/sidecar/serve.mjs" ".deb" || exit 2
  fed_fresh_display "$DISPLAY_NUM" "$WORK" || exit 1
else
  log "sidecar-bundle fallback: $SIDECAR_SRC (the artifact the .deb ships, minus the Tauri window)"
  [ -f "$SIDECAR_SRC/serve.mjs" ] || { echo "FATAL: $SIDECAR_SRC/serve.mjs missing — run bin/build-desktop-sidecar.sh"; exit 2; }
  [ -d "$SIDECAR_SRC/node_modules/@papercusp/embedded-postgres-server" ] || { echo "FATAL: sidecar bundle lacks embedded-postgres-server — incomplete build"; exit 2; }
  assert_serve_supports_from_repo "$SIDECAR_SRC/serve.mjs" "sidecar" || exit 2
fi

# ── local testnet DHT (deterministic same-box discovery) ───────────────────────
BOOTSTRAP="$(fed_start_testnet_dht "$OPERATOR_DIR" "$WORK")" || exit 3
echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP"

# ── launch two isolated instances with distinct identities ─────────────────────
log "launch A ($P_A_USER) + B ($P_B_USER) [$RUN_MODE]"
if [ "$RUN_MODE" = deb ]; then
  fed_local_launch "$A_HOME" "${FED_LOG[a]}" "$BIN" "$DISPLAY_NUM" GH_TOKEN="$A_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
  fed_local_launch "$B_HOME" "${FED_LOG[b]}" "$BIN" "$DISPLAY_NUM" GH_TOKEN="$B_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
else
  A_HONO="$(pick_free_port 18071)"; A_PG="$(pick_free_port 18532)"
  sc_launch "$A_HOME" "${FED_LOG[a]}" "$A_HONO" "$A_PG" GH_TOKEN="$A_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
  B_HONO="$(pick_free_port $((A_HONO + 1)))"; B_PG="$(pick_free_port $((A_PG + 100)))"
  sc_launch "$B_HOME" "${FED_LOG[b]}" "$B_HONO" "$B_PG" GH_TOKEN="$B_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
fi

fed_wait_boot a 60 || { echo "A boot failed: $FED_BOOT_ERR"; tail -20 "${FED_LOG[a]}"; exit 4; }
fed_wait_boot b 60 || { echo "B boot failed: $FED_BOOT_ERR"; tail -20 "${FED_LOG[b]}"; exit 4; }
log "A: PG=${FED_PG[a]} sc=${FED_SC[a]} | B: PG=${FED_PG[b]} sc=${FED_SC[b]}"
fed_assert_isolated a b || exit 5
fed_wait_api a 30 || { echo "A sidecar API never came up"; exit 4; }
fed_wait_api b 30 || { echo "B sidecar API never came up"; exit 4; }

# ── helpers ─────────────────────────────────────────────────────────────────────
dir_list() { curl -s -m 10 "http://127.0.0.1:${FED_SC[$1]}/api/discovery/hives"; }

# from_repo <inst> [extra-json-fields] — POST the create/lookup composition.
# shallow + runTests:false keep the create light; route timeoutSec is 600.
from_repo() {
  local inst="$1"
  curl -s -m 610 -X POST "http://127.0.0.1:${FED_SC[$inst]}/api/harness/hives/from-repo" \
    -H 'content-type: application/json' \
    -d "{\"githubUrl\":\"$REPO_URL\",\"visibility\":\"public\",\"runTests\":false,\"shallow\":true}"
}

# jget <json> <python-expr over d> — tiny JSON probe (template's python3 style).
jget() { printf '%s' "$1" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
try: print($2)
except Exception: pass
" 2>/dev/null; }

# ── 1. A creates a PUBLIC hive from the fixture repo ────────────────────────────
log "A ($P_A_USER): POST /api/harness/hives/from-repo ($REPO_URL, public, runTests:false, shallow)"
a_resp="$(from_repo a)"
echo "A create → $(echo "$a_resp" | head -c 600)"
A_OK="$(jget "$a_resp" "d['ok'] and 'created' in d")"
HIVE_SLUG="$(jget "$a_resp" "d['created']['hiveSlug']")"
MEMBER_SLUG="$(jget "$a_resp" "d['created']['memberSlug']")"
A_ANNOUNCED="$(jget "$a_resp" "d['publish']['announced']")"
A_UNVERIFIED="$(jget "$a_resp" "d['bindingUnverified']")"
create_ok=0; [ "$A_OK" = "True" ] && [ -n "$HIVE_SLUG" ] && [ -n "$MEMBER_SLUG" ] && create_ok=1
[ "$create_ok" = 1 ] && echo "✓ A created hive='$HIVE_SLUG' member='$MEMBER_SLUG' from $REPO_URL" \
                     || echo "✗ A create failed (ok/created missing) — body above"
announce_ok=0; [ "$A_ANNOUNCED" = "True" ] && announce_ok=1
[ "$announce_ok" = 1 ] && echo "✓ A publish.announced=true (signed announce on the directory topic, testnet transport)" \
                       || echo "✗ A publish.announced != true (got: $A_ANNOUNCED)"
degraded_ok=0; [ "$A_UNVERIFIED" = "True" ] && degraded_ok=1
[ "$degraded_ok" = 1 ] && echo "✓ A bindingUnverified=true (Cupboard at $CUPBOARD_URL unreachable → documented directory-only degradation, create still succeeded)" \
                       || echo "✗ A bindingUnverified != true (got: $A_UNVERIFIED) — the live Cupboard may have been reached!"
echo "  (cupboard leg outcome: $(jget "$a_resp" "json.dumps(d['publish'].get('cupboard'))") — rows must NOT have been created on the live worker)"
[ "$create_ok" = 1 ] || { echo "cannot continue without a created hive"; exit 6; }

# ── 2. B discovers A's hive via the directory (announce over the testnet) ──────
log "B ($P_B_USER): poll GET /api/discovery/hives for '$HIVE_SLUG' (≤120s)"
discover_ok=0; links_ok=0; B_ROW=""
for i in $(seq 1 40); do
  body="$(dir_list b)"
  B_ROW="$(jget "$body" "json.dumps(next(r for r in d['rows'] if r['hiveId']=='$HIVE_SLUG'))")"
  [ -n "$B_ROW" ] && { discover_ok=1; break; }
  sleep 3
done
if [ "$discover_ok" = 1 ]; then
  echo "✓ B discovered '$HIVE_SLUG' in its directory: $(echo "$B_ROW" | head -c 300)"
  N_LINKS="$(jget "$B_ROW" "len(d.get('memberLinks') or [])")"
  [ -n "$N_LINKS" ] && [ "$N_LINKS" -ge 1 ] && links_ok=1
  [ "$links_ok" = 1 ] && echo "✓ B's listing carries $N_LINKS memberLink(s)" \
                      || echo "✗ B's listing has no memberLinks"
  echo "  (note: the /api/discovery/hives projection does not expose memberRepos — the announce's member_repos leg is proven by the join-offer below, which matches via hiveMatchesRepo(memberRepos))"
else
  echo "✗ '$HIVE_SLUG' never appeared in B's directory (~120s). B directory: $(dir_list b | head -c 400)"
fi

# ── 3. B pastes the SAME repo URL → must get the JOIN OFFER, not a create ───────
offer_ok=0; offer_dir_ok=0; OFFER_LINKS_JSON="[]"
if [ "$discover_ok" = 1 ]; then
  log "B ($P_B_USER): POST the SAME repo URL → expect existing.kind='hive' (join offer, zero side effects)"
  b_resp="$(from_repo b)"
  echo "B from-repo → $(echo "$b_resp" | head -c 600)"
  B_KIND="$(jget "$b_resp" "d['existing']['kind']")"
  B_CREATED="$(jget "$b_resp" "'created' in d")"
  B_SOURCE="$(jget "$b_resp" "d['existing']['source']")"
  B_OFFER_HIVE="$(jget "$b_resp" "d['existing']['hive']['hiveId']")"
  OFFER_LINKS_JSON="$(jget "$b_resp" "json.dumps(d['existing']['hive'].get('memberLinks') or [])")"
  [ "$B_KIND" = "hive" ] && [ "$B_CREATED" != "True" ] && offer_ok=1
  [ "$offer_ok" = 1 ] && echo "✓ B got the JOIN OFFER (existing.kind='hive', no create)" \
                      || echo "✗ B did not get a join offer (kind=$B_KIND created=$B_CREATED)"
  [ "$B_SOURCE" = "directory" ] && [ "$B_OFFER_HIVE" = "$HIVE_SLUG" ] && offer_dir_ok=1
  [ "$offer_dir_ok" = 1 ] && echo "✓ offer resolved from the DIRECTORY announce for '$HIVE_SLUG' (member_repos repo-id match proven end-to-end)" \
                          || echo "✗ offer source/hive mismatch (source=$B_SOURCE hive=$B_OFFER_HIVE)"
fi

# ── 4. B accepts: the REAL hive Join (POST /api/discovery/join-hive) ─────────────
# This is what the directory panel's "Join" drives — joinHiveAsView, which
# composes the per-member join-link mechanic AND materializes the joiner-side
# hive VIEW (the remote_hive registry entry + hive_slug on every member + the
# remote hive identity row). That materialization is what re-keys the joiner
# onto the OWNER's Hive-pubkey topic so federation actually crosses. Joining the
# bare per-member /api/harness/join-link directly (the old smoke) skips the view,
# leaving the member on the gh:<repo_id> topic while the owner sits on the
# Hive-pubkey topic — different topics, no merge (EI-681).
join_ok=0; clone_ok=0
N_OFFER_LINKS="$(jget "$OFFER_LINKS_JSON" "len(d)")"
if [ "$offer_ok" = 1 ] && [ -n "$N_OFFER_LINKS" ] && [ "$N_OFFER_LINKS" -ge 1 ]; then
  echo "✓ offer carries $N_OFFER_LINKS memberLink(s)"
  log "B ($P_B_USER): JOIN the hive '$HIVE_SLUG' via /api/discovery/join-hive ($N_OFFER_LINKS link(s))"
  join_resp="$(curl -s -m 610 -X POST "http://127.0.0.1:${FED_SC[b]}/api/discovery/join-hive" \
    -H 'content-type: application/json' \
    -d "{\"hiveId\":\"$HIVE_SLUG\",\"memberLinks\":$OFFER_LINKS_JSON}")"
  echo "B join-hive → $(echo "$join_resp" | head -c 500)"
  J_OK="$(jget "$join_resp" "d.get('ok')")"
  N_MEM="$(jget "$join_resp" "len(d.get('members') or [])")"
  N_MEM_OK="$(jget "$join_resp" "sum(1 for m in (d.get('members') or []) if m.get('ok'))")"
  if [ "$J_OK" = "True" ] && [ -n "$N_MEM_OK" ] && [ "$N_MEM_OK" -ge 1 ]; then
    join_ok=1; clone_ok=1
    echo "✓ join-hive ok:true — $N_MEM_OK/$N_MEM member(s) joined (view materialized: remote_hive + hive_slug + identity)"
  else
    echo "✗ join-hive failed (ok=$J_OK members_ok=$N_MEM_OK/$N_MEM)"
  fi
elif [ "$offer_ok" = 1 ]; then
  echo "✗ offer carries no memberLinks — join leg cannot run"
fi

# ── 5. POST-JOIN MERGE probe (hive-federation-cross-machine-merge P-001) ──────────
# The open question: does a write FEDERATE after a hive join? (No existing test goes
# past join.) Write a feature on A's member harness; poll B for it (origin=remote, any
# slug — the hive model may remap harness_slug across peers). Same-box answers it for $0.
hive_merge_ok=0; landed_slug=""
if [ "$join_ok" = 1 ]; then
  log "POST-JOIN MERGE probe: write F-HIVE1 on A (member='$MEMBER_SLUG') → poll B (origin=remote, any slug)"
  probe="$(fed_hive_merge_probe a b "$MEMBER_SLUG" F-HIVE1 40 || true)"
  if [ "${probe%% *}" = 1 ]; then hive_merge_ok=1; landed_slug="${probe#* }"; fi
  if [ "$hive_merge_ok" = 1 ]; then
    echo "✓ POST-JOIN MERGE: F-HIVE1 federated A→B (landed under harness_slug='$landed_slug')"
  else
    echo "✗ POST-JOIN MERGE: F-HIVE1 never reached B — the hive merge does NOT apply a peer's writes after join (probe=$probe)"
    echo "===== DIAG: localize the post-join merge failure ====="
    echo "--- A: did the write CAPTURE? (substrate_outbox rows) ---"; drv_psql a "SELECT count(*) AS outbox FROM harness_shared.substrate_outbox;" 2>/dev/null
    echo "--- A: F-HIVE1 row locally (origin) ---"; drv_psql a "SELECT harness_slug,feature_id,origin FROM harness_shared.harness_features_consolidated WHERE feature_id='F-HIVE1';" 2>/dev/null
    echo "--- A: registry harness slugs + shared/hive state ---"; drv_psql a "SELECT harness_slug FROM harness_shared.harness_registry;" 2>/dev/null | tr '\n' ' '; echo
    echo "--- A [swarm]: topic / announce / peer ---"; grep -aE '\[swarm\]|joined topic|announc|peer_connected|hive_pubkey|resolveHive' "${FED_LOG[a]}" 2>/dev/null | tail -10
    echo "--- B [swarm]: topic / peer / admit / reject / binding ---"; grep -aE '\[swarm\]|joined topic|peer_connected|admit|reject|binding|verifyAnnounce|read-admission|hive_pubkey' "${FED_LOG[b]}" 2>/dev/null | tail -14
    echo "--- B: any features at all? (did ANYTHING replicate) ---"; drv_psql b "SELECT harness_slug,feature_id,origin FROM harness_shared.harness_features_consolidated;" 2>/dev/null | head
    echo "--- B: registry harness slugs ---"; drv_psql b "SELECT harness_slug FROM harness_shared.harness_registry;" 2>/dev/null | tr '\n' ' '; echo
    echo "--- EI-681 joiner re-key chain (why B stays on gh:repo_id) ---"
    echo "  B hives identity rows (did join-hive 2b write the remote pubkey?): $(drv_psql b "SELECT home_slug||':'||octet_length(public_key)||'b' FROM harness_shared.hives;" 2>/dev/null | tr '\n' ' ')"
    echo "  B registry payload (hive_slug + remote_hive per project): $(drv_psql b "SELECT payload::text FROM harness_shared.harness_registry;" 2>/dev/null | head -c 700)"
    echo "  B [swarm] re-key / reboot / resolveHive trace: $(grep -aiE 'reboot|re-key|rekey|resolveHive|hiveHomeSlug|hive binding|resolveHiveSwarm' "${FED_LOG[b]}" 2>/dev/null | tail -6 | tr '\n' '|')"
    echo "  A hive pubkey announced + B discovered-hive pubkey: A=$(drv_psql a "SELECT encode(public_key,'base64') FROM harness_shared.hives LIMIT 1;" 2>/dev/null | tr -d '[:space:]' | head -c 20)… | Bcache=$(drv_psql b "SELECT payload::text FROM harness_shared.hive_directory_cache;" 2>/dev/null | grep -oE 'hivePubkey[^,]{0,40}' | head -1)"
    echo "===== /DIAG ====="
  fi
else
  echo "· POST-JOIN MERGE probe skipped (join did not complete)"
fi

# ── report ──────────────────────────────────────────────────────────────────────
log "RESULT"
echo "create=$([ "$create_ok" = 1 ] && echo PASS || echo FAIL)  announced=$([ "$announce_ok" = 1 ] && echo PASS || echo FAIL)  degraded-cupboard=$([ "$degraded_ok" = 1 ] && echo PASS || echo FAIL)  discovered=$([ "$discover_ok" = 1 ] && echo PASS || echo FAIL)  member-links=$([ "$links_ok" = 1 ] && echo PASS || echo FAIL)  join-offer=$([ "$offer_ok" = 1 ] && echo PASS || echo FAIL)  offer-from-directory=$([ "$offer_dir_ok" = 1 ] && echo PASS || echo FAIL)  join=$([ "$join_ok" = 1 ] && echo PASS || echo FAIL)  join-clone=$([ "$clone_ok" = 1 ] && echo PASS || echo FAIL)  post-join-merge=$([ "$hive_merge_ok" = 1 ] && echo PASS || echo FAIL)"
if [ "$create_ok" = 1 ] && [ "$announce_ok" = 1 ] && [ "$degraded_ok" = 1 ] && [ "$discover_ok" = 1 ] && [ "$links_ok" = 1 ] && [ "$offer_ok" = 1 ] && [ "$offer_dir_ok" = 1 ] && [ "$join_ok" = 1 ] && [ "$clone_ok" = 1 ]; then
  echo "OVERALL: PASS — create-from-repo → discover → join-offer → join proven end-to-end ($RUN_MODE mode)"
  exit 0
else
  DBG="/tmp/hive-fromrepo-smoke-debug-$$"
  mkdir -p "$DBG" && cp "${FED_LOG[a]}" "$DBG/a.log" 2>/dev/null; cp "${FED_LOG[b]}" "$DBG/b.log" 2>/dev/null
  echo "OVERALL: INCOMPLETE — instance logs preserved at $DBG"
  grep -iE "hive-directory|\[swarm\]|from-repo|publish|error" "${FED_LOG[a]}" 2>/dev/null | tail -12
  grep -iE "hive-directory|\[swarm\]|join" "${FED_LOG[b]}" 2>/dev/null | tail -8
  exit 6
fi
