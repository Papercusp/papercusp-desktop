# 16. Publishing — hosted Cloudflare publishing (v3)
URL: /internal/docs/spec/publishing



import { Aside } from '@astrojs/starlight/components';

**Publishing** — one-click public publishing from coding harnesses.
Worker (`apps/papercusp-publish/`), shared auth lib
(`libs/papercusp-publish-auth/`), substrate plugin
(`@papercupai/cloudflare-pages-hosted`), and Settings UI all landed
2026-04-28. Live deployment waits on \`wrangler d1/kv create + secret put

* deploy`and a wildcard cert on`\*.preview\.papercuspai.com\`.

Three rounds of architectural review have been incorporated (v1 → v2 →
v3). Once a real user publishes their first project this page folds into
§7 (Plugin extension points) and §11 (Distribution).

## 15.0 Why this exists

A non-technical user runs a coding harness, describes what they want in
plain English, watches the harness build it, and clicks **Publish**. Within
\~30 seconds they get a public URL they can share. **They never touch a
Cloudflare credential, never create an API token, never pre-create a
project.**

Without this, "ship the app" is a half-day of Cloudflare onboarding for
the user — a step where the AI-built-an-app value proposition crashes
into "log into Cloudflare, generate a Pages:Edit token with these exact
permissions, copy your account UUID from the right sidebar..." and the
user gives up.

The mechanism is a hosted publish service we run, fronting our own
Cloudflare account. Users borrow our infra; we hold the master token; the
content's served on a vanity subdomain we control.

## 15.1 Goals + non-goals

**Goals**

* One click from harness header → live public URL within \~30 seconds.
* Zero credentials handled by the user, ever.
* Coding harness only — `papercup-org` parents and other non-coding
  templates do not get a Publish button.
* Bounded blast radius if our master Cloudflare account is suspended:
  every user can recover their projects without our infra.

**Non-goals (v1)**

* Custom user-owned domains. v1 deploys to `*.preview.papercuspai.com`.
* Private/access-gated deployments. v1 is fully public; private mode is
  spec'd here but built later.
* Build pipelines. v1 publishes static files from `<project>/<exportDir>`;
  the harness already produced the output.
* Paid-tier billing. Schema supports `tenants.tier` from day one;
  enforcement of paid limits comes later.

## 15.2 Architecture

```text
┌────────────────────────────┐         ┌───────────────────────────────────┐         ┌─────────────────┐
│  user's coding harness     │         │  publish.papercuspai.com           │         │   Cloudflare    │
│  (substrate at :3055)      │         │  (Worker + D1 + KV + R2)          │         │   Pages API     │
│                            │         │                                   │         │                 │
│  click Publish             │         │  POST /publish/start              │         │                 │
│   ↓                        │         │  ├─ JWT validate (HS256+jti+sha)  │         │                 │
│  walks out/, computes      │  jwt+   │  ├─ replay check (D1 unique-key)  │         │                 │
│  per-file sha256 +         ├────────►│  ├─ rate-limit (KV burst+daily+IP)│         │                 │
│  canonical manifest        │ manifest│  ├─ ensure CF project (D1 cache)  │         │                 │
│  POSTs                     │         │  └─ returns deploymentId +        │         │                 │
│   ↓                        │         │      missing-files upload URLs    │         │                 │
│  PUT each file             ├ stream ►│  proxy stream (no buffer)         ├ master ►│  /files         │
│  (only the missing ones)   │         │  ┌─ verify per-file sha256        │  token  │                 │
│   ↓                        │         │                                   │         │                 │
│  POST /publish/finalize    ├────────►│  ├─ create CF deployment          ├────────►│  deployments    │
│                            │         │  └─ archive manifest+files to R2  │         │                 │
│   ↓                        │         │                                   │  status │                 │
│  poll /status/:depId       ├────────►│  ── returns CF status             │◄────────┤                 │
│   ↓                        │         │                                   │         │                 │
│  toast: live at <vanity>   │         │  *.preview.papercuspai.com via     │         │                 │
└────────────────────────────┘         │  Worker route → CF Pages auto     │         │                 │
                                       │  subdomain                        │         │                 │
                                       └───────────────────────────────────┘         └─────────────────┘
```

## 15.3 Data model

### D1 — durable state

```sql
CREATE TABLE tenants (
  id              text primary key,           -- tnt_<10-base32>
  secret_hash     text not null,              -- HMAC-SHA256(secret, HASH_PEPPER)
  secret_hash_v   int  not null default 1,    -- KDF version, for rotation
  rotated_from    text,                       -- previous tenant id, audit
  created_at      int  not null,              -- epoch ms
  last_used_at    int,
  last_ip         text,
  status          text default 'active',      -- active | revoked | banned
  tier            text default 'free',        -- free | paid | self-host-byo
  notes           text                        -- admin notes
);

CREATE TABLE projects (
  tenant_id        text not null references tenants(id),
  harness_slug     text not null,
  cf_project_name  text not null,             -- sha256(secret||harness)[:16] + "-" + sanitize(harness)
  cf_subdomain     text,
  vanity_subdomain text,                       -- "<harness>-<rand>" on preview.papercuspai.com
  created_at       int not null,
  primary key (tenant_id, harness_slug)
);

CREATE TABLE deployments (
  id               text primary key,           -- dep_<8-base32>
  tenant_id        text not null references tenants(id),
  harness_slug     text not null,
  cf_deployment_id text not null,              -- NOT NULL: row only inserted after CF returns
  vanity_url       text,
  manifest_sha     text,                       -- canonical manifest sha256, audit + dedup
  archive_path     text,                       -- R2 key: "<tenant>/<deployment>/" prefix
  bytes_total      int,
  files_count      int,
  status           text default 'building',    -- pending_create | uploading | building | live | failed
  failure_reason   text,
  created_at       int not null,
  completed_at     int
);

-- Replay protection — atomic via PRIMARY KEY (D1's serializable per-DB transactions)
CREATE TABLE jti_used (
  jti  text primary key,
  exp  int not null
);

-- Audit log — kept indefinitely for CF abuse responses
CREATE TABLE audit_publishes (
  id              integer primary key autoincrement,
  tenant_id       text not null,
  harness_slug    text not null,
  deployment_id   text,
  ip              text,
  ua              text,
  manifest_sha    text,
  bytes_total     int,
  outcome         text,                       -- ok | rate_limited | invalid_jwt | banned | upload_failed | cf_error
  ts              int not null
);
CREATE INDEX idx_audit_ts             ON audit_publishes(ts);
CREATE INDEX idx_audit_tenant_ts      ON audit_publishes(tenant_id, ts);
CREATE INDEX idx_audit_harness_ts     ON audit_publishes(harness_slug, ts);
CREATE INDEX idx_audit_ip_ts          ON audit_publishes(ip, ts);
```

### KV — counters + ephemeral state

| Key                                 | Purpose                                                                             | TTL    |
| ----------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| `ratelimit:burst:<tenantId>`        | per-tenant 5/min                                                                    | 60s    |
| `ratelimit:daily:<tenantId>`        | per-tenant 50/day free, 500/day paid                                                | 86400s |
| `ratelimit:ip-publish-daily:<ip>`   | 50/day per IP, **independent of tenant** (closes the wipe-and-re-register loophole) | 86400s |
| `ratelimit:ip-register-hourly:<ip>` | 10/hour per IP on `/register-tenant`                                                | 3600s  |
| `upload:<deploymentId>:<sha256>`    | per-file upload token state                                                         | 900s   |

### R2 — artifact retention (the eject path's fire exit)

Bucket `papercusp-publish-archive`. At `/publish/finalize` *after* CF
deployment succeeds, write:

```
<bucket>/<tenantId>/<deploymentId>/manifest.json
<bucket>/<tenantId>/<deploymentId>/files/<sha256>.bin    ← per file
```

Lifecycle: **30 days for free tier, 1 year for paid**. Cron deletes
expired prefixes.

The eject script reads from R2, *not* CF Pages API. R2 is a separate
product on the same account; suspension scopes can differ. If both R2
and Pages are nuked, the substrate still has the source on the user's
local machine (`<project>/<exportDir>`) and can re-upload to BYO-CF —
two independent recovery paths.

R2 cost: \~$0.015/GB-month. Typical site is \~5 MB; 1k tenants ≈ 5 GB ≈
$0.07/mo. Pennies.

## 15.4 Authentication + replay protection

### Per-substrate handshake — one time

`POST publish.papercuspai.com/register-tenant` with `Content-Type:
application/json`, body `{}` (anonymous v1 — when OAuth ships,
auth header binds the tenant to a user account). Returns:

```json
{ "tenantId": "tnt_a3kf9xe2pq", "tenantSecret": "<32-byte base64url>" }
```

Stored in `~/.papercusp/publish-credentials.json` (chmod 600). The
`tenantSecret` is high-entropy machine-generated — argon2's slow-hash
advantage doesn't apply here, so we use HMAC-SHA256 with a server-side
`HASH_PEPPER` for \~µs verification.

### Per-publish JWT

```
header  { alg: "HS256", typ: "JWT" }
claims  {
  sub:    "<tenantId>",
  iat:    <epoch-sec>,
  exp:    iat + 60,
  jti:    <16-byte random base64url>,
  sha256: <hex of canonical-manifest-sha256>     // binds JWT to upload body
}
sig     HMAC-SHA256(header.claims, tenantSecret)
```

Worker validation order:

1. Verify HMAC signature against tenant's `secret_hash` (lookup by `sub`).
2. Reject if `now > exp` or `now < iat - 5s` (clock skew tolerance).
3. `INSERT INTO jti_used (jti, exp) VALUES (?, ?)` — duplicate primary
   key throws → 401. **D1 PRIMARY KEY constraint is the atomic
   replay guard, not KV `put`.**
4. On `/publish/start`, recompute canonical manifest sha256 from the
   request body; reject if `!== claims.sha256`.

### Canonical manifest (RFC 8785 / JCS)

```json
{
  "files": [
    { "path": "index.html", "sha256": "abc...", "bytes": 1024 }
  ],
  "deployment_slug": "sheets2"
}
```

Substrate and Worker both run the same JCS library. Files pre-sorted by
NFC-normalized path; numbers in canonical form; no whitespace. Without
this, path-encoding mismatches (NFC vs NFD on macOS, key-order
differences across JSON serializers) silently break JWT signature
validation and burn debug hours.

### Tenant lifecycle

* **Rotate:** `POST /rotate-secret` with old secret → returns new secret.
  Old secret invalidated immediately (`secret_hash` updated atomically;
  `rotated_from` records the previous tenant id for audit).
* **Revoke:** admin sets `tenants.status = 'revoked'`; every subsequent
  publish returns 401. User must re-register from a fresh substrate
  install.
* **Last-used audit:** every successful publish updates `last_used_at` +
  `last_ip`. Surfaces "this tenant published from a new IP" via the
  Settings UI for the operator to notice.

## 15.5 Rate-limit tiers (final ordering)

1. **Per-tenant daily** — 50/day free, 500/day paid. KV
   `ratelimit:daily:<tid>`.
2. **Per-tenant burst** — 5/min. KV `ratelimit:burst:<tid>`.
3. **Per-IP publish-daily** — 50/day, **independent of tenant**. KV
   `ratelimit:ip-publish-daily:<ip>`. Closes the wipe-`~/.papercusp`
   and re-register loophole that per-IP-on-registration alone doesn't.
4. **Per-IP register-hourly** — 10/hour on `/register-tenant`. KV
   `ratelimit:ip-register-hourly:<ip>`.
5. **Per-file size cap** — 25 MB (CF Pages hard limit per file).
6. **Per-deployment file count cap** — 20,000 (CF hard limit).
7. **Per-deployment total size cap** — 1 GB (our policy; CF doesn't
   enforce — saves us bandwidth abuse).

## 15.6 Endpoint reference

### `POST /register-tenant`

* **Auth:** none (v1) / GitHub OAuth (v1.1).
* **Body:** `{}` for v1.
* **Returns:** `{ tenantId, tenantSecret }`. Substrate writes to
  `~/.papercusp/publish-credentials.json`.
* **Rate limit:** 10/hour per IP.

### `POST /publish/start`

* **Auth:** JWT.
* **Body:** canonical manifest (see §15.4).
* **Returns:**
  ```json
  {
    "deploymentId": "dep_<8>",
    "missing": [
      { "path": "index.html", "sha256": "...", "uploadUrl": "https://publish.papercuspai.com/publish/file/<id>?token=..." }
    ],
    "vanityUrl": "https://sheets2-a4f9c.preview.papercuspai.com",
    "createdProject": false
  }
  ```
* **Idempotency:** re-POSTing the same manifest with the same JWT-sha256
  within 30 minutes returns the same `deploymentId` with `missing[]`
  filtered to still-not-uploaded files. **Resumable uploads.**

### `PUT /publish/file/<deploymentId>?token=<signedUrlToken>`

* **Auth:** signed-URL HMAC token (`HMAC(JWT_SECRET, deploymentId+sha256+exp)`).
* **Body:** raw file bytes.
* **Worker behavior:** streams body to CF `/pages/projects/<n>/files`
  using the master token, *without buffering* (Workers Streams API).
  No bandwidth cost on the Worker; no subrequest budget cost beyond 1
  per file. **Verifies sha256(body) === claimed sha256** before
  forwarding; rejects on mismatch.
* **Workers Paid prerequisite:** $5/mo plan provides 1,000 subrequests
  per Worker invocation, vs 50 on Free. Required for ≥40-file
  deployments.

### `POST /publish/finalize`

* **Auth:** JWT.
* **Body:** `{ deploymentId }`.
* **Worker behavior:**
  1. Verify all `missing[]` files have been uploaded.
  2. Call CF `/pages/projects/<name>/deployments` to publish.
  3. Insert `deployments` row with `status='building', cf_deployment_id=<...>`.
  4. Asynchronously archive `manifest.json` + each `<sha256>.bin` to R2.
  5. Return `{ vanityUrl, status: 'building' }`.

### `GET /publish/status/<deploymentId>`

* **Auth:** JWT.
* **Returns:** `{ status: 'building' | 'live' | 'failed', vanityUrl, failureReason? }`.
* **Substrate polling:** 1s for first 10s, 5s thereafter, total cap
  5 min, jittered ±20%.

### `POST /rotate-secret`

* **Auth:** JWT (signed by old secret).
* **Returns:** `{ tenantSecret: <new> }`. Old secret invalidated atomic
  with new secret install (UPDATE in single transaction).

### `DELETE /publish/<harness>` *(v1.1)*

* **Auth:** JWT.
* **Effect:** removes the deployment, frees the project, GCs R2 archive.
  Plugin gets an Unpublish row in config→Plugins.

### `GET /admin/gc` *(cron, internal)*

* Deletes `deployments` rows in `status='uploading' AND created_at <
  now-1h`. Calls CF `DELETE /deployments/<id>` for each abandoned half-
  upload to free the CF project. Deletes R2 prefixes past retention TTL.

## 15.7 Eject-to-own-CF (data model v1, button v1.1)

The fire exit. Designed v1 because designing it later is too late; the
button ships v1.1.

### Plugin config schema additions

```json
{
  "byoCloudflareToken":     "<user's Pages:Edit token, optional>",
  "byoCloudflareAccountId": "<user's CF account UUID, optional>"
}
```

When both are present, the plugin **bypasses** `publish.papercuspai.com`
entirely and calls CF Pages directly with the user's own token. Same
plugin, two configurations. Free forever for self-hosters who bring their
own credentials.

### Eject migration script

`apps/papercusp-publish/scripts/eject.ts` — admin-runnable. For each
tenant's projects:

1. Read manifest + per-file content from **R2**, not CF Pages API.
   (R2 is the fire exit's load-bearing component. CF Pages API is
   unavailable when the master account is suspended; that's the entire
   problem.)
2. Re-upload to user's BYO CF account using their token.
3. Rewrite plugin config: set `byoCloudflareToken` + `byoCloudflareAccountId`.
4. Delete the now-orphaned R2 prefix.

**Tertiary fallback:** if R2 retention has expired, the substrate's
local `<project>/<exportDir>` still has the source — re-publish from
local. Two independent recovery paths.

### Why this matters

WordPress.com → WordPress.org structurally has the same bad-actor blast
radius problem in miniature. One user publishing illegal content
suspends the master account; *every* user's site goes down. The eject
path means "every user's site goes down for \~hours, not forever" —
because their site rebuilds from R2 (and worst case: from local source).
That's a tolerable degradation; permanent loss is not.

## 15.8 Plugin scoping — `requiresTemplateKinds`

The hosted-publish plugin is coding-harness-only by design. Other
templates don't show the Publish button. Three places enforce this:

### Plugin manifest gains a new field

```json
{
  "name": "@papercupai/cloudflare-pages-hosted",
  "kind": "plugin",
  "requiresTemplateKinds": ["coding"]
}
```

Plural — `["coding", "department"]` is supported; a plugin that works
on multiple template kinds declares them all. Singular form was rejected
because it'd need to grow to plural day two.

### Enforcement points

| Where                            | Behavior                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `papercusp plugin enable <slug>` | Refuses with: `error: plugin "@papercupai/cloudflare-pages-hosted" requires templateKinds=[coding]; harness "papercup-org" is kind=org` |
| Substrate UI plugin cards        | Disabled "Enable" button + tooltip: "Requires a coding harness."                                                                        |
| Marketplace listings             | Constraint pill: `🪧 coding harnesses only` next to the plugin name.                                                                    |

Templates declare their kind via `papercusp.json`:

```json
{ "kind": "template", "templateKind": "coding" }
```

Existing templates (papercup-coding, papercup-org, ...) get this field
in a back-compat update. Templates without `templateKind` are treated
as `'coding'` by default for back-compat; templates that opt-in
explicitly are exact.

## 15.9 Project name + URL

### CF project name (account-internal)

```
sha256(tenantSecret || "/" || harnessSlug).slice(0, 16) + "-" + sanitize(harnessSlug)
```

Per-(tenant, harness) hash. Two tenants both creating `sheets` get
different prefixes; one tenant's projects don't cluster in CF's
account-internal listings. Hides cross-project tenant correlation
even from CF support engineers reading abuse reports.

### Vanity URL (user-visible)

```
<sanitized-harness-slug>-<8-base32-random>.preview.papercuspai.com
```

The 8-base32-random is per-deployment; same harness republished gets
a different URL. Prevents URL enumeration of one user's project history.

User can override the user-facing slug at publish time (defaults to
harness slug, sanitized). Helps when the harness was named
"tax-deduction-calculator-2026" but you want the public URL to say
"calculator".

### Wildcard subdomain routing

`*.preview.papercuspai.com` → Worker route → looks up
`projects.vanity_subdomain` → proxies to the auto-generated CF
`<prefix>.pages.dev` for that project. CF's Pages.dev URL never leaks
to the user.

## 15.10 What gets built

| # | Component                                                                                                    | LOC         |
| - | ------------------------------------------------------------------------------------------------------------ | ----------- |
| 1 | `apps/papercusp-publish/` Worker — D1 + KV + JCS canonicalizer + JWT + signed-URL helpers + R2 archive write | 1,000-1,400 |
| 2 | `@papercupai/cloudflare-pages-hosted` plugin — JCS manifest, retry/resume on partial upload, BYO-CF fallback | \~500       |
| 3 | Substrate "Publishing" settings page — mode selector, tenant info, rotate-secret button                      | \~250       |
| 4 | `papercup-coding` template — adds `recommendedPlugins`                                                       | 5 lines     |
| 5 | DNS — wildcard cert + Worker route on `*.preview.papercuspai.com` + `publish.papercuspai.com`                | \~3 hours   |
| 6 | Eject script reading from R2                                                                                 | \~200       |
| 7 | `requiresTemplateKinds` field — spec + CLI loader + UI gating + marketplace pill                             | \~300       |
| 8 | R2 bucket setup + lifecycle rules + cleanup cron                                                             | \~150       |

**Total: \~2.5 days.**

## 15.11 Admin one-time setup

1. **Cloudflare master account:** scope a `Pages:Edit` token (verify no
   DNS/Workers/R2 perms). Save as `CF_MASTER_TOKEN`.
2. **Cloudflare R2:** create bucket `papercusp-publish-archive`,
   generate scoped R2 token. Save as `R2_ACCESS_KEY` / `R2_SECRET_KEY`.
3. **Generate `JWT_SECRET`** — 32 random bytes, base64.
4. **Generate `HASH_PEPPER`** — 32 random bytes, base64. Separate from
   `JWT_SECRET`.
5. `wrangler kv:namespace create papercusp-publish-counters`.
6. `wrangler d1 create papercusp-publish` + apply migration.
7. **Workers Paid plan** ($5/mo) — confirmed prerequisite.
8. `wrangler deploy` Worker.
9. DNS: `*.preview.papercuspai.com` and `publish.papercuspai.com` → Worker
   route. Wildcard cert via CF managed cert (1-click in dashboard).
10. Cron: daily `/admin/gc` for stale uploads + R2 archive expiry.
11. Smoke test from a clean machine.

## 15.12 What's NOT in v1

* **Multi-master-account sharding.** Useful at scale; R2 retention
  provides a real recovery path, so a single master account is acceptable
  for v1. Worth revisiting at 1k+ paying users.
* **Machine fingerprinting** for tenant binding. Privacy-invasive; per-IP
  daily cap (§15.5 #3) closes the abuse loop without it.
* **Custom user-owned domains.** v1 deploys to `*.preview.papercuspai.com`
  only; user-supplied domains in v1.1.
* **Private mode** via Cloudflare Access. Schema field
  `projects.access_policy: 'public' | 'private'` reserved; Worker
  enforcement v1.1.
* **Paid-tier billing.** `tenants.tier` column exists; defer billing
  until we have users.

## 15.13 Risk register

| Risk                                                  | Likelihood                         | Impact                                                | Mitigation                                                                                       |
| ----------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| CF master account suspended for one user's content    | Real-mode (not tail)               | Every user's site offline                             | R2 archive retention + eject script (§15.7); reduces to "outage during eject"                    |
| `CF_MASTER_TOKEN` leaks                               | Low (Workers secret)               | Every project republishable by attacker               | Token scoped Pages-only (no DNS/R2), rotate quarterly, CF analytics alerting on call-rate spikes |
| Workers subrequest cap (50 free / 1k paid)            | Real on Workers Paid for monorepos | 1k+ file deployments fail                             | `/publish/upload-batch` endpoint as fallback, defer to v1.1                                      |
| User publishes 10 GB of static MP4s                   | Possible                           | Bandwidth costs balloon                               | Per-deployment 1 GB cap (§15.5 #7); per-tenant daily limit                                       |
| First-publish cold-start (\~+3s for project creation) | Every new harness                  | Slightly slower initial Publish                       | Pre-warm `ensureProject` at plugin enable time so first publish is warm                          |
| Half-completed upload (network drop, browser close)   | Real, common                       | Project in `status=uploading` forever, KV tokens leak | Resumable upload via `/publish/start` idempotency (§15.6); cron GC at 1h (§15.6)                 |

## 15.14 Open questions (decide before code)

1. **R2 retention period** — proposal: 30 days free / 1 year paid.
   Alternatives: 90 days for everyone (simpler), 7 days free / 90 days
   paid (cheaper).
2. **Workers Paid commitment** — $5/mo locked in from day one. Confirm.
3. **OAuth for `/register-tenant`** — v1 is anonymous (tenant-per-machine).
   v1.1 binds tenants to GitHub user via OAuth. If the marketplace
   already has a GitHub OAuth app, reuse it; otherwise spec scopes
   (`Pages:Edit` only, no `repo`).

## 15.15 Implementation order

**Day 1**

* Worker scaffold + D1 schema (tenants, projects, deployments, jti\_used,
  audit\_publishes) + KV bindings + R2 binding (\~5h)
* JWT (HS256+jti+sha256) + JCS canonicalizer + HMAC-pepper secret
  hashing (\~3h)
* `/register-tenant` + `/publish/start` + per-IP & per-tenant rate
  limits (\~3h)

**Day 2**

* File-PUT proxy (Worker streams body to CF without buffering) (\~3h)
* `/publish/finalize` + R2 archive write + status polling endpoint (\~4h)
* `/publish/start` resume semantics + GC cron (\~2h)

**Day 2.5**

* DNS + URL-rewrite Worker route on `*.preview.papercuspai.com` (\~3h)
* Plugin (JCS manifest, resume on partial upload, polling, BYO-CF
  fallback) (\~4h)
* Settings UI + eject script + smoke test + docs (\~3h)
