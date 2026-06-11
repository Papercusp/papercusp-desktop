# Authoring a build script
URL: /internal/docs/snapshots/authoring-build-scripts

How publishers ship `provision.setup` / `teardown` / `verify` scripts that work end-to-end with snapshot fork — manifest extensions, runtime helpers, project-file templating, reference plugins.

import { Aside } from '@astrojs/starlight/components';

This page is the publisher-facing guide for the build-script lifecycle —
the substrate primitive that lets a forked snapshot provision real
infrastructure (Cloudflare, AWS, GitHub, etc.) on the forker's host.

It deliberately points outward. Most of what you need to know about
declaring inputs and templating files is **standard JSON Schema and
POSIX envsubst** — read those upstream docs first; this page only
covers the small papercusp-specific delta.

## Prerequisites — read these once

If you've never authored anything that prompts users for config and
runs a script with their answers, read:

* [JSON Schema getting-started](https://json-schema.org/learn/getting-started-step-by-step)
  (\~30 min) — the format we use for `configSchema`. Covers `type`,
  `description`, `default`, `pattern`, `enum`, `required`.
* [POSIX shell parameter expansion](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html#tag_18_06_02)
  or the [GNU envsubst manpage](https://man7.org/linux/man-pages/man1/envsubst.1.html)
  (\~5 min) — the templating syntax we use for `*.tmpl` files. Covers
  `${VAR}`, `${VAR:-default}`, `${VAR:?error}`.
* [react-jsonschema-form `ui:*` hints](https://rjsf-team.github.io/react-jsonschema-form/docs/usage/widgets/)
  (\~10 min) — how the fork-time form picks widgets. We use rjsf to
  render your `configSchema` + `uiSchema`.
* [Heroku `app.json` env generators](https://devcenter.heroku.com/articles/app-json-schema#env)
  (\~5 min, only for the names) — we adopt their `generator: "secret"` /
  `"secret-base64"` / `"secret-hex"` etc. naming verbatim.

These are the only external dependencies. Total onboarding: \~50 min once.

## Mental model

A snapshot is a tarball of project files + DB state + plugin configs.
When someone forks it, the substrate:

1. Restores project files + DB schema into the forker's harness dir.
2. Reads each enabled plugin's `configSchema` and prompts the forker
   for any field marked `secret: true` or `shareable: false` — the
   publisher's values were stripped at publish time.
3. For each plugin that declares `provision.setup`, the substrate:
   * Shows a consent dialog (script hash, allowed hosts, cloud provider).
   * On approve, runs the script in a sandbox with the forker's config
     in env vars.
   * Streams stdout/stderr to a live terminal pane.
   * Persists `papercusp_record_resource` calls so teardown can clean up.

Your job as a publisher is to:

* Declare your variables in `configSchema` with the right share-semantics
  flags so the right values are stripped at publish time.
* Author `provision/setup.sh` (and optional `teardown.sh`/`verify.sh`)
  that read those values from env and provision your platform's
  resources idempotently.
* Author `*.tmpl` files in your harness's project dir so post-provision,
  the harness's code knows the new resource IDs.

## Manifest extensions — the four flags you need

Standard JSON Schema covers `type`, `description`, `default`, `pattern`,
`enum`, etc. The substrate adds four extensions to drive snapshot
redaction and form rendering:

### `secret: true`

Marks a field as a credential. By default, **secret fields are stripped
from snapshots** at publish time and the forker is prompted for a fresh
value at fork time.

```json
"byoCloudflareToken": {
  "type": "string",
  "secret": true,
  "snapshotPolicy": "strip",
  "description": "API token with Pages:Edit + R2:Edit scopes."
}
```

### `snapshotPolicy: "strip" | "include" | "warn-and-prompt"`

Override snapshot behavior for `secret: true` fields:

* `"strip"` (default) — value never travels with the snapshot
* `"include"` — value travels (e.g. demo Slack webhook). Publish CLI
  requires `--include-secrets` flag and per-secret confirmation
* `"warn-and-prompt"` — publish CLI asks per-snapshot

### `shareable: false`

Marks a field as a publisher-specific identifier (account ID, org
name, region) — different per forker, also stripped from snapshots.

```json
"accountId": {
  "type": "string",
  "shareable": false,
  "pattern": "^[a-f0-9]{32}$",
  "description": "Cloudflare account UUID."
}
```

### `generator: "<name>"` (planned — not yet wired)

The `generator` field is a design target — the fork/instantiate path does
**not** auto-fill generated values today. Until it lands, generate these
values inside `setup.sh` (e.g. `openssl rand -base64 32`) and record them
with `papercusp_state_set`.

Substrate auto-fills the field at fork time. Adopted from Heroku's
[app.json env generators](https://devcenter.heroku.com/articles/app-json-schema#env);
same names so publishers transferring from Heroku recognize them.

| Generator              | What it produces                          |
| ---------------------- | ----------------------------------------- |
| `secret-256`           | 32 random bytes, base64url                |
| `secret-base64-256`    | Same, explicit base64                     |
| `secret-hex-256`       | 32 random bytes, hex                      |
| `uuid`                 | RFC 4122 v4 UUID                          |
| `random-name`          | Memorable two-word name (`bold-meadow-7`) |
| `slug-of:harness_slug` | The forking harness's slug                |

```json
"sessionSecret": {
  "type": "string",
  "secret": true,
  "generator": "secret-256",
  "description": "Session signing secret, auto-generated at fork."
}
```

### `uiSchema` block (sibling to `configSchema`)

rjsf-style hints. We don't reinvent these — read
[rjsf widgets docs](https://rjsf-team.github.io/react-jsonschema-form/docs/usage/widgets/).

```json
"uiSchema": {
  "byoCloudflareToken": {
    "ui:widget": "password",
    "ui:help": "Create at dash.cloudflare.com/profile/api-tokens."
  }
}
```

## Env vars `setup.sh` receives

The runner sets three namespaces of env vars before invoking your
script:

### `$USER_VAR_*` — flattened config scalars

Every top-level scalar (`string`/`number`/`boolean`) in your plugin's
config becomes `USER_VAR_<UPPER_SNAKE>`. lowerCamelCase is converted
to UPPER\_SNAKE\_CASE. Nested objects/arrays remain accessible via
`$PAPERCUSP_CONFIG` parsed with jq.

Mirrors the [Dev Container Features `options`-to-env mapping](https://containers.dev/implementors/features/#options-property)
— same convention plus a `USER_VAR_` prefix to disambiguate from
arbitrary script env.

```bash
# config: { "accountId": "abc", "r2BucketName": "demo-assets" }
# env:    USER_VAR_ACCOUNT_ID=abc, USER_VAR_R2_BUCKET_NAME=demo-assets
```

### `$OUTPUT_*` — your script's outputs

Set via `papercusp_state_set` (see [helpers](#runtime-helpers) below),
which folds the value into `state.json`'s `outputs` object. The runner
does **not** currently re-inject those values as `$OUTPUT_*` env vars on
later phases — `teardown.sh` / `verify.sh` instead read the full state
JSON from `$PAPERCUSP_PLUGIN_STATE`. For `papercusp_render_templates`,
the values an output `${OUTPUT_<key>}` template sees are whatever the
*same* script has `export`ed into its own env; the helper does not
auto-source `state.json`.

### `$PAPERCUSP_*` — substrate

| Variable                  | What                                                 |
| ------------------------- | ---------------------------------------------------- |
| `$PAPERCUSP_CONFIG`       | Full plugin config as JSON (parse with jq if needed) |
| `$PAPERCUSP_HARNESS_SLUG` | The harness slug — useful as a default name          |
| `$PAPERCUSP_PROJECT_DIR`  | RW-mounted harness project dir (templates target)    |
| `$PAPERCUSP_PLUGIN_DIR`   | RO-mounted plugin source dir                         |
| `$PAPERCUSP_SCRATCH_DIR`  | RW-mounted scratch dir; also `$HOME` and CWD         |
| `$PAPERCUSP_RUNTIME_LIB`  | Path to lib.sh — source it for helpers               |
| `$PAPERCUSP_PHASE`        | One of `setup` / `teardown` / `verify`               |

## Runtime helpers (`lib.sh`)

Source the helper library at the top of every script:

```bash
#!/usr/bin/env bash
set -euo pipefail
. "$PAPERCUSP_RUNTIME_LIB"
```

Then use:

| Helper                                                | Purpose                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `papercusp_progress <step> <message>`                 | Emit a structured progress event. UI shows progress bar. |
| `papercusp_warn <message>`                            | Surface a yellow warning indicator.                      |
| `papercusp_error <message>`                           | Surface a red error indicator (script may continue).     |
| `papercusp_record_resource <kind> <id> [<json-meta>]` | Record a resource for teardown. Append-only WAL.         |
| `papercusp_state_set <key> <json-value>`              | Set a `state.json` output. Becomes `$OUTPUT_<key>`.      |
| `papercusp_render_templates`                          | Walk `$PAPERCUSP_PROJECT_DIR` for `*.tmpl`, render each. |

Resource kinds (`cloudflare.d1.database`, `aws.lambda.function`,
`github.repo`) are **plugin-author vocabulary**, not substrate-defined.
Your `teardown.sh` is the dispatcher that knows how to delete each kind.

## Project-file templating (the `.tmpl` convention)

The substrate doesn't dictate templating — we use plain envsubst.
Publishers commit `*.tmpl` files in the harness project dir; setup
calls `papercusp_render_templates` after creating resources, which:

1. Walks `$PAPERCUSP_PROJECT_DIR` for `*.tmpl` (skips `.git/`,
   `node_modules/`, `dist/`, `.next/`, `.papercusp/`, `target/`,
   `build/`, `.turbo/`).
2. Runs `envsubst` on each, with `$USER_VAR_*` + `$OUTPUT_*` +
   `$PAPERCUSP_*` in env.
3. Writes the rendered file to the same path without `.tmpl`.
4. Removes the `.tmpl` source.

Example `wrangler.toml.tmpl`:

```toml
name           = "${OUTPUT_workerName}"
account_id     = "${USER_VAR_ACCOUNT_ID}"
compatibility_date = "2026-04-01"

[[d1_databases]]
binding       = "DB"
database_name = "${OUTPUT_d1DatabaseName}"
database_id   = "${OUTPUT_d1DatabaseId}"

[vars]
SESSION_SECRET = "${USER_VAR_SESSION_SECRET}"
PUBLIC_API_URL = "${OUTPUT_workerUrl:-https://${OUTPUT_workerName}.workers.dev}"
```

Add the rendered output (`wrangler.toml`) to your harness's
`.gitignore` — only the `.tmpl` is committed.

## Reference plugins (fork these to start)

The substrate ships canonical reference plugins. To scaffold a new
plugin from one:

```bash
papercusp plugin init my-stack --template cloudflare-stack
cd my-stack
# edit provision/setup.sh, configSchema, etc.
papercusp install --from-path .
```

Available templates:

| Template           | What it provisions                                 | Use when…                          |
| ------------------ | -------------------------------------------------- | ---------------------------------- |
| `cloudflare-stack` | Pages + Workers + D1 + R2 + KV (mega-plugin)       | Your harness deploys to Cloudflare |
| `github-repo`      | GitHub repo (single resource)                      | Your harness pushes code to GitHub |
| *(more coming)*    | *aws-stack, fly-stack, render-stack, vercel-stack* | *As they ship*                     |

The `cloudflare-stack` source is the most complete worked example —
read its [setup.sh](https://github.com/Papercusp/papercusp/blob/main/plugins/cloudflare-stack/provision/setup.sh)
and [README](https://github.com/Papercusp/papercusp/blob/main/plugins/cloudflare-stack/README.md)
side-by-side with this guide.

## Sandbox restrictions

Your script runs in a substrate-bundled bwrap (Linux) or sandbox-exec
(macOS) sandbox. Constraints:

* **Filesystem**: RO access to `/usr`, `/lib`, `/bin`, `/etc`, your
  plugin dir; RW access to `$PAPERCUSP_SCRATCH_DIR`,
  `$PAPERCUSP_PROJECT_DIR`, `/tmp`. Everything else is RO including
  `$HOME`.
* **Network**: outbound only to `provision.allowedHosts` (or the
  declared `cloudProvider` preset's allowlist). The substrate hard-blocks
  IMDS (`169.254.0.0/16`), RFC1918, and loopback regardless of declared
  hosts. See [build-scripts § Network policy floor](/internal/docs/snapshots/build-scripts#network-policy-floor).
* **No interactive subprocesses**. Scripts that try to read from stdin
  or open browsers mid-run are killed. Use OAuth via `ctx.oauth.token()`
  in your action handlers, not `aws sso login` from setup.

## Idempotency

`setup.sh` runs once per `(harness, plugin)` per `(configHash,
scriptHash, pluginVersion)` tuple. Re-runs are blocked unless the user
explicitly clicks Re-provision OR one of the hashes changes. Inside
your script, you should still:

* Check by name before creating resources (HTTP probe → 200 ? skip : create).
* Call `papercusp_record_resource` either way so teardown sees the
  full set.
* Treat partial state (some resources exist, some don't) as recoverable.

The `cloudflare-stack` setup.sh is the canonical pattern — every
resource starts with a list/probe before a conditional create.

## Teardown contract

`teardown.sh` receives recorded resources via `state.json` (read from
`$PAPERCUSP_PLUGIN_STATE` env). The substrate does **NOT** interpret
resource kinds — your teardown is the dispatcher:

```bash
mapfile -t resources < <(echo "$state" | jq -c '.createdResources[]?')
for ((i=${#resources[@]}-1; i>=0; i--)); do
  row="${resources[$i]}"
  kind=$(echo "$row" | jq -r '.kind')
  id=$(echo "$row" | jq -r '.externalId')
  case "$kind" in
    my.thing) delete_my_thing "$id" ;;
    *) papercusp_warn "unknown kind '$kind'; skipping" ;;
  esac
done
```

Walk in **reverse creation order** so dependencies resolve correctly
(delete the worker before the D1 it binds, etc.).

## Verify contract

`verify.sh` should be fast (≤30s) and read-only. Exit codes:

* `0` — all resources reachable
* `1` — degraded (some missing or unhealthy)
* `2` — broken (token/account unusable; substrate marks the plugin
  as needing re-consent)

The substrate calls verify after setup completes, on operator boot,
and on demand from the plugin settings UI.

## Publishing checklist

Before `papercusp snapshot publish`:

* `configSchema` declares **every** publisher-specific value with
  `secret: true` or `shareable: false`. Anything left unflagged that
  matches a credential pattern (`/token|secret|api[_-]?key/i`) gets
  stripped with a warning, but explicit is better.
* All `*.tmpl` files in your project dir use `$USER_VAR_*` / `$OUTPUT_*`
  / `$PAPERCUSP_*` — no hardcoded publisher values that should be
  per-fork.
* `provision.allowedHosts` (or `cloudProvider` preset) lists every
  host your script reaches. The sandbox blocks anything else.
* `teardown.sh` handles every `kind` your `setup.sh` records.
* `verify.sh` exits 0 on a fresh provisioning, 1 on a partial
  teardown, 2 on missing credentials.
* Run `papercusp plugin verify --all` to recompute config hashes
  against your installed copy and catch drift before publish.

## Spec links

* [Build scripts (full spec)](/internal/docs/snapshots/build-scripts) —
  manifest reference, sandbox model, trust lifecycle, recovery contract.
* [Share semantics](/internal/docs/snapshots/share-semantics) — `secret`/`shareable`/`snapshotPolicy` in detail.
* [OAuth integration](/internal/docs/snapshots/oauth-integration) —
  `oauth: { provider, scopes }` for paste-free credential acquisition.
* [Open questions](/internal/docs/snapshots/open-questions) — V1 scope,
  V1.1 deferred work.
