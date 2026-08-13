# vm-rig — the tower↔VM federation rig (true kernel + network boundary)

The strongest LOCAL federation proof we have since Hetzner access was lost
(owner 2026-07-03; D-001 of `shared-pot-p2p-release-readiness-2026-07-03`):
the tower's live operator (`:3070`) federating with a **separate OS in a
QEMU/KVM VM** across a real bridge hop. This is the P-059 drill rig, rescued
from hand-rolled `/tmp` scripts (which a VM reboot deletes — exactly how the
original `vmcall.sh` got lost).

## Topology

| End | What | Address |
| --- | --- | --- |
| tower | live operator (`papercup-dev-api.service`, `:3070`) | `172.31.44.1` (host side of `macbr0`) |
| VM | packaged **Papercusp Server.app** on the macOS (Sonoma) QEMU VM | `172.31.44.2`, ssh `aviweiss@172.31.44.2` |

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

The mutation/observation entrypoint is now checked in as
`bin/vm-rig/hive-git-physical-scenario.sh`, but only its offline invocation,
topology, output, ordered A-G phase contract, and the fixed Phase A cold-join
adapter contract have landed. `--phase-contract A` pins the test hive/repo plus
the causal before/after observations that must falsify a warm-store false green:
the VM store is observed absent, canonical git-sync recreates it, both physical
device namespaces and their referenced objects then agree on both hosts, and
each device remains confined to its own namespace. The contract is explicitly
`ready:false`; it is not an observation and cannot emit evidence.

The scenario validates the two producer-issued host identities, requires all
three files to share the producer's private run directory, and then exits
**before the first SSH or mutation** while any fixed phase executor is missing.
The canonical wrapper calls `--require-ready` before its VM identity SSH, so an
incomplete scenario cannot even contact the rig.

The adapter therefore still exits non-zero without evidence, and the canonical
drill continues reporting E and G as SKIP. It becomes execution-ready only when
the checked-in fixed phases record fresh same-run A-G observations—including
the E/P-306 bridge and G/P-308 crash/fence/retry/restart causality. Do not add an
environment-supplied command or pre-authored JSON seam; those are the false-green
paths this producer is designed to remove.

## `parity.sh` — the LIVE-1 parity runner (WI-7000)

The probes above prove the *transport*. `parity.sh` proves the five LIVE-1
**coordination surfaces** on top of it, by driving the `fed_assert_*` helpers in
`bin/lib/federation-asserts.sh` against this rig:

| Leg | Surface | Proves |
| --- | --- | --- |
| `fedevents` | P-009 federated events | key fired EXACTLY once on the VM (positive control — run it first) |
| `wakebridge` | P-002/P-003 wake bridge | a tower `coord:send` fires the VM's inbox-wake |
| `receipts` | P-008 + M5a delivery receipts | exactly one receipt, `delivered=true` |
| `claimspec` | P-016 + M7 claim-spec federation | spec lands on the VM `origin=remote` with `fed_hlc`+`fed_ts` |
| `presence` | P-004/P-005 presence gossip | **both directions**, as two verdict rows: `presence` = the tower carries fresh presence+session rows for the VM, `presence-rev` = the VM carries them for the tower (WI-7029 — asserting only one direction let the reverse stay dead under a green leg) |

Exit: `0` all green · `1` one or more red · `2` **preflight failed, NO verdict**.

- **It cannot emit a single-box false green.** Preflight aborts with exit 2
  unless two distinct real hosts both answer, and there is no skip path — the
  D-018 lesson (a drill whose legs quietly SKIP produces a plausible, quotable,
  WRONG release reading). Never report a LIVE-1 surface proven from a run whose
  banner does not name two distinct hosts.
- **Why it exists at all:** those five helpers shipped in July with their named
  caller being the retired `deb-hetzner-federation.sh`, so *nothing invoked
  them* for a month and four of five surfaces stayed "unproven cross-machine,
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

| Var | Default | Meaning |
| --- | --- | --- |
| `PCUSP_VM_SSH` | `aviweiss@172.31.44.2` | ssh target for the VM end |
| `PAPERCUSP_HONO_PORT` | `3270` | TOWER operator port (probes'/diag's tower end) — the **bg-host substrate primary**, which actually holds the in-process events/coord state; `:3070` is the request-only cluster tier and gives false-negative probe results (earlier "probe failures" were this, not a federation defect) |
| `PCUSP_PROBE_KEY` | unique per run | event key the probes emit/await |
| `PCUSP_VM_NODE` / `PCUSP_MCP_CALL` | auto | VM-side node binary / mcp-call.mjs path (see `vmcall.sh`) |

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
  call by default above — `:3070` is where a *code change* lands; `:3270`
  is which *port* of the running (already-deployed) operator to query.

## Files

| File | Role |
| --- | --- |
| `vmcall.sh` | VM-SIDE driver: port auto-discovery + mcp-call (deployed to VM `/tmp`) |
| `deploy.sh` | push `vmcall.sh` + `scripts/mcp-call.mjs` onto the VM + self-test (auto-runs `preflight-login.sh` if the operator is unreachable) |
| `preflight-login.sh` | assert the VM's unattended-login invariant (kcpassword ↔ account password); fails LOUD on the silent loginwindow-stuck death (WI-4070 / EI-13010) instead of letting it look like a federation failure |
| `probe-fwd.sh` | tower→VM federated-event probe (from `/tmp/p059-e1c.sh`) |
| `probe-rev.sh` | VM→tower federated-event probe (from `/tmp/p059-rev2.sh`) |
| `diag.sh` | tower+VM `dev:dogfood_substrate_status` side-by-side + swarm log (from `/tmp/p059-diag.sh`) |

For the containerized 2-node **matrix** rig see `bin/local-matrix.sh`; for the
fast single-box smokes see `bin/two-instance-*-smoke.sh`.
