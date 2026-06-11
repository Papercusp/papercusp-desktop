# Auth & identity
URL: /internal/docs/spec/auth-and-identity

Per-harness shared-secret tokens. Identity is bearer-derived, not body-supplied. Threat model and recovery procedures.

import { Aside } from '@astrojs/starlight/components';

Every `/api/admin/execute-action` request is authenticated against a per-harness shared-secret token. **Harness identity is derived from the token binding, not from caller-supplied body fields.** This is what makes `parent_slug` and `from_slug` cryptographically sealed.

## Token issuance

Generated at scaffold time:

* 256-bit random, base64url-encoded (no padding)
* Written to **two places**, all together:

  1. `<harnessDir>/.papercusp/config.json:harness_token` (mode 0600)
  2. `harness_shared.token_index` (token → `harness_slug`, with `kind`/`workspace_id`, O(1) lookup) — the **authoritative** store

  *(Implemented: see `executeAction`'s `scaffold_harness` path in `packages/operator-core/lib/execute-action.ts`. The earlier per-harness `harness_<slug>.config_token` row was retired — `token_index` is now the single source of truth for token→harness lookups.)*

Generated once per harness. **Rotation is implemented** via `POST /api/admin/rotate-token` (`packages/operator-core/lib/endpoint-route/routes/admin/rotate-token.ts`), which mints a fresh token, mirrors it to PG + `config.json`, and invalidates the old one.

## Auth header

```
Authorization: Bearer <harness_token>
```

Every executeAction request needs this. Missing or unrecognized → `401 invalid_or_missing_token`.

## Identity derivation

The middleware:

1. Looks up `harness_shared.token_index WHERE token = <bearer>` → `derivedCallingHarness`.
2. **`callingHarness` in body must equal `derivedCallingHarness`** or be omitted; mismatch → `403 identity_mismatch`.
3. **`from` in `send_message` body**: same rule, 403 on mismatch.
4. **`parent_slug` in `scaffold_harness` body**: server-controlled. Presence in body → `400 parent_slug_not_caller_controlled`.

After this, the handler trusts `derivedCallingHarness` as the caller's identity. Any body-supplied identity field is dropped or rejected.

## Substrate invariants

These hold by construction. If they fail, the substrate is broken:

1. The bearer token is the **single source of truth** for caller identity.
2. `from_slug` on every `messages` row equals the bearer-derived identity at the time of insert.
3. `parent_slug` on every `harness_shared.projects` row equals the bearer-derived identity of the calling harness at scaffold time.
4. No body-supplied identity field ever overrides the derived value.
5. A harness can read any other harness's state (operator-local reads, no auth) but can only **write** to its own schema (`mark_message_status`) or insert into other harnesses' inboxes (`send_message`, with from-spoofing prevented by #2).

## Threat model

This is **not a network-attacker model** — the operator is local-only by default. The threats it does protect against:

* **Malicious local processes**: any other app on the machine can hit `:3055`. Without a valid bearer, every `executeAction` call is rejected. Without a *bound* bearer, every cross-harness write is rejected as identity\_mismatch.
* **Buggy harness emitting wrong slug**: the substrate refuses to write `from_slug = "papercup-org"` if the bearer isn't bound to `papercup-org`. The harness can't accidentally claim someone else's identity.
* **Future plugin holding the operator API**: same identity-binding rule. A plugin spawning on behalf of a harness must use that harness's token; cannot impersonate.

What it does **NOT** protect against:

* A harness whose `.papercusp/config.json` is read-leaked to another process — the token is then full-permission for that harness. Mode 0600 mitigates; OS-level isolation would be the v2 hardening.
* A compromised operator process — the operator has the source of truth; if it's malicious, all bets are off.

## Compromised harness recovery (manual)

If a harness's token is leaked, the lightest fix is to **rotate** it:
`POST /api/admin/rotate-token` (authenticated with the harness's *current*
token) mints a fresh token and invalidates the old one. For a fuller wipe:

1. Stop the harness's loop (operator UI → cancel).
2. Delete the project's PG schema: `DROP SCHEMA harness_<slug> CASCADE`.
3. Delete the registry row: `curl -X DELETE /api/harness/projects/<slug>`.
4. Delete the on-disk directory.
5. Re-install or re-spawn the harness. A fresh token is generated.

If the parent is the compromised harness, all child harnesses spawned during the compromise window may have hostile content. Audit `harness_<parent>.executed_actions` for recent `scaffold_harness` calls.

## Out of scope (v2)

* Revocation API beyond rotation (token rotation itself shipped — `POST /api/admin/rotate-token`)
* Cross-machine identity (cryptographic signatures, not just shared secrets)
* Per-action capability tokens (more granular than per-harness)
* Audit log monitoring / anomaly detection on the executor
