# Spawnable templates
URL: /internal/docs/spec/spawnable-templates

Marketplace contract for templates that other harnesses can spawn as children.

> **Webapp retired (2026-05-14).** Any `localhost:3055` or `localhost:3070` URL on this page is only reachable while the **Tauri dev shell** is running. Start it with `cd papercusp-desktop && npm run dev`.

import { Aside } from '@astrojs/starlight/components';

The spawnable-template contract here remains live for the `scaffold_harness`
executor verb (`GET /api/marketplace/spawnable` →
`packages/operator-core/lib/spawnable-templates.ts`). The newer
`harness:create` MCP path instead instantiates a **blueprint** (`blueprintId`
resolved local → installed → built-in, e.g. `coding` / `research`); that is the
preferred way to author a new managed harness going forward.

A marketplace template is **spawnable** if its `papercusp.json` declares a `spawnable` field:

```json
{
  "name": "papercup-coding",
  "version": "0.1.1",
  "spawnable": {
    "kind": "coding",
    "requires": ["spec", "goal"]
  }
}
```

Without this field, the template can be installed manually by a user but cannot be spawned by another harness's `scaffold_harness` action — the executor rejects with `400 template_not_spawnable`.

## Recognized `kind` values

* `coding` — a coding harness (scoper / worker / validator loop), drives one project to DONE.
* `service` — a long-running service-shaped harness (e.g. a recurring data pipeline).
* `org` — a parent-of-children harness with director / coordinator / auditor roles. **Org templates are themselves NOT spawnable** — they're top-level installs only. Don't mark org-kind templates as spawnable.

The `kind` is informational for now; the executor doesn't enforce it on the parent's role. v2 may gate which `kind` of children a parent role can spawn.

## `requires` fields

Declarative metadata listing the fields a parent should supply in the `scaffold_harness` action body. Today the executor (`doScaffoldHarness` in `packages/operator-core/lib/execute-action.ts`) hard-validates only `template` + `spec` as non-empty; the per-template `requires` list is surfaced to the spawning role's prompt (and echoed in the `dryRun` result) but is **not** itself enforced per-field at the executor yet.

```ts
"requires": ["spec", "goal"]
// declares that a parent should pass action.spec and action.goal
```

## Discovery

The substrate exposes spawnable templates via `GET /api/marketplace/spawnable`:

```bash
curl http://localhost:3055/api/marketplace/spawnable
# → { "spawnable": [ { name, version, spawnable: {...}, source: "local"|"catalog" }, ... ] }
```

Local-installed templates (the active workspace's `.papercusp/harnesses/<name>/papercusp.json` — `PAPERCUSP_HARNESSES_DIR`, default `~/.papercusp[-workspaces/<id>]/.papercusp/harnesses`) take precedence over remote-catalog entries with the same name. The merged list (`getSpawnableTemplates` in `packages/operator-core/lib/spawnable-templates.ts`, 10s TTL cache) is what every spawning role's prompt-build lists in its Tier 3 capabilities section so the director picks valid templates.

## Versioning

Adding `spawnable` to an existing manifest is an **additive change**; bump the patch version (e.g. `0.1.0` → `0.1.1`) and re-publish. See [marketplace-versioning](/internal/docs/spec/marketplace-versioning).
