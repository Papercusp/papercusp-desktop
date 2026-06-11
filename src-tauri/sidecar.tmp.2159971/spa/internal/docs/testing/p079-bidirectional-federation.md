# P-079 runbook — live bidirectional federation acceptance
URL: /internal/docs/testing/p079-bidirectional-federation



import { Aside, Steps } from '@astrojs/starlight/components';

> **Webapp retired.** Every `localhost:3055`/`localhost:3070` URL here is only
> reachable while the **Tauri dev shell** is running
> (`cd papercusp-desktop && npm run dev`). Drive the operator through the Tauri
> shell, not a browser (see [Agent E2E playbook](/internal/docs/testing/agent-e2e)).

This is the acceptance test for Phase-1b bidirectional federation: two
**different** GitHub engineers join/share a harness and sync state **both ways**
over the Model B Hyperswarm substrate. It is the gate that closes implementation
**Open-Risk R-1** (see below) — the one thing that cannot be asserted offline.

Design: `apps/operator/docs/plans/papercusp-phase1b-bidirectional-federation-2026-06-01.md`.
The deterministic offline proof (module + transport, gate stubbed) already exists at
`packages/operator-core/lib/sync/hyperbee/__tests__/two-peer-swarm-bidi.test.ts`; this runbook
covers what that test *can't*: the real GitHub publish→verify loop with two real
identities.

The **whole identity path** — not just the gist crux — now runs **in-process with
two real GitHub identities** as a creds-gated acceptance test:
`packages/operator-core/lib/identity/p079-live-federation.live.test.ts`
(`P079_LIVE=1 npx vitest run p079-live-federation.live`). With both accounts authed
on one box, "two machines" collapses to "two distinct GitHub identities", which IS
automatable. The test stubs **nothing** on the identity path: real OAuth
`verifyChannel1` (`GET /user`), real attestation gists owned by each account, real
device-signed contributor files on `user/<id>` branches of a real shared repo, the
**real `verifyChannel2` (no override)** admitting each peer **both ways**, forgery
rejection (`oauth_user_id_mismatch` + `github_user_id_mismatch`), and a
**real-Hyperswarm bidirectional feature federation gated by the real `verifyChannel2`
adapter** (local testnet DHT). It self-cleans its gists + `user/<id>` branches +
throwaway keychain entries. The **manual** steps below are now only needed for
**Mode B** — two real *machines*, where NAT/firewall/public-DHT reachability is the
thing that can't be faked on one host.

The **channel-2 publish→verify loop** — the offline-impossible crux — was first run
live 2026-06-01 with two genuinely distinct GitHub accounts (`papercupai` +
`aviynw`): each created a real attestation **gist** under its own account, and the
**real** `verifyAttestation` / `verifyChannel2` accepted each peer for the correct
identity **bidirectionally**, while a *forged* identity claim (one account's gist
claimed as the other's id) was rejected with `github_user_id_mismatch` (D-006 holds
live). That run also surfaced + fixed a real bug: the attestation **gist filename**
used a raw base64 pubkey prefix, but a gist filename can't contain `/` (\~11% of
device keys) — fixed in `attestationGistFilename` (commit `ae5e25be3`).

On **2026-06-02** this was extended to a **full in-process Mode-A pass** and
captured as the gated `p079-live-federation.live.test.ts` (above): the same two real
identities published real gists **and** real signed contributor files to a real
shared repo, the **real `verifyChannel2` (no override)** admitted each peer both
ways, and they **federated a feature bidirectionally over the real Hyperswarm
transport with the real channel-2 adapter as the admission gate** — i.e. the
swarm/transport half (steps 4–7) is now exercised against the real gate, not just
the `two-peer-swarm-bidi` stub. The only thing left for a *true* Mode-B pass is two
real **machines** (public-DHT/NAT reachability).

**Historical:** the original design required the contributor-file *commit* to be
GitHub-**verified** (`commit.verification.verified === true`). A live probe found
Contents-API commits come back **unverified** (`reason: unsigned`) in the real
gh-token context, so that check was unsatisfiable and would have blocked **all**
admission. **R-1 is resolved** by re-anchoring channel-2 step (c) on **gist
ownership**: the contributor file embeds a `device_attestation_gist_id`, and
`verifyAttestation` checks that gist is **owned by the claimed `github_user_id`**
(GitHub reports `gist.owner.id`), attests the announced `device_pubkey`, and carries
a valid device Ed25519 signature. No commit-verification is required anywhere. The
2026-06-01 live run above confirms the gist-ownership anchor works with two real
identities.

## Two modes

* **Mode A — same laptop, two instances (Q-2 surrogate, do this FIRST).** Catches
  *code* bugs. Two operator instances with fully isolated state + two distinct
  GitHub accounts. Cheap, fast, repeatable.
* **Mode B — two real machines.** Catches *network* bugs (NAT, firewall, DHT
  reachability). Run only after Mode A passes.

The **decision rule** (from `papercusp-dogfood-phase11-multi-engineer-dogfood-2026-05-26`):
**P-079 PASSES when ≥5 of the 7 walkthrough steps land within 30 s of the user
action** — AND the two hard gates hold: (i) both peers' attestation **gists** are
owned by their claimed GitHub id (channel-2(c) holds), (ii) data flows **both**
directions.

## Prerequisites (both modes)

* Two **distinct** GitHub accounts (call them **Alice** and **Bob**), each with
  access to a shared test repo (use a throwaway repo, not a production one). Any
  real GitHub identity is admissible — there is **no** repo-collaborator gate at
  the substrate; GitHub's own write/branch-protection rules gate the actual PR
  merge. So Alice and Bob each just need to be real, `gh`-authenticated GitHub
  users who can push a `user/<id>` branch to the repo.
* Each side authenticated: `gh auth status` shows the intended account (Alice on
  her instance, Bob on his). The join/share flow resolves identity **server-side**
  from this — you do **not** type credentials into the UI.

A peer's device key lives in the OS keychain under
`<github_user_id>:<machine-fingerprint>`. Two *different* GitHub accounts
get distinct keychain ids → distinct device keys → two genuinely distinct peers,
even on one machine. The same account on two machines would currently collide on
the login-keyed contributor file (see the
[multi-device limitation](/internal/docs/agent-insights/phase1b-federation-limitations)).

### Mode A — isolating two instances on one laptop

Each instance needs its **own**: workspace root (→ its own per-harness corestore),
Postgres database, `gh` identity, and Tauri bridge port. Run the second instance
under its own Xvfb display so it never steals your focus (see
[Agent E2E §15.4](/internal/docs/testing/agent-e2e)):

```sh
# Instance B (Bob) — isolated display, bridge port, and gh config
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &
DISPLAY=:99 openbox &
DISPLAY=:99 \
  PAPERCUSP_BRIDGE_PORT=9230 \
  GH_CONFIG_DIR=/tmp/gh-bob \
  PAPERCUSP_HOME=/tmp/papercusp-bob \
  bash -lc 'cd papercusp-desktop && npm run dev'
# (gh auth login --hostname github.com  with GH_CONFIG_DIR=/tmp/gh-bob, as Bob, beforehand)
```

Instance A (Alice) is your normal `papercusp-desktop && npm run dev` on `:0`. Point
each instance's operator at a **separate** PG database (distinct `DATABASE_URL` /
embedded-pg dir) so "Alice's PG" and "Bob's PG" are observably different — that is
what makes "data crossed the wire" verifiable.

## The 7-step walkthrough

1. **Alice shares the harness.** In Alice's Tauri shell, open the harness's
   **Share** wizard (ShareWizard) and finalize. This writes
   `.papercusp/shared.json`, **publishes Alice's attestation gist + contributor file**
   (the file via the Contents API, embedding the gist id), boots Alice's substrate (joins the swarm topic derived
   from the repo id) and announces. Note the **join link** the wizard shows
   ("Send this link to contributors…").

2. **Confirm Alice's binding: contributor file + an owned attestation gist
   (channel-2 gate).** On the shared repo, the `user/<alice_id>` branch should now
   have `.papercusp/contributors/<alice_login>.json`. That file embeds a
   `device_attestation_gist_id`; confirm the gist exists and is **owned by Alice's
   account** (the channel-2(c) anchor — no commit-verification is involved):

   ```sh
   # gist id from the contributor file
   gh api repos/<owner>/<repo>/contents/.papercusp/contributors/<alice_login>.json?ref=user/<alice_id> \
     --jq '.content' | base64 -d | jq -r '.device_attestation_gist_id'
   # confirm that gist's owner id === Alice's github user id
   gh api gists/<gist_id> --jq '.owner.id, .owner.login'
   # expect:  <alice_id>   <alice_login>
   ```

   **If the gist is missing or owned by a different id, channel-2 won't admit** —
   see *Troubleshooting*.

3. **Bob joins via the link.** In Bob's shell, open the create-harness picker →
   **Entry 4 (harness link)**, paste Alice's link, and join. Bob's identity is
   resolved server-side from his `gh` auth (no creds typed). Watch the join
   progress through the 6 steps: `oauth_attest → clone_repo → publish_binding →
   boot_federate → await_admission_merge → route_insights`. After `publish_binding`,
   repeat the Step-2 gist-ownership check for **Bob's** file on `user/<bob_id>`.
   * If join returns **"GitHub authentication required"**, Bob's `gh` isn't
     authenticated in that instance's `GH_CONFIG_DIR` — fix and retry.

4. **Bob admits Alice (publisher→joiner).** On Bob's
   `/admin/dogfood-substrate` (or the boot-history), expect an `announce_admitted`
   for Alice's device pubkey within \~30 s. `announce_pending` is fine transiently
   (GitHub propagation) — it self-heals via the retry; `announce_rejected` is a
   failure (inspect the reason).

5. **Alice admits Bob (joiner→publisher).** Symmetric: Alice's boot-history shows
   `announce_admitted` for Bob within \~30 s.

6. **Alice → Bob data flow.** Alice creates/edits a feature in the shared harness.
   It appears in **Bob's** queue (Bob's PG / Bob's harness UI) within \~30 s.

7. **Bob → Alice data flow.** Bob creates/edits a feature. It appears in **Alice's**
   queue within \~30 s. (Bonus: have both claim the same feature to exercise the LWW
   advisory claim + clobber-toast.)

## Pass criteria

* **Hard gate 1 — channel-2 anchor:** both contributors' attestation **gists**
  (Steps 2 + 3) exist and are **owned by the claimed `github_user_id`** (so
  `verifyAttestation` returns valid). *Non-negotiable.* (This replaces the obsolete
  "verified commit" gate — see the R-1 Aside; no commit-verification is required.)
* **Hard gate 2 — bidirectional:** Steps 6 **and** 7 both succeed (data crosses
  in *both* directions, into *separate* PGs).
* **Soft gate:** ≥5 of the 7 steps land within 30 s of the triggering action.

Record each failing step as a P-027-style observation on `F-DOGFOOD-001` (per the
Phase-11 plan).

## Inspecting state

* **Boot/admission events:** `/admin/dogfood-substrate` (substrate diagnostic), or
  `GET /api/admin/dogfood-substrate-boot-history`. Kinds:
  `peer_connected`, `announce_admitted`, `announce_pending`, `announce_rejected`,
  `announce_error`, `peer_revoked`, `merge_error`.
* **Health:** `GET /api/admin/dogfood-substrate-health` (idle = `harnesses:[]`,
  `worstVerdict:'healthy'`).
* **Replicated rows:** query each instance's Postgres for the harness's feature
  queue / contributor tables (the read-merge projects admitted peers' ops there).

## Troubleshooting

* **`announce_rejected` with `binding_invalid`** → channel-2 couldn't verify the
  peer's binding. Most likely the peer's **attestation gist is missing or owned by a
  different GitHub id** (channel-2(c)), the contributor file is missing on the
  `user/<id>` branch (a+b), or the `device_pubkey` in the file/gist doesn't match the
  announced key (e.g. a multi-device collision — same login on two machines). Note:
  a deleted gist is *also the revocation signal* (`channel2_attestation_missing`).
* **Stuck `announce_pending`** → GitHub hasn't propagated the just-pushed file yet;
  it self-heals within the 30-min grace. If it never clears, the file/branch is
  missing or the API read is failing.
* **No `peer_connected` at all** → swarm/DHT reachability (Mode B: NAT/firewall on
  the DHT port). Confirm both booted with a non-null `swarm` and the **same**
  `topicHex`.
* **Federation only one way** → the silent side's binding isn't verifiable by the
  other (re-check that side's Step-2 gist-ownership + that its contributor file
  exists, AND that the *reading* peer can actually read the shared repo — a private
  repo the other peer can't access reads as 404 → stuck `pending`).

## Escalation — channel-2 gist anchor (R-1 history)

R-1 was the worry that channel-2(c) required a GitHub-**verified commit**, which a
live probe showed is unsatisfiable (Contents-API commits return `verified:false /
reason:unsigned`). **That risk is closed:** channel-2(c) now anchors on **gist
ownership** (`verifyAttestation`: `gist.owner.id === claimed github_user_id` +
device-pubkey match + Ed25519 sig), which needs no commit verification and is
confirmed live (2026-06-01, two real identities). If a future change reintroduced a
commit-verification dependency, the same escalation ladder would apply (GitHub App
commit signing → registered GPG/SSH key → documented relaxation) — but it does not
apply today.

A reliability gotcha the live run found: the attestation **gist filename** must use
the URL/filename-safe base64 alphabet — a raw base64 pubkey prefix contains `/`
(\~11% of keys), which GitHub rejects as a gist filename. Fixed in
`attestationGistFilename` (`ae5e25be3`); the regression test pins it.

After this passes, the longer **P-080 soak** (Alice + Bob each use Papercusp for
≥5 consecutive working days on the harness) is the next acceptance milestone.
