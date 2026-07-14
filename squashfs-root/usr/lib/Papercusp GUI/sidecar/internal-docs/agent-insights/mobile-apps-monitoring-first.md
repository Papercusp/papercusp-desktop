# Mobile apps (Android + iOS) — how the monitoring-first phone app works
URL: /internal/docs/agent-insights/mobile-apps-monitoring-first

The papercup-rust-mobile app, its device API, push, build, and the gotchas that make "why is my phone silent" diagnosable. From mobile-apps-revival-v2-2026-07-13.

The phone app is a **monitoring interface, not a work surface**. The desktop is
where the owner works; the phone shows what the fleet is doing and what needs the
owner, with **no execute/approve/claim affordances**. Keep that principle when
extending it — add read-only tiles and attention producers, not action buttons.

## Where the code lives

* **App:** `papercup-rust-mobile/` — a **separate git repo** on branch `master`,
  **NOT** covered by the papercup git-sync auto-commit. Edits there need a
  **manual commit**, and the papercup Edit-tool worktree guard refuses it (it
  can't tell a separate repo from a stray worktree) — edit via `sed`/`bash` and
  commit by hand. Rust core (`crates/papercup-core`) + UniFFI bindings, Jetpack
  Compose (Android), SwiftUI (iOS).
* **Server (device API):** `packages/operator-core/lib/endpoint-route/routes/device/*`
  — `defineTool` routes gated by `DEVICE_AUTH` (`{ kind: ['device'] }`). The phone
  reaches them at `https://api.papercuspai.com/api/device/*`.
* **Device auth:** `lib/device-jwt.ts` (HS256, `MOBILE_JWT_SECRET`), `lib/device-store.ts`
  (paired devices + push tokens), `lib/device-push-dispatcher.ts` (FCM + APNs send).
* **Monitoring producers:** `lib/device-monitoring.ts` (fail-soft, dependency-injected).

## The gotchas that cost hours

1. **The public URL tunnel is Cloudflare-DASHBOARD-managed.** `api.papercuspai.com`
   is served by `cloudflared` (tunnel `c53515b3`, user unit
   `cloudflared-papercupai-api.service`) whose ingress config lives in the
   Cloudflare **dashboard**, not the local `~/.cloudflared/papercupai-api.yml` —
   editing that local file does **nothing** (and SIGHUP-ing cloudflared after a
   bad local edit can kill the tunnel → both domains 530). If the public API is
   down, check the systemd unit is `active` first; don't touch the local yml.
2. **`/api/health` 404 on the public domain is a red herring** — it routes to a
   different internal port (`:3057`), not `:3070`. The phone never calls it. Test
   reachability with a real device route (`/api/device/attention` with a device JWT).
3. **`MOBILE_JWT_SECRET` durability = device-token durability.** Device JWTs are
   HS256-signed with it; if it's unset in dev, `getSecret()` mints a **per-process**
   secret that rotates on every restart → all paired phones silently stop working
   until they re-pair. It's set durably in `apps/operator/.env.local` (gitignored,
   survives deploys, identical in the release + staging trees). `mobileJwtSecretStatus()`
   reports durability; a one-time boot/first-use warning fires when it's ephemeral.
4. **Two-port model applies.** Device routes run on the GREEN operator (`:3070`,
   release checkout). A server-side device-route edit reaches `:3070` only via the
   deploy pipeline (or a forced `deploy-cli --execute`); `:3170` is staging. Probe
   where your write actually lands.

## Push (the owner's remote control)

Both providers **mint their auth token in-process** (the old design expected a
pre-signed env token refreshed by a job that never existed, so pushes silently
no-op'd):

* **FCM (Android, LIVE):** `google-auth-library` JWT client signs a service-account
  JWT from `FCM_SERVICE_ACCOUNT_PATH` (default `~/.papercusp/firebase-admin.json`,
  project `papercusp-mobile`) → OAuth access token → HTTP v1 send.
* **APNs (iOS, DORMANT):** `jose` signs an ES256 provider JWT from a `.p8`
  (`APNS_KEY_PATH`/`APNS_KEY_ID`/`APNS_TEAM_ID`), cached \~50 min, sent over
  **HTTP/2** (APNs rejects HTTP/1.1). **Blocked on Apple Developer enrollment** —
  absent creds ⇒ cleanly skipped, so iOS registration is harmless until enrolled.

Unconfigured providers are skipped, never thrown — `dispatchPush` returns
`PushSendResult[]`. `pushEnabled()` reports which providers are live.

## The monitoring surface (Phase B)

`lib/device-monitoring.ts` exposes fail-soft, dependency-injected producers reused
across routes — a failed read returns a `null` tile, never a broken dashboard:

* `releaseGateTile()` — reuses `fetchOrientPipeline` (cached). `stale-verdict` is
  **not** treated as red (load-bearing silence — don't raise a phantom alarm).
* `poolTile()` — `accountStatus` + `accountRoutingExhausted` (inference-pool health).
* `fleetsAndPotsTile()` — `listPresence` + `fetchPresenceFleet`, grouped by fleet + pot.
* `connectionTile()` — `deviceConnectionSnapshot` (paired? push registered? secret durable?).
* `systemAlerts()` — PURE composer: red-gate + pool-exhaustion → owner-attention alerts.

Routes: `GET /device/monitoring` (all tiles), and `GET /device/attention` carries
`systemAlerts` alongside its existing `groups` + `workItems`. Most owner-attention
surfaces (fleet-leader escalations, open owner questions, needs-human) are **already**
produced by `plans:attention` (which the device attention route reads) — only the
system-health conditions (red-gate, pool-exhaustion) were missing.

## Building

Android: `cd papercup-rust-mobile && export ANDROID_NDK_HOME=$HOME/Android/Sdk/ndk/27.0.12077973
ANDROID_HOME=$HOME/Android/Sdk && make tokens bindings-kotlin && tools/build-scripts/build-android.sh`
(the last step does the 4-ABI cargo-ndk release cross-compile + `gradlew assembleDebug`;
`make build-android` additionally runs `install-and-launch.sh`, which needs an adb
device). APK → `android/app/build/outputs/apk/debug/app-debug.apk`. iOS: needs the
Mac VM (`ssh -p 2222`, `~/.papercusp/build-vms.env`) + `make build-ios`.

## What stays owner-gated

* **APNs enrollment** — Apple Developer account + `.p8` key (iOS push is dead until then).
* **On-device verification** — the owner re-pairs their own phones (`/settings/mobile`)
  and confirms a push actually lands; can't be done without their devices.
* **Graduating the `mobile-pairing` onboarding item** out of `ONBOARDING_PREVIEW_FEATURES`
  — wait until pairing + push are owner-verified end-to-end (Android works; iOS pending
  enrollment), or a fresh install is promised notifications that don't fire.
