# Build scripts (provision lifecycle)
URL: /internal/docs/snapshots/build-scripts

Plugins can declare setup / teardown / verify scripts that run on the user's host inside an OS-level sandbox by default, with full visibility, consent gating, idempotency tracking, and audit logging.

import { Aside } from '@astrojs/starlight/components';

Six rounds of review have shaped this page. See [Revisions](./revisions) for
the full mapping. Most-recent additions:

* **Sandbox is default for ALL scripts**, signed or unsigned. Bwrap with
  install-time smoke test on Linux; sandbox-exec + signed-or-refuse on
  macOS; Tauri-sidecar with restricted entitlements coming in V2.
* **`network: "open"` replaced** with `cloudProvider: { id, region }`
  presets that template region-specific allowlists. IMDS + RFC1918 are
  always blocked, even in custom modes.
* **Idempotency hashes `(configHash, scriptHash, pluginVersion)`** —
  any script-hash change forces re-consent regardless of
  `skipReprovisionOnPatch`.
* **`papercusp_record_resource` helper** lets scripts checkpoint each
  created resource; substrate offers automatic rollback prompt on failure.
* **PG-based operator lock** (replaces file-based heartbeat) for
  multi-machine fork safety.
* **Trust granularity is per-(publisher, plugin)**; ownership transfer
  invalidates trust; key rotation must be marketplace-countersigned.
* **Hooks queued during setup**, replayed after; overflow surfaces a
  badge, not a silent drop.
* `auditLogCapMb` per-plugin override; `costEstimateAdvisory` stays out;
  V1.1 ships real `budgetCap` with AWS Budgets helper.

## Goals

* Let plugins provision arbitrary infrastructure during install / fork.
* Preserve the existing capability sandbox for action handlers — scripts are an opt-in *escape hatch*, not a hole in the gate.
* Make every line of script execution visible to the user.
* Track what was created so uninstall can clean up.
* Make idempotent re-runs explicit and auditable, so users can fork the same snapshot multiple times into different accounts without surprise.
* **Default to OS-level sandboxing**, regardless of whether a script is signed.

## Manifest surface

Core build-script execution has landed: the SDK types (`PluginProvision` /
`ProvisionScript` in `@papercusp/plugin-sdk`), the runner + sandbox
(`packages/operator-core/lib/provision/{runner,sandbox}.ts`), the audit log
(`lib/provision/audit-log.ts` + `provision-audit-bus.ts` → `/api/provision/stream`),
the `harness_shared.operator_claims` PG lock table, the `lib/provision/runtime/lib.sh`
helper, and real plugin scripts under `libs/papercusp/plugins/{github-repo,cloudflare-stack,cloudflare-pages}/provision/`.

The **shipped** `ProvisionScript` type is just `{ path, timeoutSec?, runAt? }`
(note `path`, not `command`); `cloudProvider` / `allowedHosts` /
`skipReprovisionOnPatch` / `auditLogCapMb` live on the parent `PluginProvision`
object, and the runner currently reads only `{ path, timeoutSec }` per script.
The richer manifest fields below (`displayName`, `description`, `network`,
`writesState`, `requiresInteractive`, etc.) describe the design target; some
(e.g. `displayName`/`description`) already appear in real manifests, others are
not yet wired. Treat the examples below as the design, and the SDK type + runner
as the current truth.

Add a `provision` section to `papercusp.json`:

```json
{
  "kind": "plugin",
  "name": "@papercupai/aws-lambda",
  "version": "0.1.0",
  "papercusp": "^0.1.0",
  "capabilities": ["http:fetch:lambda.us-east-1.amazonaws.com", "..."],

  "provision": {
    "platforms": ["linux", "darwin"],

    "setup": {
      "path": "provision/setup.sh",
      "displayName": "Provision AWS Lambda + API Gateway",
      "description": "Creates a Lambda function, an API Gateway HTTP API, and the IAM role binding them.",
      "allowedHosts": ["lambda.us-east-1.amazonaws.com", "execute-api.us-east-1.amazonaws.com", "iam.amazonaws.com"],
      "network": "restrict",
      "timeoutSec": 300,
      "writesState": true,
      "requiresInteractive": false
    },

    "teardown": {
      "path": "provision/teardown.sh",
      "displayName": "Tear down provisioned AWS resources",
      "timeoutSec": 180
    },

    "verify": {
      "path": "provision/verify.sh",
      "displayName": "Check Lambda is healthy",
      "timeoutSec": 30,
      "intervalSec": 600
    }
  }
}
```

Each script is **part of the plugin's signed tarball** — its sha256 is included in the same signature manifest the marketplace already verifies for the plugin itself.

### Field reference

| Field                       | Required                          | Default | Notes                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platforms`                 | no                                | all     | Substrate refuses to run on platforms outside this set; falls back to a clear "this plugin doesn't support your OS" message.                                                                                                                                                                                            |
| `setup.path`                | yes                               | —       | Relative path inside the plugin tarball (the shipped SDK field is `path`). Must be marked executable in the tarball.                                                                                                                                                                                                    |
| `setup.displayName`         | yes                               | —       | Human label shown in the consent dialog.                                                                                                                                                                                                                                                                                |
| `setup.description`         | yes                               | —       | One-paragraph explanation shown to the user before they approve.                                                                                                                                                                                                                                                        |
| `setup.allowedHosts`        | yes for non-cloudProvider plugins | —       | Outbound network restricted to this allowlist. Always blocked even when this list is empty: 169.254.0.0/16 (IMDS), 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1, fd00::/8 — see [Network policy floor](#network-policy-floor).                                                                           |
| `setup.cloudProvider`       | yes for cloud-SDK plugins         | —       | Substrate-curated preset replacing the old `network: "open"` mode. Shape: `{ id: "aws" \| "gcp" \| "azure", region: "us-east-1" \| ... \| "${cfg.region}" }`. Substrate templates region into the preset's allowlist. Multi-region plugins use `regions: [...]`. See [Cloud provider presets](#cloud-provider-presets). |
| `setup.timeoutSec`          | no                                | 600     | Substrate kills the script if it exceeds this. Audit log records the timeout.                                                                                                                                                                                                                                           |
| `setup.writesState`         | no                                | false   | If true, substrate expects the script to drop a JSON file at `$PAPERCUSP_PLUGIN_STATE` on success. Used for resource tracking.                                                                                                                                                                                          |
| `setup.requiresInteractive` | no                                | false   | If false (the default and only V1-supported value), substrate refuses scripts that try to read from stdin or open browser windows mid-run. Forbidden in V1 — see [No interactive subprocesses](#no-interactive-subprocesses).                                                                                           |
| `teardown.path`             | recommended                       | —       | If absent, uninstalling the plugin shows "this plugin can't auto-clean its resources; you'll need to remove them manually."                                                                                                                                                                                             |
| `verify.path`               | recommended                       | —       | Used for plugin health on operator boot. If absent, plugin health is inferred from action invocations.                                                                                                                                                                                                                  |
| `verify.intervalSec`        | no                                | 600     | How often the substrate runs `verify` opportunistically.                                                                                                                                                                                                                                                                |

### Cost estimate field — explicitly dropped from V1

A `provision.setup.costEstimateAdvisory` field was proposed in earlier
drafts of this spec. It has been **removed**. See
[What's NOT in V1](#whats-not-in-v1).

### Network policy floor

Regardless of `allowedHosts` or `cloudProvider` declarations, the
substrate hard-blocks outbound connections to:

| CIDR                                            | Why                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `169.254.0.0/16`                                | Cloud metadata services (AWS IMDS, GCP, Azure) — exfiltrating instance role credentials |
| `127.0.0.0/8`                                   | Loopback — pivoting to other host services (`localhost:5432`, etc.)                     |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC1918 — pivoting to internal infra                                                    |
| `::1`                                           | IPv6 loopback                                                                           |
| `fd00::/8`                                      | IPv6 ULA                                                                                |

Plugins that genuinely need to reach RFC1918 or loopback addresses
(self-hosted database, internal Kubernetes API) must declare each one in
`allowedHosts` explicitly. The floor is non-negotiable in V1; even
`cloudProvider` presets don't bypass it. This closes IMDS-credential
exfiltration and lateral-movement attack classes.

### Cloud provider presets

`network: "open"` (proposed in earlier drafts) has been replaced with
substrate-curated cloud-provider presets that template region-specific
allowlists from the plugin's config:

```json
{
  "provision": {
    "setup": {
      "cloudProvider": {
        "id": "aws",
        "region": "${cfg.region}"
      }
    }
  },
  "configSchema": {
    "properties": {
      "region": { "type": "string", "default": "us-east-1" }
    }
  }
}
```

Substrate substitutes `${cfg.region}` from the plugin config at runtime.
The preset's allowlist (e.g., for AWS: `lambda.${region}.amazonaws.com`,
`s3.${region}.amazonaws.com`, `iam.amazonaws.com`,
`sts.${region}.amazonaws.com`, etc.) becomes the script's effective
allowlist.

Multi-region plugins declare `regions: ["us-east-1", "eu-west-1"]`; the
substrate expands the allowlist for both. Plugins that need a service
not in the preset declare a custom `allowedHosts` extension that's
merged with the preset.

#### Preset maintenance

AWS / GCP / Azure ship new services regularly. Static substrate-bundled
allowlists go stale. Maintenance:

* **Bundled with substrate version** — V1 ships with the latest preset at substrate-build time. Stale presets are a known limitation.
* **Monthly update channel** — substrate fetches `https://presets.papercusp.io/cloud/<provider>-<version>.json`, signed with Papercusp's infrastructure key. Updates are additive (new hosts only); the substrate refuses to apply an update that *removes* hosts without an explicit migration note.
* **Plugin-level overrides** — plugins targeting bleeding-edge services declare custom `allowedHosts` extensions until the next preset update lands.

The update channel is opt-out for offline / air-gapped installs (`PAPERCUSP_DISABLE_PRESET_UPDATES=1`); those installs accept the staleness in exchange for no outbound substrate calls.

#### Consent UI for cloudProvider

When a plugin declares `cloudProvider`, the consent dialog text changes:

```text
This script will reach AWS services in region us-east-1.
The substrate's AWS preset (v2026.05) allows:
  - lambda.us-east-1.amazonaws.com
  - s3.us-east-1.amazonaws.com
  - iam.amazonaws.com  (global service)
  - sts.us-east-1.amazonaws.com
  - 23 other regional service endpoints  [show all]
RFC1918, loopback, and metadata addresses are always blocked.
```

This is *much* more honest than the old "this plugin can reach anywhere
(network: open)" framing.

## Sandboxing and the trust model

Both rounds of review pushed back on the original framing that "signed
scripts may run unsandboxed." Signing proves provenance, not safety —
event-stream and xz-utils are the canonical examples of signed packages
becoming attack vectors.

The substrate runs every provisioning script inside an OS-level sandbox by
default:

| Platform       | Sandbox mechanism                                                                                                                                                                                                                                                                     | Status |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **Linux**      | `bwrap` (bubblewrap) — substrate **bundles its own copy** to avoid distro variance. Smoke-test at first install (`bwrap --ro-bind / / --unshare-all true`); pass → sandbox available; fail → permanent `sandbox_available: false` mark, signed-only mode for the substrate's lifetime | V1     |
| **macOS**      | `sandbox-exec` with a Papercusp-bundled `.sb` profile (deprecated by Apple but functional; meaningful barrier against accidents) **+ signed-only mode for unsigned-script refusal**. No "louder banner" path on macOS — unsigned scripts are refused entirely                         | V1     |
| **macOS (V2)** | Tauri sidecar with restricted entitlements declared in `Info.plist` (no `com.apple.security.network.client` unless `cloudProvider` declared, no filesystem outside plugin-data, etc.). Defense-in-depth on top of sandbox-exec                                                        | V2     |
| **Windows**    | None in V1; signed-only mode required (same policy as macOS)                                                                                                                                                                                                                          | V2     |

### Bwrap smoke test (Linux install flow)

A bundled bwrap binary doesn't help if the kernel disabled unprivileged
user namespaces (Debian's old default, RHEL hardened, some K8s node
images). The substrate runs a smoke test at first install:

```sh
bwrap --ro-bind / / --unshare-all true
```

| Smoke result                                    | Substrate state                                                                                                                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exit 0                                          | `sandbox_available: true` — normal flow                                                                                                                                                                                                                  |
| Exit non-zero, EPERM, or namespaces unavailable | `sandbox_available: false` permanently until next substrate upgrade re-runs the smoke test. Operator switches to **signed-only mode**: refuses unsigned scripts entirely; signed scripts run unsandboxed with explicit one-time per-host acknowledgement |

The mark is mechanical, not banner-spam at runtime. Failure is
policy-driven (kernel policy), not transient — the right disposition is
"refuse unsigned, accept signed with eyes open," not "louder warning
every run."

### Per-run unsandbox escapes

Two narrow escape hatches, both per-run only, neither persistent:

| Env var                               | Purpose                                                                                                                    | Constraint                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `PAPERCUSP_UNSANDBOX_SCRIPT=<sha256>` | Linux: run a signed script outside bwrap (e.g., when the bundled bwrap fails on a host with non-standard kernel hardening) | Hash must match the script's sha256 exactly. Doesn't survive process restart. Logged loudly. |
| `PAPERCUSP_DEV_UNSIGNED=<sha256>`     | Plugin author developing locally on macOS or any platform: skip signature verification for *this specific* script hash     | Same constraints. Used in conjunction with `papercusp plugin install --dev`.                 |

### Dev install flow for plugin authors

Plugin authors iterating on their own `setup.sh` need a path that doesn't
require publishing to the marketplace. The `--dev` install:

```sh
papercusp plugin install --dev /path/to/local/plugin
```

What this does:

* Locally signs the plugin tarball with a **per-machine ad-hoc dev key** (`~/.papercusp/keys/devkey-<machine-id>`). The dev key never leaves the machine.
* Sets `dev: true` on the trust store entry. This flag does NOT auto-migrate when `~/.papercusp/` is copied / restored / synced to another host.
* Consent UI text changes to: "**Dev install** — local machine only. This plugin's signature is from your machine's dev key and will not be trusted on any other host. Output is fully streamed and audited."
* Trust entries with `dev: true` are listed separately in `papercusp trust list` so it's obvious which plugins are dev-signed vs marketplace-signed.

End-users never see a `--dev` install unless someone explicitly hands
them one with that flag. The marketplace flow stays signed-only.

Sandbox restrictions:

* Filesystem: read-write access only to `$PAPERCUSP_PLUGIN_DATA` and the project dir; read-only access to `$PAPERCUSP_PLUGIN_DIR`. Everything else, including `$HOME`, is read-only.
* Network: outbound only to `setup.allowedHosts` when `network: "restrict"` (the default). `network: "open"` lifts this restriction with extra consent.
* Process: child processes inherit the same sandbox.
* No `setuid`, no kernel-level access.

### What signing affects (and what it doesn't)

Signing changes only the consent-flow presentation — not the sandbox boundary:

| Property                                       | Signed (publisher trusted by user)                         | Signed (publisher not yet trusted)                                | Unsigned                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Sandbox enforced?                              | **Yes**                                                    | **Yes**                                                           | **Yes**                                                                                         |
| Consent-UI text                                | "Signed by `@papercupai`. Last 5 versions trusted by you." | "Signed by `@papercupai`. First time you've seen this publisher." | "Unsigned. The script's source has not been verified by any publisher."                         |
| "Trust this publisher's future scripts" toggle | Visible, unchecked default                                 | Visible, unchecked default                                        | Hidden                                                                                          |
| Power-user `--unsandbox` opt-out               | Settings-page toggle, requires CLI confirmation            | Settings-page toggle, requires CLI confirmation                   | Hidden behind `PAPERCUSP_UNSANDBOX_SCRIPT=<hash>` env-var that does not survive process restart |

Convenience scales with trust. Isolation does not.

### Static-analysis warnings

The substrate scans every script for common destructive patterns before
showing the consent dialog. Detected patterns surface as warnings in the
UI — not as hard blocks, because false positives are inevitable:

* `curl ... | bash`, `wget -O- ... | sh` — pipe-from-network-to-shell
* `sudo` invocations
* `rm -rf $HOME` and parent-dir variants (`rm -rf ~`, `rm -rf /`, `rm -rf ../*`)
* `eval` of network input or arbitrary variables
* `chmod -R 777`
* Embedded base64 longer than 256 bytes (often a payload smuggle)

False positives get a "this looks scary but is fine" justification field
in the manifest's `provision.setup.staticAnalysisWaivers`, which the
substrate displays alongside the warning ("the publisher acknowledged this
pattern and explained why it's safe").

## Runtime contract

The substrate provides each script with a controlled environment:

| Variable                  | Purpose                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `$PAPERCUSP_PLUGIN_DIR`   | Absolute path to the plugin's installed directory (read-only, even outside the sandbox)     |
| `$PAPERCUSP_PLUGIN_STATE` | Absolute path to a writeable `state.json` location (write here for resource tracking)       |
| `$PAPERCUSP_PLUGIN_DATA`  | The plugin's per-harness data directory (`<harness>/.papercusp/plugins/<name>/`)            |
| `$PAPERCUSP_HARNESS_SLUG` | The harness slug the script is being run for                                                |
| `$PAPERCUSP_PROJECT_DIR`  | The harness's project dir                                                                   |
| `$PAPERCUSP_RUN_ID`       | Unique id for this script invocation; used by the substrate to correlate audit log + output |
| Plugin config keys        | Each `configSchema` field is exported as `$PAPERCUSP_CFG_<KEY>` (uppercased, underscored).  |

Working directory is set to `$PAPERCUSP_PLUGIN_DATA`. Scripts that need
the plugin install dir use `$PAPERCUSP_PLUGIN_DIR/...`.

The substrate captures stdout + stderr line-by-line and streams them into
an xterm pane in the operator UI. Scripts can also write structured
progress markers:

```bash
echo '::papercusp::progress {"step": "iam-role", "pct": 25}'
echo '::papercusp::progress {"step": "lambda", "pct": 60}'
echo '::papercusp::warn   {"message": "creating in us-east-1; override with $REGION"}'
echo '::papercusp::error  {"message": "iam:CreateRole denied — token missing IAM perms"}'
```

These get parsed and rendered as a structured progress bar above the raw
output. Plugins that don't emit them just show raw output, which is fine.

## No interactive subprocesses

V1 scripts are **non-interactive**. The substrate enforces this:

* stdin is closed (or piped from /dev/null).
* The substrate refuses scripts that try to open a browser window for OAuth (no `xdg-open`, `open`, `start`, etc. — these calls fail under the sandbox).
* Scripts that need user input must take it via configSchema fields up-front. The substrate populates `$PAPERCUSP_CFG_*` before invocation.

Why: interactive scripts hang the operator with no useful UI feedback. A
real-world example is `aws sso login` which opens a browser and blocks
until the user authenticates. The supported workaround is for the plugin
author to require an env-var-only credential (e.g., AWS access keys instead
of SSO), or to split the flow into "user authenticates manually first, then
runs setup" — documented in the plugin's README.

V2 may relax this with a richer interactive-prompt protocol, but it's
deliberately out of V1.

## Idempotency contract

The done-marker for a successful setup is a JSON file at
`<plugin-data>/.papercusp-setup-done`:

```json
{
  "version": 1,
  "runId": "prov-abc123",
  "completedAt": "2026-05-08T20:14:32Z",
  "configHash": "sha256:7a3...",
  "pluginVersion": "0.1.0",
  "scriptHash": "sha256:a1b2c3..."
}
```

The substrate compares **three** values against the current install:

| Compared value  | Source                                                                       | Trigger                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `configHash`    | sha256 of the structural projection of the current per-harness plugin-config | Mismatch → re-provision prompt                                                                                                     |
| `scriptHash`    | sha256 of the current plugin's `setup.path` file content                     | Mismatch → **always** re-provision prompt (script-hash changes can never be auto-applied)                                          |
| `pluginVersion` | semver from the current plugin's manifest                                    | Mismatch → re-provision prompt unless `skipReprovisionOnPatch: true` AND only the patch component changed AND `scriptHash` matches |

| State                                                        | Substrate behavior                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All three match                                              | Setup is "valid"; actions can run normally.                                                                                                                                                                                |
| `configHash` differs                                         | Plugin marked `setup-stale`. Settings UI shows a "Re-provision needed" banner with a button: "Run teardown then setup". Actions block with `setup-required`.                                                               |
| `scriptHash` differs                                         | **Always re-provision prompt, regardless of `skipReprovisionOnPatch`.** A script-hash change implies the publisher (or attacker who compromised the publisher) shipped new provisioning logic — no auto-apply path exists. |
| `pluginVersion` differs (script-hash same, config-hash same) | Re-provision prompt by default. `provision.setup.skipReprovisionOnPatch: true` exempts patch-only bumps when the script and config are unchanged.                                                                          |

### `skipReprovisionOnPatch` semantics

The flag governs **`pluginVersion` mismatches only, when both `scriptHash`
and `configHash` are unchanged**. It does NOT exempt script-hash changes
under any circumstance. The intent is "config-shape didn't change in a
way that affects provisioning, and the script wasn't touched, so a patch
bump (`0.1.0 → 0.1.1`) doesn't need re-prompting."

A malicious publisher pushing a malicious patch with the same major.minor
and `skipReprovisionOnPatch: true` cannot slip through — their script's
sha256 will be different from the recorded one, and that difference
forces re-consent.

### Structural vs operational config fields

Not every config edit should trigger re-provision. A plugin's
`configSchema` distinguishes:

```json
{
  "properties": {
    "region": {
      "type": "string",
      "structural": true
    },
    "accountId": {
      "type": "string",
      "structural": true
    },
    "description": {
      "type": "string",
      "operational": true
    },
    "retryCount": {
      "type": "integer",
      "operational": true
    }
  }
}
```

**Default is `structural`** — re-provisions in doubt. Plugin authors mark
fields `operational: true` to opt out of the prompt. The failure mode of
"defaulting structural" is friction (the user sees a "re-provision?"
prompt on a benign edit and can skip it). The failure mode of
"defaulting operational" is silent stale state, which is what we're
explicitly preventing.

Only fields explicitly marked `structural` (or unmarked, which is the same
thing per the default) are included in the configHash. Operational edits
are applied immediately to the running plugin without re-provisioning.

## State file contract

When `writesState: true`, the script must drop a JSON file at
`$PAPERCUSP_PLUGIN_STATE` before exiting successfully. Shape:

```json
{
  "version": 1,
  "createdResources": [
    { "kind": "aws.lambda.function",   "id": "arn:aws:lambda:us-east-1:123:function:my-fn" },
    { "kind": "aws.iam.role",          "id": "arn:aws:iam::123:role/my-fn-role" },
    { "kind": "aws.apigatewayv2.api",  "id": "abc123" }
  ],
  "outputs": {
    "apiUrl": "https://abc123.execute-api.us-east-1.amazonaws.com",
    "functionName": "my-fn"
  },
  "metadata": {
    "region": "us-east-1",
    "provisionedAt": "2026-05-08T20:14:32Z"
  }
}
```

`createdResources` is what `teardown.sh` consumes — it iterates the list and
deletes each. `outputs` is what the plugin's normal action handlers can read
at runtime (e.g., the Lambda ARN to invoke). `metadata` is opaque to the
substrate, useful for the script itself.

The substrate validates the JSON shape on each script run; malformed state
fails the run with a clear error.

## Recovery contract

V1 uses a **PG-backed operator claim** for cross-machine safety. File-based
heartbeats have classic split-brain failure modes when a harness is shared
across machines (laptop ↔ desktop, dev ↔ CI). Postgres is already the
substrate's coordination point for `harness_shared.*` tables; reusing it
gets distributed-lock semantics for free.

### `harness_shared.operator_claims`

```sql
CREATE TABLE harness_shared.operator_claims (
  harness_slug   text NOT NULL,
  plugin_slug    text NOT NULL,
  machine_id     text NOT NULL,
  pid            int  NOT NULL,
  run_id         text NOT NULL,
  script_hash    text NOT NULL,
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  PRIMARY KEY (harness_slug, plugin_slug)
);
```

### Acquisition + heartbeat

Operator boot sequence for a plugin needing setup:

1. Acquire a PG advisory lock keyed on `hash(harness_slug, plugin_slug)`. Blocks if another operator holds it.
2. Within the lock, check for an existing claim row:
   * No row → insert with `expires_at = now() + 90s`. Proceed.
   * Row exists, `expires_at > now()` → another operator owns it. Release advisory lock; refuse with "another operator owns this harness on machine X (last heartbeat Ns ago); resolve before continuing."
   * Row exists, `expires_at <= now()` (stale) → the previous operator died without releasing. Insert new claim row, prompt user "previous setup may have left orphaned resources. Run teardown to clean up before re-trying?"
3. Release advisory lock; setup proceeds.
4. Background heartbeat job updates `expires_at = now() + 90s` every 30s while setup is running.
5. On clean exit (success or graceful failure), claim row is deleted; advisory lock not needed.

### Multi-machine fork race

Two operators (laptop + desktop) attempting concurrent setup of the same
`(harness, plugin)`:

* Both acquire advisory locks; only one wins (PG serializes them).
* Loser sees the winner's claim row; refuses with the message above.
* Winner runs setup; on completion, claim row is gone; loser can re-attempt.

This eliminates the duplicate-cloud-resource scenario where both
operators successfully `aws lambda create-function` because the cloud
APIs aren't transactional. The substrate's lock is the
arbitration point.

Plugin authors should *also* implement cloud-API-level idempotency
(check-then-create, or use clouds' built-in idempotency tokens) as
defense-in-depth. The PG lock prevents the obvious race; idempotent
scripts handle the residual.

### Single-user host detection

V1 explicitly targets single-user dev/desktop. On first run, the
substrate detects shared-host configurations and prompts a one-time
acknowledgement banner:

| Detection                                                                                                           | Threshold                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Active sessions** (primary): `who \| awk '{print $1}' \| sort -u \| wc -l > 1`                                    | More than one logged-in user. Most reliable signal.                                         |
| **Configured users** (secondary): `/etc/passwd` entries with UID ≥ 1000 + valid `/home/<name>/` + valid login shell | Catches "host has multiple human users configured even if only one is logged in right now." |

Either trigger surfaces:

```text
Papercusp V1 is designed for single-user dev/desktop hosts.
This host appears to have multiple users (laptop is fine; shared
classroom / lab / CI servers are NOT the V1 target).

  Continue on this shared host?  [ Yes — I understand ] [ Cancel ]
```

Once acknowledged, the answer is recorded at `~/.papercusp/single-user-acknowledged`
and the prompt doesn't reappear unless the host's user-count signature changes.

## Trust lifecycle

Trust is granular at the **(publisher, plugin)** level — not per-publisher.
A publisher who ships multiple plugins doesn't get blanket trust on a new
plugin just because the user approved a different one of theirs.

| Event                                                                                                                                    | Effect                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User approves a script with sha `X` from `(publisher P, plugin G)`                                                                       | Records `{publisher: P, plugin: G, publisher_id: <key fingerprint>, scriptHash: X, approvedAt: now}` in the substrate's trust store                                                                                        |
| User checks "trust future signed scripts from `(P, G)`"                                                                                  | Records `{publisher: P, plugin: G, publisher_id: <fingerprint>, trustFuturePatches: true, since: now}`. **Scoped to plugin G only**, not all of P's plugins.                                                               |
| Substrate sees a future script from `(P, G)` with sha `Y ≠ X`, `trustFuturePatches: true`, **same `publisher_id`**, **same plugin name** | Shows a shorter "trusted (publisher, plugin); one-click approve" prompt                                                                                                                                                    |
| Substrate sees a script from `(P, G)` with a `publisher_id` differing from any prior trusted version                                     | **Treats as first encounter.** All cached trust entries for `(P, G)` cleared. Full consent flow runs. (See [Ownership transfer](#ownership-transfer).)                                                                     |
| Substrate sees a script from `(P, NewPluginH)` where the user has `trustFuturePatches: true` for `(P, G)` only                           | Full consent flow runs. The trust toggle does not transfer across plugins from the same publisher.                                                                                                                         |
| Marketplace quarantines or retracts any version of `(P, G)`                                                                              | All trust entries for `(P, G)` cleared. Future encounters require fresh approval.                                                                                                                                          |
| Marketplace quarantines a *different* plugin `(P, OtherPlugin)`                                                                          | All trust entries for `(P, OtherPlugin)` cleared. **Trust on `(P, G)` is preserved** unless that plugin was also flagged. The pure-publisher-quarantine sledgehammer is reserved for evidence of publisher-key compromise. |
| Marketplace publishes a publisher-key compromise advisory                                                                                | All trust entries for any `(P, *)` cleared.                                                                                                                                                                                |

### Ownership transfer

Per-(publisher, plugin) trust is keyed on the **publisher's signing-key
fingerprint** as recorded in the marketplace's per-version metadata. When
a plugin's ownership transfers (e.g., npm-style maintainer addition or
hand-off), the new version's `publisher_id` differs from the cached
trusted version's. The substrate detects this and treats the new
encounter as fresh:

```text
@papercupai/aws-lambda 0.2.0 ships from a different publisher key than 
@papercupai/aws-lambda 0.1.5 (which you trusted on 2026-04-01).

  Old key fingerprint: SHA256:abc...  (last trusted 2026-04-01)
  New key fingerprint: SHA256:xyz...

This may be legitimate (publisher rotated their key — see Marketplace
attestations below) or it may be unauthorized (publisher's key was
compromised). Re-approve only if you can confirm the rotation.
```

This closes the xz-utils-in-miniature attack class: an attacker
becoming a maintainer of an already-trusted plugin doesn't inherit the
prior maintainer's trust.

### Key rotation

A publisher rotating their own signing key (legitimate operation, e.g.,
yearly key rotation) needs to be distinguishable from a compromise.
Solution: **rotation events are countersigned by the marketplace's
infrastructure key**.

```json
{
  "kind": "key-rotation",
  "publisher": "@papercupai",
  "old_key_fingerprint": "SHA256:abc...",
  "new_key_fingerprint": "SHA256:xyz...",
  "rotated_at": "2026-05-12T18:00:00Z",
  "reason": "scheduled rotation",
  "marketplace_signature": "..."
}
```

The substrate refuses to display a "publisher rotated their key" prompt
unless `marketplace_signature` validates against the marketplace's
**pinned infrastructure key** (the substrate ships with this pinned;
rotating it requires a substrate update). An attacker who compromised a
publisher's signing key cannot forge a rotation event, because they
don't have the marketplace's infrastructure key.

When a valid rotation event is observed, the substrate prompts:

```text
@papercupai rotated their signing key on 2026-05-12.
Marketplace confirms the rotation (signature verified).
Reason: scheduled rotation

Re-trust future signed scripts from @papercupai for plugins:
  ☐ @papercupai/cloudflare-pages   (last trusted 2026-04-01)
  ☐ @papercupai/aws-lambda          (last trusted 2026-03-15)
  ☐ @papercupai/github-repo         (last trusted 2026-04-12)

Re-trust applies one plugin at a time.
```

User can re-trust per-plugin or skip. The "trust this plugin's future
scripts" toggle is unchecked by default after every rotation event.

### Compromise + revocation

If a publisher's key is compromised (signaled by marketplace
publishing a `key-compromise` advisory, also countersigned by the
marketplace's infrastructure key):

| Event                                                                          | Effect                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketplace publishes `key-compromise` for fingerprint `K`                     | Substrate refuses to verify any signature against `K`. All trust entries for any plugin signed by `K` flagged `signing_key_compromised: true`.          |
| User invokes a plugin with a compromised signing key                           | Plugin actions and hooks blocked; settings UI shows compromise notice + "this plugin is unsafe to run; uninstall and switch to a different signing key" |
| Publisher publishes new versions signed with a fresh, marketplace-attested key | Substrate accepts these as a new publisher\_id; user re-approves on first encounter                                                                     |

## Consent flow

When the user is about to fork a snapshot containing plugins with
provisioning, or when they enable a plugin with `provision.setup`, the
operator shows:

```text
Approve setup script for @papercupai/aws-lambda
─────────────────────────────────────────────────

Will run: ./provision/setup.sh   (sha256: a1b2c3...)
Display name: Provision AWS Lambda + API Gateway
Description: Creates a Lambda function, an API Gateway HTTP API, and
             the IAM role binding them.

Signed by:    @papercupai (5 previous versions trusted by you)
Sandbox:      bubblewrap (Linux); restricted filesystem + network
Outbound:     lambda.us-east-1.amazonaws.com,
              execute-api.us-east-1.amazonaws.com,
              iam.amazonaws.com
Timeout:      5 min

  [ Show full script source ▼ ]

Static analysis: 0 warnings.

This script will run in a sandbox with the listed restrictions. The
substrate will:
  ✓ Stream all output into a terminal pane you can watch live
  ✓ Capture stdout/stderr to the audit log
  ✓ Track created resources for teardown
  ✓ Refuse to run if the script's hash doesn't match the signed manifest

  ☐ I have reviewed the script.
  ☐ Trust future signed scripts from @papercupai (one-click approve next time)

  [ Approve and run ]    [ Cancel ]
```

For unsigned scripts, the dialog is louder, the "trust future" toggle is
hidden, and the consent text says "**Unsigned**. The script's source has
not been verified by any publisher."

## Re-run policy

`setup` runs **once per (harness, plugin) pair** until the configHash
changes (see [Idempotency](#idempotency-contract)). Once it succeeds,
re-running requires the user to explicitly click "Re-provision" in the
plugin settings *or* the configHash to differ.

If `setup` fails partway through:

* The state file (whatever was written so far) is kept.
* The plugin is marked `setup-failed` in the operator UI.
* The user sees the audit log and the partial state.
* They can re-run setup explicitly (script must be idempotent enough to handle the partial state).

## Teardown semantics

`papercusp plugin uninstall <slug> [--purge-grants]` (which walks every
harness the plugin is enabled in) triggers `teardown` if declared. The flow:

```text
Uninstall @papercupai/aws-lambda from harness `my-store`
─────────────────────────────────────────────────────────

This plugin's teardown script will be run. It will delete:

  • aws.lambda.function   arn:aws:lambda:us-east-1:123:function:my-fn
  • aws.iam.role          arn:aws:iam::123:role/my-fn-role
  • aws.apigatewayv2.api  abc123

These resources will no longer be available after teardown.

  ☐ I have backed up anything I need to keep
  ☐ Approve and run teardown

  [ Run teardown ]    [ Skip teardown (orphan resources) ]    [ Cancel ]
```

If the user picks "Skip teardown", the plugin is uninstalled but the
substrate writes an orphan-resources marker so a later "clean up orphaned
resources" command can find them.

## Verify semantics

`verify` runs:

* After `setup` succeeds (immediate confirmation)
* On every operator boot (best-effort, async)
* **When the plugin's tile is foreground in the operator UI** (visibility-aware) — periodic background polling is *not* the V1 default. Round-3 review noted that 10-min interval polling at scale (5 plugins × 100 harnesses) hits cloud-API rate limits. Foreground-only polling reduces this to "checks happen when the user is looking."
* On demand from the plugin settings UI ("Check health" button)
* Optionally on a periodic background timer if `verify.intervalSec` is set; default is unset (foreground-only).

`verify` should be fast (seconds) and read-only. It exits 0 for "healthy", 1
for "degraded but functional", 2 for "broken". The substrate surfaces these
in the plugin's harness-toolbar tile and in the dashboard summary.

## Audit logging

Every script run writes to `<harness>/.papercusp/audit/provision-runs/<ts>-<plugin>-<phase>.log`:

```
=== papercusp provision run ===
plugin: @papercupai/aws-lambda
version: 0.1.0
phase: setup
script: ./provision/setup.sh
script-hash: sha256:a1b2c3...
sandbox: bubblewrap
network: restrict (allowed: lambda.us-east-1.amazonaws.com, ...)
started: 2026-05-08T20:14:32.123Z
runId: prov-abc123

=== environment ===
PAPERCUSP_HARNESS_SLUG=my-store
PAPERCUSP_PROJECT_DIR=/home/me/projects/my-store
PAPERCUSP_PLUGIN_DIR=/home/me/.papercusp/global-plugins/@papercupai/aws-lambda
PAPERCUSP_CFG_REGION=us-east-1
(secrets redacted)

=== output ===
::papercusp::progress {"step": "iam-role", "pct": 25}
[setup] Creating IAM role aws-lambda-role-my-store...
... (full stream) ...
::papercusp::progress {"step": "done", "pct": 100}

=== exit ===
exitCode: 0
durationMs: 47230
stateWritten: yes
stateBytes: 412
```

### Retention

Audit logs are forensic — they're consulted when something goes wrong
(unexpected cloud bill, suspected compromise, "what changed since last
month"), and the time horizon for noticing those problems is months, not
days.

**V1 default**: 1 year retention, 50 MB per (harness, plugin) cap,
oldest-first eviction within the cap.

The size cap protects against a runaway plugin spamming logs; the
duration protects the actual use case. Provisioning runs are rare (often
once per harness lifetime), so a year of logs is typically under 10 MB per
harness. V1.1 formalizes the policy and adds UI surfaces for browsing
older audit entries.

### Per-plugin override

Plugins doing terraform-class provisioning (K8s cluster bootstrap,
multi-resource Terraform applies) can legitimately emit hundreds of MB.
The 50 MB default would silently evict useful debugging context.

```json
{
  "provision": {
    "setup": {
      "auditLogCapMb": 500
    }
  }
}
```

Surfaced in the consent dialog as a discrete line: "**This plugin
requests up to 500 MB of audit space.**" Lets legitimate plugins
request capacity while flagging it as a thing the user should notice.

### Fail-loud on encrypted-locked volumes

`<harness>/.papercusp/audit/provision-runs/` may live on an encrypted
volume that's locked at boot (LUKS, FileVault, EncFS). If the substrate
can't write to the audit dir, it **fails loud**: setup is refused,
operator banner shows "audit volume unavailable; unlock the volume or
run with `PAPERCUSP_NO_AUDIT=1` (not recommended)." Silent
audit-swallowing is forbidden — the audit trail is the only record of
what scripts did, and losing it silently is a worse failure mode than
refusing to run.

## Relationship to compute:exec:\*

The existing SDK provides a `compute:exec:<bin>` capability for plugins
that need to shell out from action handlers. Build scripts are a separate
mechanism with different properties:

| Surface                                              | Capability-gated?                                                   | Sandbox?                           | Consent flow?                              | Lifecycle                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `compute:exec:<bin>` (action shell-out)              | Yes — declared per-binary in the manifest, enforced at the DI proxy | Capability sandbox + bin allowlist | Granted at install time                    | Runs whenever the action is invoked                           |
| `provision.{setup, teardown, verify}` (build script) | No — declared as a `provision` block, lifecycle-bound               | OS-level sandbox (bwrap on Linux)  | Per-script-hash approval at install / fork | Runs once at setup, once at teardown, periodically for verify |

Both coexist. A plugin can use `compute:exec:git` for in-action git
operations *and* `provision.setup` for one-time AWS provisioning. The
distinction:

* Action shell-outs are routine, capability-gated calls plugged into the
  normal action path (single binary, sandboxed).
* Build scripts are lifecycle infrastructure events with consent
  ceremony, full output streaming, and resource lifecycle tracking.

V1.1 will add explicit cross-references between the two in the SDK docs.

## Helper library: `provision/lib.sh`

The substrate ships a small helper library that plugin scripts source.
Its path is provided to the script in `$PAPERCUSP_RUNTIME_LIB` (source is
`packages/operator-core/lib/provision/runtime/lib.sh`); scripts source it
by the standard pattern:

```bash
#!/usr/bin/env bash
set -euo pipefail
. "$PAPERCUSP_RUNTIME_LIB"

papercusp_progress "step:iam-role" "creating role $ROLE_NAME"
ROLE_ARN=$(aws iam create-role ...)
papercusp_record_resource "aws.iam.role" "$ROLE_ARN"

papercusp_progress "step:lambda" "creating function $FN_NAME"
FN_ARN=$(aws lambda create-function ...)
papercusp_record_resource "aws.lambda.function" "$FN_ARN"
```

### Helpers exposed in V1

| Helper                                                | Purpose                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `papercusp_progress <step> <message>`                 | Emits a `::papercusp::progress` marker. UI renders a structured progress bar.                                                                                                                   |
| `papercusp_warn <message>`                            | Emits a `::papercusp::warn` marker. UI renders a yellow indicator.                                                                                                                              |
| `papercusp_error <message>`                           | Emits a `::papercusp::error` marker. UI renders a red indicator (script may still continue or exit).                                                                                            |
| `papercusp_record_resource <kind> <id> [<meta-json>]` | Appends `{kind, externalId, recordedAt, metadata?}` to the resource WAL (via `$PAPERCUSP_RECORD_FIFO`) *immediately* (not at success). Substrate uses this for partial-failure rollback.        |
| `papercusp_state_set <key> <value>`                   | Sets a key in `state.json` `outputs` (same FIFO, `$op: "state_set"`).                                                                                                                           |
| `papercusp_render_templates`                          | Walks `$PAPERCUSP_PROJECT_DIR` for `*.tmpl` files, renders each via `envsubst` with the script's exported env, writes the de-suffixed result, removes the `.tmpl` source. Skips VCS/build dirs. |

### Partial-failure rollback via `record_resource`

Real provisioning scripts often create resources in dependency order.
If step 3 of 5 fails, the substrate already knows about the 2 successful
resources because they were recorded at the time of creation:

```text
Setup script @papercupai/aws-lambda failed at step "lambda" (exit 1).

The script created these resources before failing:
  • aws.iam.role           arn:aws:iam::123:role/my-fn-role
  • aws.iam.role-policy    my-fn-policy

Tear down these resources before re-trying setup?
  [ Yes — run teardown ]    [ No — keep them, fix the script first ]    [ Audit log ]
```

If the user picks teardown, the substrate runs `teardown.sh` with a
state.json containing only the recorded-so-far resources. Plugin
authors don't have to write defensive "did this fail in stage X?" logic
in setup; partial state is captured and tear-downable.

`papercusp_record_resource` writes are atomic appends to a
write-ahead log; the substrate compacts them into `state.json`'s
`createdResources` array on next read. This means even a hard kill of
the script (SIGKILL) preserves what was recorded.

### Teardown contract: plugin's `teardown.sh` is the dispatcher

Resource kinds (`aws.iam.role`, `aws.lambda.function`, etc.) are
plugin-author vocabulary, not substrate-defined types. `teardown.sh`
receives the recorded resources via `state.json` and dispatches per
kind:

```bash
#!/usr/bin/env bash
set -euo pipefail
. "$PAPERCUSP_RUNTIME_LIB"

# Read recorded resources from state.json (passed via $PAPERCUSP_PLUGIN_STATE)
mapfile -t RESOURCES < <(jq -c '.createdResources[]' "$PAPERCUSP_PLUGIN_STATE")

# Tear down in REVERSE creation order (LIFO)
for resource in "${RESOURCES[@]}" | tac; do
  kind=$(echo "$resource" | jq -r .kind)
  id=$(echo "$resource" | jq -r .id)
  case "$kind" in
    aws.lambda.function)
      aws lambda delete-function --function-name "$id" || \
        papercusp_warn "lambda delete failed: $id"
      ;;
    aws.iam.role)
      aws iam delete-role --role-name "$id" || \
        papercusp_warn "role delete failed: $id"
      ;;
    *)
      papercusp_warn "unknown kind in teardown: $kind ($id)"
      ;;
  esac
done
```

The substrate does **NOT** interpret resource kinds in V1. It hands the
plugin's `teardown.sh` the recorded list and expects the plugin to do
the right thing. If `teardown.sh` doesn't handle a `kind`, the resource
is reported as orphaned in the audit log + the user-visible orphan-banner
(see [Skip teardown banner](#skip-teardown-banner-v11)).

V2+ may add a substrate-level dispatcher with built-in handlers for
common cloud resource kinds. V1 keeps the contract simple: plugin author
owns the dispatch.

## Run timing (V1.1)

V1 always runs `setup` at install / fork time. V1.1 adds a manifest field
to control when setup fires:

```json
{
  "provision": {
    "setup": {
      "path": "provision/setup.sh",
      "runAt": "fork"          // "fork" (default) | "install" | "first-action"
    }
  }
}
```

### Behavior per surface when setup hasn't yet run

The `setup-required` state affects every plugin surface, not just actions:

| Surface                                         | Behavior when setup hasn't run                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action invocation**                           | Substrate returns `{ok: false, error: "setup-required", setupUrl: "..."}`. Matches existing capability-denied shape. UI shows a "this plugin needs initial setup" banner with a one-click button. No UI hang.                                                       |
| **Lifecycle hook fire** (e.g., `onMissionDone`) | Hook event is **queued** (FIFO, capped at 10 events per `(plugin, harness)`). After setup completes within `setupCompletionWindowMin: 30` (default), queued events replay in order. After 30 min or 10-event overflow, dropped events are written to the audit log. |
| **Routine fire** (cron-style scheduled)         | Same queue-and-replay as hooks, with the same 10-event cap.                                                                                                                                                                                                         |
| **Incoming webhook**                            | Substrate responds 503 to the webhook caller. **Not queued** — incoming webhooks shouldn't accumulate, and the external caller can retry with their own backoff. Audit log records the rejection.                                                                   |

### Queue overflow surfacing

The 10-event hook queue cap is a real ceiling. When events are dropped:

* Audit log entry per dropped event (kind, payload, original-fire-time, drop-reason)
* **Persistent badge on the plugin's settings tile**: "N hook events dropped during setup. \[View audit log]" — until user explicitly acknowledges by clicking the badge

The badge prevents the silent-drop failure mode where the user has no
idea their plugin missed events because setup took too long.

### Run-timing options

(The shipped SDK `runAt` enum is `'fork' | 'install' | 'first-action'`;
`"install"` runs setup at plugin-install time rather than at fork. The
`"manual"` mode described here is a design target not yet in the enum.)

`runAt: "manual"` puts setup behind a "Run setup" button in plugin
settings, never auto-fires. Useful for heavyweight optional plugins
(e.g., a plugin that provisions a managed K8s cluster — defer until the
user explicitly opts in).

`runAt: "first-action"` defers setup until the first action / hook /
routine that needs it. The first such fire returns `setup-required` (for
actions) or queues + prompts (for hooks/routines). Useful for plugins
where many users install but only some end up using the provisioned
infra.

## Skip-teardown banner (V1.1)

When a user picks "skip teardown" during uninstall, the orphan-resources
marker is written and the plugin is removed. To prevent silent cost
leak (a user who skipped teardown in haste and forgot), the operator's
home tile surfaces a passive banner after 7 days:

```text
You have 3 orphan resources from 2 uninstalled plugins.
   • aws.lambda.function (from @papercupai/aws-lambda, uninstalled 14 days ago)
   • aws.iam.role × 2

Run `papercusp orphans cleanup` to inspect and (optionally) tear them down.
```

No budget enforcement here — that's V1.1's `budgetCap` work. This is
just visibility for "I forgot I left infra running." V1.1 line item.

## Plugin "host activity" settings tile (V1)

A plugin that uses both `compute:exec:<bin>` (for in-action shell-outs)
*and* `provision.{setup,...}` (for one-time provisioning) has two
distinct host-execution surfaces with two consent flows. From the user's
point of view that's confusing — "this plugin runs scripts on my host"
is true twice.

The plugin's settings tile gains a single **"Host activity"** section
listing both:

```text
Host activity
─────────────────────────
Provisioning scripts (one-time, with consent gate):
  ✓ provision/setup.sh    (run 14 days ago, exit 0)
  ✓ provision/verify.sh   (last run 2 min ago, healthy)
    provision/teardown.sh  (not yet run)

In-action shell-outs (runs on every action invocation, capability-gated):
  • git, gh                   (compute:exec:*)
```

Single visual surface, two underlying mechanisms. User sees the full
host-activity surface in one place; substrate's internal capability
distinction stays as documented.

## What's NOT in V1

| Item                                        | Why deferred                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provision.setup.costEstimateAdvisory`      | The two reviewers correctly flagged this as theater: a number with no enforcement is worse than no number. **V1.1** adds `provision.setup.budgetCap: { aws: { monthlyUsd: 5 } }` wired to AWS Budgets via a substrate helper (\~150 LOC, AWS-only). When that lands, costs are *enforced*, not advertised. |
| Layer-7 network proxy with TLS interception | V1 enforces network restrictions via the OS sandbox (bwrap blocks the syscall when a host is undeclared). V2 adds a layer-7 proxy with TLS interception for richer per-request observability.                                                                                                              |
| Encrypted-at-rest token storage             | V1 target is single-user dev/desktop; encryption-at-rest matters for shared-host scenarios that aren't the V1 target.                                                                                                                                                                                      |
| `runAt` scheduling                          | V1.1, per above. V1 always runs at install/fork.                                                                                                                                                                                                                                                           |
| Interactive subprocess support              | V2 may relax with a richer interactive-prompt protocol; V1 forbids.                                                                                                                                                                                                                                        |
| Per-cloud `budgetCap` helpers beyond AWS    | V2. AWS-Budgets ships in V1.1 as the dogfood; GCP/Azure/Cloudflare follow as plugin authors demand them.                                                                                                                                                                                                   |
| Marketplace moderation gate                 | The plan acknowledges this as a known gap (no review currently happens at publish time). A separate spec doc will cover the moderation layer.                                                                                                                                                              |

## Open issues moved to dedicated review

The remaining design questions (cross-platform commitments, signing
infrastructure rollout, multi-publisher trust accumulation) are in the
[Open Questions](./open-questions) page with explicit V1 / V1.1 / V2
disposition.
