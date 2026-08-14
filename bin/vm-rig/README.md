# vm-rig — the tower↔VM federation rig (true kernel + network boundary)

The strongest LOCAL federation proof we have since Hetzner access was lost
(owner 2026-07-03; D-001 of `shared-pot-p2p-release-readiness-2026-07-03`):
the tower's live operator (`:3070`) federating with a **separate OS in a
QEMU/KVM VM** across a real bridge hop. This is the P-059 drill rig, rescued
from hand-rolled `/tmp` scripts (which a VM reboot deletes — exactly how the
original `vmcall.sh` got lost).

## Topology

| End   | What                                                            | Address                                   |
| ----- | --------------------------------------------------------------- | ----------------------------------------- |
| tower | live operator (`papercup-dev-api.service`, `:3070`)             | `172.31.44.1` (host side of `macbr0`)     |
| VM    | packaged **Papercusp Server.app** on the macOS (Sonoma) QEMU VM | `172.31.44.2`, ssh `aviweiss@172.31.44.2` |

- Bridge: `macbr0` (`172.31.44.1/24`), VM NIC `mactap0`.
- VM boot (usually already up; the mac-VM dogfood lane owns it — coordinate
  before rebooting): `~/macos-vm/OSX-KVM/boot-sonoma-durable.sh`.
- The VM operator's Hono port is **randomized per boot** — never hardcode it;
  `vmcall.sh` auto-discovers it by probing local listeners for `/api/health`.

## Bring-up (fresh agent, from zero)

```bash
# 1. VM up + reachable?
ssh -o ConnectTimeout=5 aviweiss@172.31.44.2 true || echo "VM down — boot-sonoma-durable.sh (coordinate with the mac-VM lane first)"

# 2. deploy the driver (RE-RUN AFTER EVERY VM REBOOT — the VM's /tmp is wiped)
bin/vm-rig/deploy.sh

# 3. side-by-side diagnosis (roster, admittedLogCount, watermarks, swarm log)
bin/vm-rig/diag.sh

# 4. the P-059 acceptance probes
bin/vm-rig/probe-fwd.sh    # tower→VM : PASS = key in VM coord:feed AND VM events:status shows a wake record created before the 600s await window expired
bin/vm-rig/probe-rev.sh    # VM→tower : PASS = key in tower coord:feed AND tower events:status shows a wake record created before the 600s await window expired

# 5. the LIVE-1 coordination parity run (all five surfaces, one green/red exit)
bin/vm-rig/parity.sh                      # all legs
bin/vm-rig/parity.sh --only fedevents     # legs: fedevents wakebridge receipts claimspec presence
```

## Hive-git physical evidence producer (P-505)

`bin/hive-git-drill.sh` accepts physical E/G release evidence from exactly one
checked-in adapter: `bin/vm-rig/hive-git-physical-probe.sh`. The adapter now has
the trust-root half of the producer:

- It loads each host's existing `local-announce-identity.json` and verifies the
  cached public key against that host's existing keychain entry. It never runs
  GitHub identity discovery and never generates a new device key.
- It derives an OS machine fingerprint (`/etc/machine-id` on Linux,
  `IOPlatformUUID` on macOS), and refuses a pair unless host ids, device keys,
  and machine fingerprints are all distinct.
- After a run, each physical host signs both the canonical evidence bytes and a
  receipt binding run id + host + device + machine + signing time. The final
  trust anchor contains both receipts; the release validator verifies them and
  requires the evidence attestations to match them exactly.
- Evidence/trust outputs must be absent absolute paths and are written only
  after the final validator passes. Pre-banked attestations and local-only host
  pairs are refused.
- The VM's bundle-extracted `dev-source` is an installed-artifact snapshot and
  may legitimately predate the release candidate. Before reading either host
  identity, the wrapper streams immutable `git archive` snapshots of the current
  superproject `packages/operator-core`, generic libraries, root scripts, and
  Papercusp library submodule into a private run-local VM directory. It builds a
  run-local dependency overlay where staged workspace packages replace the
  bundle's stale workspace links while third-party packages remain read-only
  links to the installed dependency tree.
  The staged producer's SHA-256 must equal the tower producer byte-for-byte. The
  run-local source is removed on exit; the installed `dev-source` is never
  overwritten. This stages the strict evidence adapter only: production
  mutations still run through the live `git-sync:run`, bridge, watchdog, and
  host services named by each phase.
  `HIVE_GIT_PHYSICAL_PLAN=p2p-git-live-activation-2026-07-09
  bin/vm-rig/hive-git-physical-probe.sh --source-preflight` exercises this
  staging, byte-hash, and distinct-host identity path and exits before the
  destructive execution grant or first phase call.

The mutation/observation entrypoint is now checked in as
`bin/vm-rig/hive-git-physical-scenario.sh`. Its offline invocation, topology,
output, ordered A-G phase contract, fixed Phase A cold-join executor, fixed
Phase B bidirectional ref-announcement executor, fixed Phase C trust
negative-control executor, fixed Phase D production-spine materialization
executor, fixed Phase E GitHub-bridge executor, fixed Phase F lifecycle
executor, and fixed Phase G authority/fence/retry/restart adapter have landed.
`--phase-contract A|B|C|D|E|F|G` exposes their exact contracts. Phase A pins the
test hive/repo and causal operations:
observe the tower store, atomically quarantine (not delete) the VM store,
observe absence, invoke only the VM's canonical `git-sync:run`, then capture
both bare repos. The shared producer rejects the result unless both identity-
derived namespaces and every referenced object exist on both hosts, ref OIDs
match exactly, the stores have independent fingerprints and local ODBs with no
alternates, and the timestamps prove absence preceded bootstrap. It also
re-verifies each existing G-4 sigrefs signature against the exact observed
ref→OID set for that device's namespace on both hosts. The rebuilt VM's own
signed snapshot must be timestamped inside the bootstrap window, so a static
path name, relay-written ref, or banked pre-cold-join signature cannot stand in
for device-owned publication. Hermetic tests exercise real temporary bare repos
plus spoofed signatures, stale VM signatures, warm-store, divergent-ref,
missing-object, alternate-ODB, same-store, and causal-order negative controls.

Phase B then creates a fresh run-bound commit in the tower device namespace,
drives only the source and destination canonical `git-sync:run` ticks, and
requires the destination to observe the exact signed sigrefs OID, commit OID,
payload hash, reachable-object count, and bounded causal latency. It repeats
the same proof from VM to tower. The scenario never calls `git fetch` or
`git bundle` directly and has no environment-supplied command seam, so the
production ref-announce/Protomux git-upload-pack v2 path is the only transfer
path that can satisfy the contract.

Phase C then runs real Git and real Ed25519 negative controls independently on
both physical stores. Each host generates a distinct run-bound third-device
key and honest/rogue commits, signs the honest namespace snapshot, proves the
signature is authentic, mutates the served head afterward, and requires
`reconcileFetchedHeads` to report the exact signed-head mismatch. The same
signed snapshot must fail `acceptFetchedSigrefs` at the monotonic rollback
fence, and a run-bound real bare scope repo must refuse a fixed non-member via
`authorizeScopeRepoServe`. The honest head is restored before the host result
is accepted. The two host results are aggregated only when identities, refs,
signatures, mismatches, rollback verdicts, scope refusals, and store paths all
match the fixed P-304 contract. There is no caller-supplied key, command, or
manifest seam; Phase B remains the production transport proof.

Phase D is a thin physical adapter over the production integration and
worktree-bridge spine. It creates one fresh fixed commit below the steer tier on
the VM, drives only canonical `git-sync:run` ticks, observes the exact pending
integration-request row on the tower, and ratifies that row through
`ratifyIntegrationRequest`. It then requires the tower's signed
`pot-git:staging-advance` to appear identically in both physical event logs and
requires the VM's canonical staging ref, worktree, and persisted bridge cursor
to reach that signed head. A second fresh overlapping tower commit runs through
the same production path while the VM's fixed sentinel file is dirty; acceptance
requires the mirror and cursor to advance while the VM worktree head and the
sentinel's content hash remain unchanged. Final evidence embeds this full causal
object and re-runs the strict Phase D validator—there is no summary-only pass,
local second-worktree substitute, caller-selected repo/worktree, direct fetch,
or direct ref mutation seam.

Phase E is a thin adapter over the production GitHub bridge rather than a
second bridge implementation. It observes legacy mode on both physical hosts,
persists the fixed canary's bridged mode through `setPotGitMode`, drives both
members only through `git-sync:run`, and requires both routine rows to report
`commit-only:bridged` with no direct pushes. A fixed fresh upstream commit must
become the exact `last_admitted` watermark; canonical staging, the bridge's
egress head, and fork staging must then converge. Two direct executions of the
production stall watchdog must stay quiet for that active commit-only routine.

The same executor creates one fixed fork-ahead commit, requires the production
bridge to emit a structured `egress-non-ff` escalation without moving canonical
staging, restores only that exact fork head with force-with-lease, and rolls
the mode back to legacy on both hosts. A RETURN trap performs best-effort lease
recovery and legacy rollback if any intermediate assertion fails. Final
evidence embeds the full Phase E causal object and re-runs its strict validator;
a summary pass cannot satisfy the gate. Phases D and E share one scenario-level
run id so both can bind to the eventual enclosing physical manifest.

Phase F then executes the real G-9 collector and G-10 publish guard independently
on both attested physical hosts. Each host creates private throwaway bare
repositories, derives the live and departed namespaces only from the two
attested device keys, and proves that GC keeps the work ref and newest two
published refs, prunes the oldest published ref, and archives the departed
namespace. A separate private repo must admit a clean commit, refuse a planted
AWS-style credential with the exact `secrets` code, and refuse a fixed oversized
blob with the exact `blob-over-cap` code. Both repositories are removed before
the host result returns.

The producer accepts no caller-selected repo path, ref, namespace, retention cap,
publish cap, command, or evidence document for this leg. Final evidence embeds
both full host results, re-runs the strict P-307 validator, and binds their run
id, observation window, and identities to the enclosing two-machine attestation;
a one-host or summary-only lifecycle pass cannot satisfy the release gate.

Phase G then runs a fixed adapter over the production handoff/grant, signed
staging-advance fence, worktree-bridge cursor persistence, Postgres mode fallback,
git-sync non-fast-forward recovery, Hypercore restart, and namespace Git
round-trip surfaces. The two real tower/VM device keys are only the enclosing
manifest's physical execution binding. The adapter's authority, survivor, and
stable restart identities are fresh ephemeral keypairs, and the strict validator
rejects any attempt to relabel them as either physical host. Both physical hosts
later attest the complete same-run manifest with their real keychain-backed keys.

The result independently records a ready epoch-8 token-adoption grant, accepted
successor advance, stale epoch/sequence refusal without a ref move, cursor holds
for both `unknown-sha` and `ungranted-epoch`, cursor advance only after the missing
evidence arrives, `source:error` legacy fallback on an injected settings read
failure, a noisy non-fast-forward push followed by normal fetch/merge/retry
without force, and a changed Hypercore key with stable ephemeral namespace plus
exact commit/payload round-trip. All private temporary repositories are removed
before the result returns.

The scenario is now `ready-v1`, but readiness alone performs no mutation. The
canonical wrapper invokes it only when the drill receives the checked-in physical
probe path, and the scenario additionally requires
`HIVE_GIT_PHYSICAL_EXECUTE=p2p-git-live-activation-2026-07-09` immediately before
the first phase call. It assembles one unsigned A-G manifest from the seven fresh
phase inputs, embedding one hashed raw lifecycle witness from each physical host
so later validation does not depend on temporary files. The wrapper then obtains
fresh receipts from both real hosts, and only the finalizer may add attestations.
There is no environment-supplied command or pre-authored JSON seam.

Without invoking that physical probe, the canonical drill still reports E and G
as SKIP. With it, the same-run strict validator re-runs the complete D/P-305,
E/P-306, F/P-307, and G/P-308 validators before either release leg can pass.

## `parity.sh` — the LIVE-1 parity runner (WI-7000)

The probes above prove the _transport_. `parity.sh` proves the five LIVE-1
**coordination surfaces** on top of it, by driving the `fed_assert_*` helpers in
`bin/lib/federation-asserts.sh` against this rig:

| Leg          | Surface                          | Proves                                                                                                                                                                                                                                                   |
| ------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fedevents`  | P-009 federated events           | key fired EXACTLY once on the VM (positive control — run it first)                                                                                                                                                                                       |
| `wakebridge` | P-002/P-003 wake bridge          | a tower `coord:send` fires the VM's inbox-wake                                                                                                                                                                                                           |
| `receipts`   | P-008 + M5a delivery receipts    | exactly one receipt, `delivered=true`                                                                                                                                                                                                                    |
| `claimspec`  | P-016 + M7 claim-spec federation | spec lands on the VM `origin=remote` with `fed_hlc`+`fed_ts`                                                                                                                                                                                             |
| `presence`   | P-004/P-005 presence gossip      | **both directions**, as two verdict rows: `presence` = the tower carries fresh presence+session rows for the VM, `presence-rev` = the VM carries them for the tower (WI-7029 — asserting only one direction let the reverse stay dead under a green leg) |

Exit: `0` all green · `1` one or more red · `2` **preflight failed, NO verdict**.

- **It cannot emit a single-box false green.** Preflight aborts with exit 2
  unless two distinct real hosts both answer, and there is no skip path — the
  D-018 lesson (a drill whose legs quietly SKIP produces a plausible, quotable,
  WRONG release reading). Never report a LIVE-1 surface proven from a run whose
  banner does not name two distinct hosts.
- **Why it exists at all:** those five helpers shipped in July with their named
  caller being the retired `deb-hetzner-federation.sh`, so _nothing invoked
  them_ for a month and four of five surfaces stayed "unproven cross-machine,
  manual PG inspection". `npm run lint:assert-integrity` (rule R6) now fails the
  build if any assert helper becomes unreachable again — but that guard proves
  a runner **exists**, not that anyone **ran** it. This rig is manual: running
  it is step 5 above.

P-059 SUCCESS = both probes green AND still green after a VM reboot
(reboot → re-run `deploy.sh` → re-run both probes). Read PASS off each
probe's `coord:feed` + `events:status` output, NOT off the await `.out`
outcome line — a headless probe client's own await legitimately reports
dropped/dead-waiter until P-001 (wake-executor inbox-degrade fix) lands;
that's the last delivery hop, not a federation failure.

## Env knobs

| Var                                | Default                | Meaning                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PCUSP_VM_SSH`                     | `aviweiss@172.31.44.2` | ssh target for the VM end                                                                                                                                                                                                                                                                 |
| `PAPERCUSP_HONO_PORT`              | `3270`                 | TOWER operator port (probes'/diag's tower end) — the **bg-host substrate primary**, which actually holds the in-process events/coord state; `:3070` is the request-only cluster tier and gives false-negative probe results (earlier "probe failures" were this, not a federation defect) |
| `PCUSP_PROBE_KEY`                  | unique per run         | event key the probes emit/await                                                                                                                                                                                                                                                           |
| `PCUSP_VM_NODE` / `PCUSP_MCP_CALL` | auto                   | VM-side node binary / mcp-call.mjs path (see `vmcall.sh`)                                                                                                                                                                                                                                 |

## Gotchas (each burned a real drill)

- **VM stuck at the loginwindow = auto-login broke = the whole rig is dark,
  SILENTLY** (this is the WI-4070 root cause — it burned DAYS on a phantom
  "network/DHT wedge"). macOS auto-login stops firing the moment
  `/etc/kcpassword` drifts from the account password; the Mac then sits at the
  loginwindow, the Papercusp LaunchAgent never starts, and the rig goes dark
  (`procs=0`, zero `origin='remote'` rows on the tower) with **no crash and no
  error** — so it reads exactly like a swarm/DHT failure. `deploy.sh` now
  auto-runs `preflight-login.sh` whenever the operator is unreachable, to catch
  this LOUD with the real diagnosis. **Secure Token blocks any headless password
  reset**, so recovery is a one-time human GUI login at `spice://127.0.0.1:5930`,
  then re-run `deploy.sh`. Durable fix (keep kcpassword in sync) tracked in
  EI-13010.
- **VM `/tmp` is wiped on reboot** — always `deploy.sh` after a reboot; a
  `NO_OPERATOR_PORT` from vmcall means the VM app isn't running (start
  Papercusp Server.app in the VM), not a driver bug.
- **The pre-mig-557 relation errors fire LAZILY (~5min in), so a boot-time
  "0 relation errors" grep is a FALSE GREEN** (WI-4070 verify, 2026-07-17).
  The `hive-owner-key-health` / directory sweeps are what hit the renamed
  `harness_shared.hive*` tables — grep the serve log again ≥6min after boot
  before declaring the schema clean.
- **An installed app bundle can be OLDER than the shared DB schema — and
  dev-source can NEVER be newer than the bundle** (it extracts from the
  bundle's own `source.tar.zst`). The Jul-11 bundle was built mid-rename
  (`loadHivePubkey` still queried `harness_shared.hives`) → owner key null →
  the VM COULD NOT SIGN → outbound federation dead while inbound catch-up
  worked. Until a fresh mac build is cut, run current code via
  `boot-headless-current.sh` (tower-built esbuild serve.mjs + composed
  node_modules over the bundle's darwin natives).
- **A `claude` relaunch on the tower drops `SSH_AUTH_SOCK`** — ssh to the VM
  then fails with "Too many authentication failures". Fixed durably via the
  `Host 172.31.44.2` entry in `~/.ssh/config` (IdentityFile
  `~/.ssh/papercup-vm-mac`, IdentitiesOnly) — keep it.
- **ufw on the tower can silently block guest→host** traffic on the bridge
  (the P-059 "post-UFW-fix" history). If reverse-leg traffic dies:
  `sudo ufw allow from 172.31.44.0/24`.
- **Workspace scoping**: author VM-side state under
  `--workspace papercusp-workspace`, NOT `default` — state authored under
  `default` strands work invisible to the papercusp pot (WI-1564 class).
- **Probe/diag await windows must be ≥600s, and tower calls must hit `:3270`
  (bg-host substrate primary), not `:3070`** (request-only cluster tier) —
  a 200s window expired before replication had actually applied, and calls
  against `:3070` were reading a tier that doesn't hold the true in-process
  substrate state. Both looked like federation failures; neither was.
- **VM bridge NIC re-enumeration**: a VM reboot/update can renumber the
  bridged NIC (`en1`→`en2` seen in practice) — the static IP binding does
  NOT follow automatically and must be re-bound with `networksetup` inside
  the VM, or the VM silently drops off `172.31.44.2` and every ssh/probe
  call in this rig times out for a reason that looks like the bridge itself
  is down.
- **Packaged-app updates lose the `PAPERCUSP_DHT_BOOTSTRAP` LaunchAgent env**:
  updating the packaged Papercusp Server.app on the VM can wipe/reset the
  LaunchAgent's environment, dropping `PAPERCUSP_DHT_BOOTSTRAP` — re-verify
  this env var is still set on the VM's LaunchAgent **after every app
  update**, or the VM boots isolated (no bootstrap peer) and every probe
  fails looking like a federation regression.
- The tower end's **code fix / deploy target** is still `:3070` (the GREEN
  release operator) — a fix in the staging tree is NOT live there until
  deployed (`dev:pipeline_position`, force-deploy if the drill needs it).
  This is separate from the `:3270` substrate-primary port the probes/diag
  call by default above — `:3070` is where a _code change_ lands; `:3270`
  is which _port_ of the running (already-deployed) operator to query.

## Files

| File                 | Role                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vmcall.sh`          | VM-SIDE driver: port auto-discovery + mcp-call (deployed to VM `/tmp`)                                                                                                                                 |
| `deploy.sh`          | push `vmcall.sh` + `scripts/mcp-call.mjs` onto the VM + self-test (auto-runs `preflight-login.sh` if the operator is unreachable)                                                                      |
| `preflight-login.sh` | assert the VM's unattended-login invariant (kcpassword ↔ account password); fails LOUD on the silent loginwindow-stuck death (WI-4070 / EI-13010) instead of letting it look like a federation failure |
| `probe-fwd.sh`       | tower→VM federated-event probe (from `/tmp/p059-e1c.sh`)                                                                                                                                               |
| `probe-rev.sh`       | VM→tower federated-event probe (from `/tmp/p059-rev2.sh`)                                                                                                                                              |
| `diag.sh`            | tower+VM `dev:dogfood_substrate_status` side-by-side + swarm log (from `/tmp/p059-diag.sh`)                                                                                                            |

For the containerized 2-node **matrix** rig see `bin/local-matrix.sh`; for the
fast single-box smokes see `bin/two-instance-*-smoke.sh`.
