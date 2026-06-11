# Branch buttons
URL: /internal/docs/plugins/branch-buttons

How a plugin contributes branch-scoped action buttons.

A plugin can contribute action buttons that appear in the harness's
`actions ▾` menu for a specific branch (`staging`, `testing`, or
`production`). Two contribution shapes are supported:

## 1. URL-based buttons (recommended)

Declare in your plugin's `papercusp.json`:

```json
{
  "name": "@scope/myplugin",
  "buttons": {
    "staging":    { "build": "/api/plugins/@scope/myplugin/build-staging" },
    "production": {
      "build": {
        "url": "/api/plugins/@scope/myplugin/build-prod",
        "displayName": "Build & deploy (prod)"
      }
    }
  }
}
```

When the user clicks the button, the substrate `POST`s to the URL with
JSON body:

```json
{
  "harness": "<harness-slug>",
  "branch":  "staging|testing|production",
  "button":  "<button-name>",
  "runId":   "<unique-id>",
  "env":     { "RESOLVED_VAR": "..." }
}
```

Your handler can return:

* `text/event-stream` — SSE; every `data:` line is forwarded verbatim
  to the user's xterm modal. Use this for long-running build/deploy
  scripts so the user sees progress.
* `application/json` or `text/plain` — one-shot; the body is shown as
  a single output line.

Non-2xx responses mark the run as `failed` with the HTTP status as the
exit code.

URLs are resolved against the operator's origin (`selfUrl()`). Most
plugins point at their own routes mounted under `/api/plugins/<slug>/...`,
but any operator-relative or absolute URL works.

### Example handler (plugin `apiRoutes` — a Hono app)

A plugin exposes HTTP routes by declaring `apiRoutes` (a Hono app, or any
object with a `.fetch(req)` method) in its manifest; the operator mounts
it under `/api/plugins/<slug>/...` (see
`packages/operator-core/lib/plugin-api-mount.ts`). The handler receives a
standard Web `Request` and returns a `Response`:

```ts
// plugin apiRoutes (Hono)
import { Hono } from 'hono';

export const apiRoutes = new Hono().post('/build-staging', async (c) => {
  const { harness, branch, button, runId, env } = await c.req.json();
  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (s: string) => ctrl.enqueue(enc.encode(`data: ${s}\n\n`));
      send(`Starting ${button} for ${harness}/${branch}…`);
      // …do work…
      send(`Done.`);
      ctrl.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream' },
  });
});
```

## 2. Script-based contributions

For plugins that prefer to ship a bash script rather than mount an
endpoint, declare `branchActions` instead. See
[/docs/snapshots/build-scripts](/internal/docs/snapshots/build-scripts) for the
full schema (env resolution, manifest fields).

```json
{
  "branchActions": {
    "deploy": {
      "branches": ["staging", "production"],
      "scriptPath": "actions/deploy.sh",
      "env": {
        "TOKEN": { "from": "config", "field": "apiToken", "required": true }
      }
    }
  }
}
```

The substrate spawns `bash <pluginDir>/<scriptPath>` with env merged from
`plugin-configs/<plugin>.json` per the manifest.

## Naming + collision

Both forms expose the action as `<plugin-slug>:<button-name>` in the UI
so two plugins shipping a "deploy" button never clash.
