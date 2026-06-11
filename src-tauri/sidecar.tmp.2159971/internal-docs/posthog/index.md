# PostHog
URL: /internal/docs/posthog/index

How Papercusp self-hosts PostHog, what it's used for today (feature flags only), and the privacy contract for shipped builds.

Papercusp runs a self-hosted PostHog instance for feature-flag management. Analytics, session replay, surveys, error tracking, and LLM observability are **deliberately not enabled** for V1, but the platform is installed so they can be turned on later without re-architecting.

## What this section covers

* **[Feature flags](./feature-flags)** — every flag, how to flip them, how they're wired into the operator, the V1 ship contract, and the admin UI.

This index page covers PostHog as a platform: what's deployed, where, the privacy contract, and ops notes. Subsections cover specific features built on top.

## Why self-host

Two reasons matter:

* **Privacy posture.** Shipped Papercusp builds make zero outbound requests to anything PostHog-related by default. The desktop binary doesn't include any PostHog client code paths in the customer's bundle. The bundled server reads a file (`~/.papercusp/posthog.json`); if it's absent or has `testingFeatures: false`, no connection to PostHog ever happens.
* **Control.** Flags + future analytics live on infrastructure we operate. No third-party flag service to migrate off if the relationship sours, no per-MAU pricing tier to mind.

The trade is real: we operate the server. Two ingestion services on the box currently crash-loop on every restart cycle — harmless for flags but worth knowing about (see [Known issues](#known-issues)).

## Where it runs

| Resource      | Value                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Domain        | `flags.papercuspai.com`                                                     |
| Host          | Hetzner CX52 — also runs Defguard mesh + Caddy                              |
| Compose path  | `/opt/posthog/`                                                             |
| Compose files | `docker-compose.hobby.yml` + `docker-compose.override.yml`                  |
| TLS           | Let's Encrypt, terminated by the shared Defguard Caddy                      |
| Reverse proxy | Caddy → `posthog-web:8000` over docker network `papercusp-edge`             |
| Auto-start    | systemd unit `posthog.service` (enabled)                                    |
| Discovery     | Cloudflare A record, **DNS only** (proxy off — Caddy needs port 443 for LE) |

## Ports and topology

```
                    Cloudflare (DNS only, no proxy)
                              │
                  flags.papercuspai.com → 178.105.127.33
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Hetzner CX52 — Ubuntu 24.04                                │
   │  ┌────────────────────────────────────────────────────────┐ │
   │  │  Defguard Caddy (TLS terminator, free LE cert)         │ │
   │  └─────┬──────────────────────────────────┬───────────────┘ │
   │        │ mesh.papercuspai.com             │ flags.…         │
   │        ▼                                  ▼                 │
   │  defguard-core:8000                  posthog-web:8000       │
   │                                                             │
   │  Docker networks:                                           │
   │    - papercusp-edge  (shared: defguard-caddy + posthog-web) │
   │    - defguard_default  (defguard internals)                 │
   │    - posthog_default   (posthog internals)                  │
   └─────────────────────────────────────────────────────────────┘
```

## Privacy contract (what the shipped binary does)

The operator code reads its PostHog configuration from a single source — the discovery file `~/.papercusp/posthog.json` — and decides at runtime whether to contact PostHog at all. The resolution order is:

1. **Env vars** — `PAPERCUSP_POSTHOG_HOST` + `PAPERCUSP_POSTHOG_KEY` + optional `PAPERCUSP_POSTHOG_TESTING_FEATURES`. For CI and explicit dev overrides.
2. **Discovery file** — `~/.papercusp/posthog.json`. The canonical home for the project key + personal API key + the `testingFeatures` flag.
3. **Unconfigured** — no file, no env. The operator falls through to `FLAG_DEFAULTS` (the V1 ship state — every flag off). No outbound request happens. `/api/flags/bootstrap` returns `source: "defaults"`. (The discovery-file *resolver* reports `source: "unconfigured"` for the un-configured case, but the flag-bootstrap payload's `source` is always one of `defaults` / `posthog` / `override`.)

A fresh install on an end-user machine ends up in path 3 by default. To opt into PostHog contact, the user (or admin) must either:

* Drop a discovery file with `testingFeatures: true`, or
* Set `PAPERCUSP_POSTHOG_TESTING_FEATURES=true` in their environment.

There is no other path. The discovery file is **not** shipped inside the desktop installer; the build pipeline strips it.

## Discovery file schema

`~/.papercusp/posthog.json` — written by an admin once on a dev machine, never by the shipped app:

```json
{
  "version": 1,
  "host": "https://flags.papercuspai.com",
  "projectKey": "phc_xxx",
  "personalApiKey": "phx_xxx",
  "projectId": 1,
  "testingFeatures": false,
  "webhookSecret": ""
}
```

| Field             | Required when `testingFeatures: true` | Purpose                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`            | yes                                   | PostHog server URL                                                                                                                                                                                                                                                                                                                                      |
| `projectKey`      | yes                                   | The public `phc_…` project token. Used by `posthog-node` to identify the project.                                                                                                                                                                                                                                                                       |
| `personalApiKey`  | yes                                   | The private `phx_…` key. Needed for **local flag evaluation** (the SDK polls flag definitions every 10s and evaluates in-process — fast, no per-request round-trip). Without this the SDK falls back to remote evaluation with different semantics.                                                                                                     |
| `projectId`       | no                                    | PostHog's numeric project id. Informational only — the flag-flip + dashboard-URL code addresses the project as `@current` (resolved from the personal API key), so this field isn't read by the resolver (`packages/operator-core/lib/posthog-config.ts` only consumes `host` / `projectKey` / `personalApiKey` / `testingFeatures` / `webhookSecret`). |
| `testingFeatures` | n/a                                   | The master switch. `false` (default) means "never phone home." `true` means "fetch flag definitions live."                                                                                                                                                                                                                                              |
| `webhookSecret`   | no                                    | If set, validates incoming `POST /api/flags/webhook` calls from PostHog so live flag flips can fan out via SSE. Optional; absent means clients refresh on a polling interval instead.                                                                                                                                                                   |

File permissions are `0600` so it's not world-readable.

## Admin access

Admins use the **Admin → Features** tab in the operator (`/admin/features`) to flip flags, including the master switch. The admin section is loopback-only (operator binds `127.0.0.1:3055` by default) and intentionally unlinked from the nav — reach it by typing the URL.

See [feature-flags](./feature-flags) for the full UI walkthrough.

## PostHog UI

When `testingFeatures: true` is set, the PostHog dashboard is reachable at `https://flags.papercuspai.com`. Credentials are stored in `/opt/posthog/credentials.env` on the Hetzner box. The dashboard is the authoritative source for flag history — every flip is logged with timestamp + actor.

## Known issues

* **`posthog-ingestion-error-tracking` and `posthog-ingestion-general` crash-loop**. They retry connecting to Kafka and exit cleanly every \~30s. Cosmetic — these services handle inbound event capture, which we don't use yet. Will resolve when analytics is turned on later (or when their compose config is fixed for hobby-style deployments).
* **No webhook configured upstream**. PostHog→operator `/api/flags/webhook` isn't wired in the PostHog UI. Live SSE flag-flip notifications use the SDK's 10-second polling interval instead. Acceptable for now; flag flips aren't user-frequent.

## Future enabling

Each of the disabled PostHog surfaces can be turned on without re-architecting:

* **Analytics** — `posthog-node` `capture()` calls from server code; the operator already initializes the client. Currently disabled by skipping `capture` calls entirely.
* **Session replay** — needs `posthog-js` in the client bundle. Out of scope today because we ship zero PostHog code in the customer bundle. When we enable it, we'd ship the JS but only fire `capture()` after explicit user opt-in via `/settings/privacy`.
* **LLM observability** — wrap the Anthropic / OpenAI clients with `@posthog/ai/anthropic` (`withTracing`). Free for the first 100k generations/mo on hobby. Ready when we decide to instrument.
* **Error tracking** — wire `posthog.captureException` server-side; needs no client SDK.

The build-time contract that *no PostHog code reaches end-user bundles unless they opt in* must be preserved whenever any of these are turned on.
