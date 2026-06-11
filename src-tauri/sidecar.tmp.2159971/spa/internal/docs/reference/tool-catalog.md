# Tool catalog (grouped)
URL: /internal/docs/reference/tool-catalog

A coarse, grouped map of the MCP tool surface — one row per tool group with its verbs + capabilities. Generated from the defineTool registry. Full per-tool schemas: agent_tools:list / tools/list at runtime.


> **Generated — do not edit by hand.** Run `npm run gen:doc-projections` (or `npm run gen:doc-tool-catalog`).
> Source: `scripts/gen-doc-tool-catalog.ts`. Part of `starlight-projection-generators-2026-06-05` (Brief 29).

# Tool catalog (grouped)

Every MCP tool is authored once via `defineTool` and projected onto HTTP/MCP/IPC. This is a **coarse** map of that surface — grouped by verb prefix, listing each group's verbs + capability tags. It is intentionally NOT the full per-tool schema dump (that churns on every guidance tweak across the fleet); for full schemas + guidance an agent calls `agent_tools:list { asRole }` or reads `tools/list` at runtime.

**368 MCP tools** across **69 groups**.

## Groups

| Group | Verbs | Names | Capabilities |
|---|---|---|---|
| `accounts` | 5 | `list` `register` `remove` `scale_out` `status` | `harness:read` `harness:write` |
| `actions` | 1 | `recent` | `actions:read` |
| `activity` | 2 | `recent` `report` | `activity:read` `activity:report` |
| `agent_chats` | 6 | `archive` `chat` `create` `get` `list` `send_message` | `agent_chats:read` `agent_chats:write` `harness:read` |
| `agent_tools` | 1 | `list` | `agent_tools:read` |
| `agents` | 1 | `list` | `agents:read` |
| `architect` | 1 | `chat` | `harness:write` |
| `artifacts` | 4 | `append` `delete` `load` `save` | `artifacts:read` `artifacts:write` |
| `audit` | 1 | `list` | `audit:read` |
| `autoloop` | 2 | `control` `status` | `autoloop:read` `autoloop:write` |
| `backup` | 8 | `diff` `promote` `restore` `rollback` `settings_get` `settings_set` `snapshot_create` `snapshot_list` | `backup:read` `backup:write` |
| `blueprint` | 4 | `catalog` `create` `extend` `validate` | `harness:read` `harness:write` |
| `brainstorm` | 1 | `chat` | `harness:write` |
| `chat` | 1 | `ask_choice` | `chat:write` |
| `conversations` | 7 | `answer` `get` `join` `list` `post` `promote` `resolve` | `coord:read` `coord:write` |
| `coord` | 26 | `ack` `ask` `ask-owner` `await-inbox` `declare-intent` `deliberate` `emit` `escalate` `escalations` `feed` `handoff` `handoffs` `inbox` `message-agent` `plan-events` `presence` `resolve` `send` `thread` `thread-post` `vote` `wake-mode` `wake-queue` `watermark` `watermark-set` `whoami` | `audit:read` `coord:read` `coord:write` |
| `cross_harness` | 10 | `docs_get` `docs_outline` `docs_search` `inbox` `outbox` `plans_get` `plans_list` `plans_search` `recent_activity` `supervisor_notes` | `cross_harness:read` `harness:read` `plans:read` |
| `curation` | 3 | `change-feed` `feed` `state-of-hive` | `curation:read` |
| `db` | 3 | `check_drift` `migrate` `next-migration` | `locks:read` `locks:write` |
| `deploy` | 5 | `harness` `hive` `status` `teardown` `teardown_hive` | `harness:read` `harness:write` |
| `dev` | 21 | `activity` `audit` `build_status` `coord_categorize` `dogfood_substrate_status` `event_emitter` `harnesses` `hello-card` `ipc_echo` `omp_session` `pg_active_queries` `pg_health` `pg_table_sizes` `processes` `rate_governor_status` `restart` `service_health` `session_detail` `sessions` `state_counter` `telemetry` | `audit:read` `harness:read` `intel:read` `locks:write` `tasks:read` |
| `discovery` | 2 | `hives` `set_hive` | `discovery:read` `discovery:write` |
| `docs` | 3 | `get` `outline` `search` | `docs:read` |
| `events` | 5 | `await` `cancel` `emit` `graph` `status` | `coord:read` `coord:write` `events:read` |
| `features` | 5 | `get` `history` `list_related` `search` `tag_vocabulary` | `features:read` |
| `flags` | 3 | `get` `list` `set` | `audit:write` `intel:read` |
| `fleet` | 11 | `admit` `assignments` `bee_mail` `cancel` `drain` `governor` `sandbox_deps` `selected_bee` `spawn` `supervise` `tree` | `coord:read` `coord:write` `intel:read` `work_items:read` `work_items:write` |
| `generators` | 1 | `publish` | `coord:write` |
| `goals` | 2 | `get` `list` | `goals:read` |
| `gym` | 2 | `judge` `signals` | `harness:read` |
| `harness` | 14 | `create` `escalation` `generate-from-repo` `get` `health` `list` `list_features` `markdown_index` `membership` `migrate-config-json` `pending_reviews` `phase_path` `plan_reviews` `status` | `harness:read` `harness:write` |
| `harness_docs` | 7 | `anchor` `ingest` `list` `record` `regenerate` `set_overlay` `verify` | `docs:read` `docs:write` |
| `hive` | 11 | `create` `cross_grant` `declare-wake` `dissolve` `get` `list` `pause` `start` `status` `update` `wake` | `harness:read` `harness:write` `routines:write` `work_items:write` |
| `hooks` | 1 | `known` | `roles:read` |
| `improvements` | 5 | `capture` `digest` `resolve` `triage` `watchdog-status` | `coord:read` `coord:write` |
| `inbox` | 1 | `triage` | `coord:write` |
| `instance` | 3 | `boot` `capture` `clone` | `harness:read` `harness:write` |
| `intel` | 2 | `artifacts` `spawn_tree` | `intel:read` |
| `issues` | 13 | `claim` `close` `comment` `create` `get` `link` `list` `promote` `release` `search` `subscribe` `tag` `update` | `coord:read` `coord:write` |
| `lexicon` | 1 | `active_pack` | `work_items:read` |
| `locks` | 12 | `acquire` `acquire_granular` `acquire_resource` `cancel_wait` `check_command` `heartbeat` `heartbeat_resource` `list` `queue` `release` `release_granular` `release_resource` | `locks:read` `locks:write` |
| `memory` | 5 | `forget` `list` `remember` `search` `update` | `memory:read` `memory:write` |
| `messages` | 4 | `dismiss` `inbox` `outbox` `send` | `messages:read` `messages:write` |
| `new_subagent` | 2 | `approve` `request` | `coord:write` |
| `notifications` | 1 | `recent` | `notifications:read` |
| `omp` | 2 | `config` `sessions` | `omp:read` `omp:write` |
| `operator` | 24 | `audit` `budget` `conv_voice` `converse` `credentials_status` `decisions` `dedup_check` `delegate` `multi_workspace` `notes` `nudge` `paused` `preferences` `preview_prompt` `rate_limit_config` `standing_approval_mark_shown` `standing_approvals_decide` `standing_approvals_list` `stats` `trigger_state` `voice_debug` `voice_prefs` `voice_spend_summary` `voice_utterance_log` | `operator:converse` `operator:delegate` `operator:read` `operator:write` `secrets:operator-credentials:read` |
| `oracle` | 1 | `chat` | `harness:read` |
| `papercusp` | 1 | `list_workspaces` | `workspaces:read` |
| `pending_events` | 1 | `list` | `pending_events:read` |
| `plan_items` | 11 | `adopt_name` `assign` `claim` `convert` `heartbeat` `join_group` `leave_group` `my_items` `release` `status` `unassign` | `coord:read` `coord:write` |
| `plans` | 33 | `add-decision` `add-item` `apply-plan-block` `attention` `backfill-revisions` `edit` `export` `get` `items` `launch` `lint` `list` `new` `pause` `promote` `resume` `revision-diff` `revision-transcript` `revisions` `run-transcript` `runs` `search` `set-content` `set-content-chunk` `set-frontmatter` `set-importance` `set-now` `set-plan-status` `set-priority` `set-run-status` `set-status` `start` `summarize-revision` | `coord:write` `plans:read` `plans:write` |
| `plugins` | 4 | `fire_event` `invoke_action` `runtime_status` `tui_panes` | `plugins:read` `plugins:write` |
| `processes` | 1 | `kill` | `processes:kill` |
| `projects` | 4 | `get` `list` `spec_revision` `spec_revisions` | `projects:read` |
| `rationale` | 2 | `feed` `reproject` | `coord:read` `coord:write` |
| `roles` | 4 | `firing_on` `get` `known` `list` | `roles:read` |
| `saved_prompts` | 1 | `list` | `intel:read` |
| `search` | 3 | `fulltext` `query` `semantic` | `search:read` |
| `substrate` | 2 | `revoke_contributor` `revoke_self_device` | `intel:write` |
| `tasks` | 3 | `create` `get` `list` | `tasks:read` `tasks:write` |
| `topics` | 7 | `create` `feed` `list` `merge` `subscribe` `tag` `unsubscribe` | `coord:read` `coord:write` |
| `tui` | 1 | `dispatch` | `tui:dispatch` |
| `turn` | 1 | `interrupt` | `turn:interrupt` |
| `ui` | 3 | `dispatch` `get_state` `list_clients` | `ui:dispatch` `ui:read` |
| `voice` | 5 | `agent` `channels` `join` `leave` `status` | `operator:read` `operator:write` |
| `watch` | 1 | `create` | `coord:write` |
| `wiki` | 1 | `backlinks` | `wiki:read` |
| `work_items` | 23 | `claim` `claim_next` `claim_replica` `co_locate` `comment` `complete` `create` `get` `judge_redundancy` `link` `list` `observe` `promote` `record_replica_result` `redundancy_status` `release` `reorder` `search` `set_priority` `set_redundancy` `set_state` `subscribe` `tag` | `work_items:read` `work_items:write` |
